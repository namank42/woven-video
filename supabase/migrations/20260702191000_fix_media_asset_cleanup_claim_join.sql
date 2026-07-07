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
    select
      assets.id,
      case
        when assets.status = 'deleting' then nullif(assets.metadata->>'delete_previous_status', '')
        else assets.status
      end as previous_status
    from public.media_assets assets
    where assets.status <> 'deleted'
      and (
        (
          assets.status = 'deleting'
          and (
            assets.metadata->>'delete_claimed_at' is null
            or (assets.metadata->>'delete_claimed_at')::timestamptz < p_now - interval '1 hour'
          )
        )
        or (
          assets.status <> 'deleting'
          and (
            (assets.status in ('pending', 'uploaded') and assets.upload_expires_at is not null and assets.upload_expires_at < p_now)
            or (assets.kind = 'output' and assets.status = 'ready' and assets.download_expires_at is not null and assets.download_expires_at < p_now)
            or (
              assets.kind = 'input'
              and assets.status = 'attached'
              and exists (
                select 1
                from public.generation_jobs jobs
                where jobs.id = assets.job_id
                  and jobs.status in ('succeeded', 'failed', 'cancelled')
              )
            )
          )
        )
      )
    order by assets.created_at asc
    for update skip locked
    limit p_limit
  )
  update public.media_assets assets
  set status = 'deleting',
      metadata = coalesce(assets.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'delete_claimed_at', p_now
        )
        || case
          when candidates.previous_status is null then '{}'::jsonb
          else jsonb_build_object('delete_previous_status', candidates.previous_status)
        end,
      updated_at = now()
  from candidates
  where assets.id = candidates.id
  returning assets.id, assets.storage_key;
end;
$$;
