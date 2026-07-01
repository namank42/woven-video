drop function if exists public.fail_media_output_asset_attempt(uuid, uuid, uuid, text, jsonb);

create or replace function public.reuse_claimed_media_output_asset(
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

  update public.media_assets
  set metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_asset_id
    and user_id = p_user_id
    and job_id = p_job_id
    and kind = 'output'
    and status = 'ready'
    and content_type = p_content_type
    and size_bytes = p_size_bytes
    and storage_key = p_storage_key
  returning * into v_asset;

  if v_asset.id is null then
    raise exception 'media_output_asset_reuse_mismatch';
  end if;

  return v_asset;
end;
$$;

create or replace function public.fail_media_output_asset_attempt(
  p_job_id uuid,
  p_asset_id uuid,
  p_user_id uuid,
  p_output_attempt_id text,
  p_storage_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.media_assets
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_asset public.media_assets%rowtype;
begin
  if p_output_attempt_id is null or btrim(p_output_attempt_id) = '' then
    raise exception 'media_output_asset_attempt_id_required';
  end if;
  if p_storage_key is null or btrim(p_storage_key) = '' then
    raise exception 'media_output_asset_storage_key_required';
  end if;

  update public.media_assets
  set status = 'failed',
      metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_asset_id
    and user_id = p_user_id
    and job_id = p_job_id
    and kind = 'output'
    and storage_key = p_storage_key
    and metadata->>'output_attempt_id' = p_output_attempt_id
  returning * into v_asset;

  if v_asset.id is null then
    raise exception 'media_output_asset_attempt_not_found';
  end if;

  return v_asset;
end;
$$;

revoke all on function public.reuse_claimed_media_output_asset(uuid, uuid, uuid, uuid, text, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reuse_claimed_media_output_asset(uuid, uuid, uuid, uuid, text, bigint, text, jsonb)
  to service_role;

revoke all on function public.fail_media_output_asset_attempt(uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.fail_media_output_asset_attempt(uuid, uuid, uuid, text, text, jsonb)
  to service_role;
