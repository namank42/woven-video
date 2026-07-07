create or replace function public.cancel_queued_media_job(
  p_user_id uuid,
  p_job_id uuid
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
    and user_id = p_user_id
    and type = 'media_job'
  for update;

  if v_job.id is null then
    raise exception 'media_job_not_found';
  end if;

  if v_job.status <> 'queued' then
    raise exception 'media_job_not_ready';
  end if;

  return public.release_balance_reservation(
    p_job_id,
    'cancelled',
    'Cancelled by user.',
    '{"reason":"user_cancelled"}'::jsonb
  );
end;
$$;

revoke all on function public.cancel_queued_media_job(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_queued_media_job(uuid, uuid)
  to service_role;
