alter table public.generation_jobs
  add column if not exists provider_attempt_nonce text;

drop function if exists public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz);

create or replace function public.find_media_jobs_for_trigger_reconciliation(
  p_limit integer default 25,
  p_now timestamptz default now()
)
returns table(id uuid, user_id uuid, media_model_id text, media_kind text, claim_generation text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'media_reconciliation_limit_out_of_range';
  end if;

  return query
  with candidates as (
    select
      jobs.id,
      jobs.user_id,
      coalesce(nullif(jobs.input->>'media_model_id', ''), jobs.model) as media_model_id,
      case
        when jobs.input->>'operation' = 'image_generation' then 'image'
        when jobs.input->>'operation' = 'video_generation' then 'video'
        when jobs.input->>'operation' in ('text_to_speech', 'sound_effects', 'music_generation') then 'audio'
        else null
      end as media_kind,
      coalesce(jobs.claim_token::text, to_char(p_now, 'YYYYMMDDHH24MISS')) as claim_generation,
      jobs.created_at
    from public.generation_jobs jobs
    where jobs.type = 'media_job'
      and jobs.status in ('queued', 'running', 'waiting_provider')
      and coalesce(jobs.reserved_amount_usd_micros, 0) > 0
      and jobs.expires_at is not null
      and jobs.expires_at > p_now
      and (
        (
          jobs.status = 'queued'
          and jobs.created_at < p_now - interval '2 minutes'
        )
        or (
          jobs.status in ('running', 'waiting_provider')
          and (
            jobs.claim_expires_at is null
            or jobs.claim_expires_at < p_now
          )
        )
      )
  )
  select
    candidates.id,
    candidates.user_id,
    candidates.media_model_id,
    candidates.media_kind,
    candidates.claim_generation
  from candidates
  where candidates.media_kind is not null
  order by candidates.created_at asc
  limit p_limit;
end;
$$;

create or replace function public.finalize_expired_media_jobs_for_reconciliation(
  p_now timestamptz default now(),
  p_limit integer default 100
)
returns table(
  id uuid,
  user_id uuid,
  previous_status text,
  status text,
  error text,
  reserved_amount_usd_micros bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_released public.generation_jobs%rowtype;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'media_timeout_finalization_limit_out_of_range';
  end if;

  for v_job in
    select *
    from public.generation_jobs jobs
    where jobs.type = 'media_job'
      and jobs.status in ('creating', 'queued', 'running', 'waiting_provider')
      and jobs.expires_at is not null
      and jobs.expires_at <= p_now
    order by jobs.created_at asc
    for update skip locked
    limit p_limit
  loop
    if v_job.account_id is not null and coalesce(v_job.reserved_amount_usd_micros, 0) > 0 then
      select *
      into v_released
      from public.release_balance_reservation(
        v_job.id,
        'failed',
        'media_job_timed_out',
        jsonb_build_object(
          'reason', 'media_job_timed_out',
          'timed_out_at', p_now,
          'previous_status', v_job.status
        )
      );

      update public.generation_jobs jobs
      set progress = coalesce(jobs.progress, '{}'::jsonb) || jsonb_build_object(
            'stage', 'failed',
            'percent', null,
            'message', 'Media job timed out'
          )
      where jobs.id = v_job.id
      returning * into v_released;
    else
      update public.generation_jobs jobs
      set status = 'failed',
          final_cost_usd_micros = 0,
          error = 'media_job_timed_out',
          completed_at = coalesce(jobs.completed_at, p_now),
          progress = coalesce(jobs.progress, '{}'::jsonb) || jsonb_build_object(
            'stage', 'failed',
            'percent', null,
            'message', 'Media job timed out'
          )
      where jobs.id = v_job.id
      returning * into v_released;
    end if;

    id := v_released.id;
    user_id := v_released.user_id;
    previous_status := v_job.status;
    status := v_released.status;
    error := v_released.error;
    reserved_amount_usd_micros := v_released.reserved_amount_usd_micros;
    return next;
  end loop;
end;
$$;

revoke all on function public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz) to service_role;

revoke all on function public.finalize_expired_media_jobs_for_reconciliation(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.finalize_expired_media_jobs_for_reconciliation(timestamptz, integer) to service_role;
