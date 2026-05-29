-- One-time, idempotent grandfather backfill: every user created BEFORE the launch
-- cutoff gets a free lifetime license. Re-runs are no-ops (on conflict do nothing).
-- IMPORTANT: push this to prod only AFTER the cutoff instant has passed, so no
-- eligible row can be created between the SELECT and the cutoff.
--
-- TODO(launch): replace the placeholder below with the real launch instant (UTC).
-- The placeholder grandfathers everyone, which is correct for local/staging.

insert into public.licenses (user_id, kind, status, source, source_id, granted_at, metadata)
select
  u.id,
  'lifetime',
  'active',
  'grandfather',
  u.id::text,
  now(),
  jsonb_build_object('reason', 'pre_launch_grandfather')
from auth.users u
where u.created_at < '2099-01-01T00:00:00Z'::timestamptz   -- TODO(launch): set real cutoff
on conflict (source, source_id) do nothing;
