create or replace function public.claim_media_job_by_id(
  p_job_id uuid,
  p_lease_seconds integer default 300
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  if p_job_id is null then
    raise exception 'media_job_id_required';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'media_job_lease_seconds_out_of_range';
  end if;

  select *
  into v_job
  from public.generation_jobs jobs
  where jobs.id = p_job_id
    and jobs.type = 'media_job'
    and jobs.status in ('queued', 'running', 'waiting_provider')
    and coalesce(jobs.reserved_amount_usd_micros, 0) > 0
    and (
      jobs.status = 'queued'
      or jobs.claim_expires_at is null
      or jobs.claim_expires_at < now()
    )
    and not exists (
      select 1
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(coalesce(jobs.input->'input_asset_ids', '[]'::jsonb)) = 'array'
            then coalesce(jobs.input->'input_asset_ids', '[]'::jsonb)
          else '[]'::jsonb
        end
      ) as input_asset_id(asset_id)
      where not exists (
        select 1
        from public.media_assets assets
        where assets.id::text = input_asset_id.asset_id
          and assets.user_id = jobs.user_id
          and assets.job_id = jobs.id
          and assets.kind = 'input'
          and assets.status = 'attached'
      )
    )
  for update skip locked;

  if v_job.id is null then
    return null;
  end if;

  update public.generation_jobs
  set status = case
        when status = 'queued' then 'running'
        else status
      end,
      started_at = coalesce(started_at, now()),
      claim_expires_at = now() + make_interval(secs => p_lease_seconds),
      claim_token = gen_random_uuid(),
      last_provider_poll_at = now(),
      progress = coalesce(progress, '{}'::jsonb) || jsonb_build_object(
        'stage', case
          when status = 'queued' then 'claimed'
          else coalesce(progress->>'stage', status)
        end
      )
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

create or replace function public.find_media_jobs_for_trigger_reconciliation(
  p_limit integer default 25,
  p_now timestamptz default now()
)
returns table(id uuid, user_id uuid, media_model_id text, media_kind text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'media_reconciliation_limit_out_of_range';
  end if;

  return query
  select
    jobs.id,
    jobs.user_id,
    coalesce(nullif(jobs.input->>'media_model_id', ''), jobs.model) as media_model_id,
    case
      when jobs.input->>'operation' = 'image_generation' then 'image'
      when jobs.input->>'operation' in ('text_to_speech', 'sound_effects', 'music_generation') then 'audio'
      else 'video'
    end as media_kind
  from public.generation_jobs jobs
  where jobs.type = 'media_job'
    and jobs.status in ('queued', 'running', 'waiting_provider')
    and coalesce(jobs.reserved_amount_usd_micros, 0) > 0
    and (
      (
        jobs.status = 'queued'
        and (
          jobs.created_at < p_now - interval '2 minutes'
          or jobs.expires_at <= p_now
        )
      )
      or (
        jobs.status in ('running', 'waiting_provider')
        and (
          jobs.expires_at <= p_now
          or jobs.claim_expires_at is null
          or jobs.claim_expires_at < p_now
          or jobs.last_provider_poll_at is null
          or jobs.last_provider_poll_at < p_now - interval '2 minutes'
        )
      )
    )
  order by jobs.created_at asc
  limit p_limit;
end;
$$;

create or replace function public.mark_media_job_waiting_provider(
  p_job_id uuid,
  p_claim_token uuid,
  p_provider_job_id text,
  p_progress jsonb default '{"stage":"provider_wait","percent":null,"message":"Waiting on provider"}'::jsonb
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  if p_claim_token is null then
    raise exception 'media_job_missing_claim_token';
  end if;

  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
    and type = 'media_job'
    and claim_token = p_claim_token
    and (claim_expires_at is null or claim_expires_at >= now())
  for update;

  if v_job.id is null then
    raise exception 'media_job_stale_claim';
  end if;

  update public.generation_jobs
  set status = 'waiting_provider',
      provider_job_id = p_provider_job_id,
      progress = coalesce(p_progress, '{}'::jsonb),
      last_provider_poll_at = now(),
      claim_expires_at = now()
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.claim_media_job_by_id(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_media_job_by_id(uuid, integer) to service_role;

revoke all on function public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz) to service_role;

revoke all on function public.mark_media_job_waiting_provider(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.mark_media_job_waiting_provider(uuid, uuid, text, jsonb) to service_role;
