create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete set null,
  kind text not null check (kind in ('input', 'output')),
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'attached', 'ready', 'deleted', 'failed')),
  content_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  original_filename text,
  storage_key text not null unique,
  upload_expires_at timestamptz,
  download_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index media_assets_user_created_idx
  on public.media_assets(user_id, created_at desc);
create index media_assets_job_idx
  on public.media_assets(job_id);
create index media_assets_status_expires_idx
  on public.media_assets(status, upload_expires_at);
create index media_assets_download_expires_idx
  on public.media_assets(status, download_expires_at);

create trigger set_media_assets_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

alter table public.generation_jobs
  drop constraint if exists generation_jobs_status_check;

alter table public.generation_jobs
  add constraint generation_jobs_status_check
  check (status in (
    'queued',
    'running',
    'waiting_provider',
    'downloading_outputs',
    'succeeded',
    'failed',
    'cancelled'
  ));

alter table public.generation_jobs
  add column if not exists progress jsonb not null default '{}'::jsonb,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists claim_token uuid,
  add column if not exists last_provider_poll_at timestamptz;

create index if not exists generation_jobs_media_claim_idx
  on public.generation_jobs(status, claim_expires_at, created_at)
  where type = 'media_job';

create index if not exists generation_jobs_media_provider_job_idx
  on public.generation_jobs(provider, provider_job_id)
  where type = 'media_job' and provider_job_id is not null;

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
    select id
    from public.generation_jobs
    where type = 'media_job'
      and status in ('queued', 'running', 'waiting_provider')
      and (
        status = 'queued'
        or claim_expires_at is null
        or claim_expires_at < now()
      )
    order by created_at asc
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

alter table public.media_assets enable row level security;

create policy "Users can read own media assets"
on public.media_assets
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.media_assets from anon, authenticated;
grant select on public.media_assets to authenticated;
grant all on public.media_assets to service_role;

revoke all on function public.claim_media_jobs(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_media_jobs(integer, integer)
  to service_role;

insert into public.model_pricing_rules (
  provider,
  model,
  operation,
  display_name,
  markup_bps,
  minimum_charge_usd_micros,
  reserve_amount_usd_micros,
  enabled,
  metadata
)
values (
  'elevenlabs',
  'scribe_v2',
  'reel_captions',
  'Auto captions',
  2000,
  100000,
  100000,
  true,
  '{
    "billing_unit": "audio_minute",
    "public_rate_usd_per_minute": 0.10,
    "provider_rate_usd_per_hour": 0.40,
    "provider": "ElevenLabs Scribe v2",
    "minimum_charge_usd": 0.10
  }'::jsonb
)
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    enabled = excluded.enabled,
    metadata = excluded.metadata,
    updated_at = now();
