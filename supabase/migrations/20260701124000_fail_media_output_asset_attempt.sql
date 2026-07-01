create or replace function public.fail_media_output_asset_attempt(
  p_job_id uuid,
  p_asset_id uuid,
  p_user_id uuid,
  p_output_attempt_id text,
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

  update public.media_assets
  set status = 'failed',
      metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_asset_id
    and user_id = p_user_id
    and job_id = p_job_id
    and kind = 'output'
    and metadata->>'output_attempt_id' = p_output_attempt_id
  returning * into v_asset;

  if v_asset.id is null then
    raise exception 'media_output_asset_attempt_not_found';
  end if;

  return v_asset;
end;
$$;

revoke all on function public.fail_media_output_asset_attempt(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.fail_media_output_asset_attempt(uuid, uuid, uuid, text, jsonb)
  to service_role;
