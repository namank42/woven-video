-- 20260523150000_create_analytics_events_table.sql
-- Product-analytics event stream for the Woven Harness desktop app.
-- INSERT-only for authenticated users; RLS pins user_id to the inserting
-- user's auth.uid(). Reads go through service-role tooling (Studio, psql).
-- Schema deliberately typed and capped — no JSONB in v1 to keep the
-- privacy surface narrow for a Claude/Codex wrapper.
-- Distinct from the billing `usage_events` table, which tracks
-- provider/model costs; this table tracks product feature usage.

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_name text not null check (event_name = any (array[
    'app_launched',
    'session_started',
    'sheet_opened',
    'command_invoked',
    'feedback_submitted'
  ])),
  event_target text check (event_target is null or char_length(event_target) <= 64),
  app_version text check (app_version is null or char_length(app_version) <= 64),
  build_number text check (build_number is null or char_length(build_number) <= 32),
  os_version text check (os_version is null or char_length(os_version) <= 128),
  session_id uuid, -- analytics-launch session (UUID per app launch); unrelated to the 'session_started' event_name
  created_at timestamptz not null default now()
);

alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;
grant insert (event_name, event_target, app_version, build_number, os_version, session_id)
  on public.analytics_events to authenticated;
grant all on public.analytics_events to service_role;

create policy "Users can insert own analytics events"
  on public.analytics_events for insert
  to authenticated
  with check (auth.uid() = user_id);

create index analytics_events_created_at_idx
  on public.analytics_events (created_at desc);
create index analytics_events_user_created_idx
  on public.analytics_events (user_id, created_at desc);
create index analytics_events_name_created_idx
  on public.analytics_events (event_name, created_at desc);
