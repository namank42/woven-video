create or replace function public.prepare_claimed_media_output_asset(
  p_job_id uuid,
  p_claim_token uuid,
  p_asset_id uuid,
  p_user_id uuid,
  p_content_type text,
  p_size_bytes bigint,
  p_storage_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.media_assets
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_asset public.media_assets%rowtype;
begin
  if p_claim_token is null then
    raise exception 'media_job_missing_claim_token';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'media_output_asset_invalid_size';
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
  if v_job.user_id is distinct from p_user_id then
    raise exception 'media_output_asset_owner_mismatch';
  end if;

  select *
  into v_asset
  from public.media_assets
  where id = p_asset_id
  for update;

  if v_asset.id is not null then
    if v_asset.user_id is distinct from p_user_id
      or v_asset.job_id is distinct from p_job_id
      or v_asset.kind is distinct from 'output' then
      raise exception 'media_output_asset_mismatch';
    end if;

    update public.media_assets
    set status = 'pending',
        content_type = p_content_type,
        size_bytes = p_size_bytes,
        storage_key = p_storage_key,
        download_expires_at = null,
        metadata = coalesce(p_metadata, '{}'::jsonb)
    where id = p_asset_id
    returning * into v_asset;
  else
    insert into public.media_assets (
      id,
      user_id,
      job_id,
      kind,
      status,
      content_type,
      size_bytes,
      storage_key,
      download_expires_at,
      metadata
    )
    values (
      p_asset_id,
      p_user_id,
      p_job_id,
      'output',
      'pending',
      p_content_type,
      p_size_bytes,
      p_storage_key,
      null,
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning * into v_asset;
  end if;

  return v_asset;
end;
$$;

create or replace function public.mark_claimed_media_output_asset_ready(
  p_job_id uuid,
  p_claim_token uuid,
  p_asset_id uuid,
  p_user_id uuid,
  p_download_expires_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns public.media_assets
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_asset public.media_assets%rowtype;
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
  if v_job.user_id is distinct from p_user_id then
    raise exception 'media_output_asset_owner_mismatch';
  end if;

  update public.media_assets
  set status = 'ready',
      download_expires_at = p_download_expires_at,
      metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_asset_id
    and user_id = p_user_id
    and job_id = p_job_id
    and kind = 'output'
  returning * into v_asset;

  if v_asset.id is null then
    raise exception 'media_output_asset_not_found';
  end if;

  return v_asset;
end;
$$;

create or replace function public.fail_claimed_media_output_asset(
  p_job_id uuid,
  p_claim_token uuid,
  p_asset_id uuid,
  p_user_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns public.media_assets
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_asset public.media_assets%rowtype;
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
  if v_job.user_id is distinct from p_user_id then
    raise exception 'media_output_asset_owner_mismatch';
  end if;

  update public.media_assets
  set status = 'failed',
      metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_asset_id
    and user_id = p_user_id
    and job_id = p_job_id
    and kind = 'output'
  returning * into v_asset;

  if v_asset.id is null then
    raise exception 'media_output_asset_not_found';
  end if;

  return v_asset;
end;
$$;

revoke all on function public.prepare_claimed_media_output_asset(uuid, uuid, uuid, uuid, text, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.prepare_claimed_media_output_asset(uuid, uuid, uuid, uuid, text, bigint, text, jsonb)
  to service_role;

revoke all on function public.mark_claimed_media_output_asset_ready(uuid, uuid, uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.mark_claimed_media_output_asset_ready(uuid, uuid, uuid, uuid, timestamptz, jsonb)
  to service_role;

revoke all on function public.fail_claimed_media_output_asset(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fail_claimed_media_output_asset(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
