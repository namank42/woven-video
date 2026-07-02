alter table public.generation_jobs
  drop constraint if exists generation_jobs_status_check;

alter table public.generation_jobs
  add constraint generation_jobs_status_check
  check (status in (
    'creating',
    'queued',
    'running',
    'waiting_provider',
    'downloading_outputs',
    'succeeded',
    'failed',
    'cancelled'
  ));

alter table public.generation_jobs
  add column if not exists expires_at timestamptz;

alter table public.media_assets
  drop constraint if exists media_assets_status_check;

alter table public.media_assets
  add constraint media_assets_status_check
  check (status in ('pending', 'uploaded', 'attached', 'ready', 'deleting', 'deleted', 'failed'));

create or replace function public.claim_media_jobs(
  p_limit integer default 1,
  p_lease_seconds integer default 300
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception 'claim_media_jobs_limit_out_of_range';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'claim_media_jobs_lease_seconds_out_of_range';
  end if;

  return query
  with candidates as (
    select jobs.id
    from public.generation_jobs jobs
    where jobs.type = 'media_job'
      and jobs.status in ('queued', 'running', 'waiting_provider')
      and (
        jobs.status = 'queued'
        or jobs.claim_expires_at is null
        or jobs.claim_expires_at < now()
      )
      and (
        jobs.status <> 'queued'
        or (
          coalesce(jobs.reserved_amount_usd_micros, 0) > 0
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
        )
      )
    order by jobs.created_at asc
    for update skip locked
    limit p_limit
  )
  update public.generation_jobs jobs
  set status = case
        when jobs.status = 'queued' then 'running'
        else jobs.status
      end,
      started_at = coalesce(jobs.started_at, now()),
      claim_expires_at = now() + make_interval(secs => p_lease_seconds),
      claim_token = gen_random_uuid(),
      progress = coalesce(jobs.progress, '{}'::jsonb) || jsonb_build_object(
        'stage', case
          when jobs.status = 'queued' then 'claimed'
          else coalesce(jobs.progress->>'stage', jobs.status)
        end
      )
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

create or replace function public.extend_claimed_media_job_lease(
  p_job_id uuid,
  p_claim_token uuid,
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
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'media_job_lease_seconds_out_of_range';
  end if;

  update public.generation_jobs
  set claim_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_job_id
    and type = 'media_job'
    and claim_token = p_claim_token
    and status in ('running', 'waiting_provider', 'downloading_outputs')
    and (claim_expires_at is null or claim_expires_at >= now())
  returning * into v_job;

  if not found then
    raise exception 'media_job_stale_claim';
  end if;

  return v_job;
end;
$$;

create or replace function public.claim_expired_media_assets_for_deletion(
  p_now timestamptz default now(),
  p_limit integer default 100
)
returns table(id uuid, storage_key text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'media_asset_deletion_limit_out_of_range';
  end if;

  return query
  with candidates as (
    select assets.id, assets.status as previous_status
    from public.media_assets assets
    left join public.generation_jobs jobs on jobs.id = assets.job_id
    where assets.status <> 'deleting'
      and assets.status <> 'deleted'
      and (
        (assets.status in ('pending', 'uploaded') and assets.upload_expires_at is not null and assets.upload_expires_at < p_now)
        or (assets.kind = 'output' and assets.status = 'ready' and assets.download_expires_at is not null and assets.download_expires_at < p_now)
        or (assets.kind = 'input' and assets.status = 'attached' and jobs.status in ('succeeded', 'failed', 'cancelled'))
      )
    order by assets.created_at asc
    for update skip locked
    limit p_limit
  )
  update public.media_assets assets
  set status = 'deleting',
      metadata = coalesce(assets.metadata, '{}'::jsonb)
        || jsonb_build_object('delete_previous_status', candidates.previous_status),
      updated_at = now()
  from candidates
  where assets.id = candidates.id
  returning assets.id, assets.storage_key;
end;
$$;

create or replace function public.complete_media_asset_deletions(
  p_asset_ids uuid[],
  p_now timestamptz default now()
)
returns setof public.media_assets
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_asset_ids is null then
    raise exception 'media_asset_ids_required';
  end if;

  return query
  update public.media_assets assets
  set status = 'deleted',
      deleted_at = coalesce(assets.deleted_at, p_now),
      metadata = coalesce(assets.metadata, '{}'::jsonb) - 'delete_previous_status',
      updated_at = now()
  where assets.id = any(p_asset_ids)
    and assets.status = 'deleting'
  returning assets.*;
end;
$$;

create or replace function public.release_media_asset_deletion_claims(
  p_asset_ids uuid[]
)
returns setof public.media_assets
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_asset_ids is null then
    raise exception 'media_asset_ids_required';
  end if;

  return query
  update public.media_assets assets
  set status = coalesce(nullif(assets.metadata->>'delete_previous_status', ''), 'failed'),
      metadata = coalesce(assets.metadata, '{}'::jsonb) - 'delete_previous_status',
      updated_at = now()
  where assets.id = any(p_asset_ids)
    and assets.status = 'deleting'
  returning assets.*;
end;
$$;

revoke all on function public.claim_media_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_media_jobs(integer, integer) to service_role;

revoke all on function public.extend_claimed_media_job_lease(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_claimed_media_job_lease(uuid, uuid, integer) to service_role;

revoke all on function public.claim_expired_media_assets_for_deletion(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_expired_media_assets_for_deletion(timestamptz, integer) to service_role;

revoke all on function public.complete_media_asset_deletions(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.complete_media_asset_deletions(uuid[], timestamptz) to service_role;

revoke all on function public.release_media_asset_deletion_claims(uuid[]) from public, anon, authenticated;
grant execute on function public.release_media_asset_deletion_claims(uuid[]) to service_role;
