create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create table public.telemetry_product_events (
  event_id uuid primary key,
  catalog_version smallint not null check (catalog_version = 1),
  event_name text not null check (char_length(event_name) between 1 and 64),
  stage text not null check (char_length(stage) between 1 and 64),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null check (source in ('desktop', 'sidecar')),
  source_sequence bigint not null check (source_sequence >= 0),
  host_observed_sequence bigint not null check (host_observed_sequence >= 0),
  installation_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  app_launch_id uuid not null,
  workspace_id uuid,
  chat_id uuid,
  operation_id uuid,
  turn_id uuid,
  incident_id uuid,
  tool_call_id uuid,
  priority smallint not null check (priority between 0 and 3),
  app_version text not null check (char_length(app_version) between 1 and 64),
  app_build text not null check (char_length(app_build) between 1 and 32),
  app_environment text not null check (app_environment in ('development', 'beta', 'production')),
  release_channel text not null check (release_channel in ('internal', 'beta', 'stable')),
  macos_major_minor text not null check (macos_major_minor ~ '^[0-9]{1,2}\.[0-9]{1,2}$'),
  architecture text not null check (architecture in ('arm64', 'x86_64', 'other')),
  properties jsonb not null check (jsonb_typeof(properties) = 'object')
);

create table public.telemetry_operational_events (
  event_id uuid primary key,
  catalog_version smallint not null check (catalog_version = 1),
  event_name text not null check (char_length(event_name) between 1 and 64),
  stage text not null check (char_length(stage) between 1 and 64),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null check (source in ('desktop', 'sidecar')),
  source_sequence bigint not null check (source_sequence >= 0),
  host_observed_sequence bigint not null check (host_observed_sequence >= 0),
  installation_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  app_launch_id uuid not null,
  workspace_id uuid,
  chat_id uuid,
  operation_id uuid,
  turn_id uuid,
  incident_id uuid,
  tool_call_id uuid,
  priority smallint not null check (priority between 0 and 3),
  app_version text not null check (char_length(app_version) between 1 and 64),
  app_build text not null check (char_length(app_build) between 1 and 32),
  app_environment text not null check (app_environment in ('development', 'beta', 'production')),
  release_channel text not null check (release_channel in ('internal', 'beta', 'stable')),
  macos_major_minor text not null check (macos_major_minor ~ '^[0-9]{1,2}\.[0-9]{1,2}$'),
  architecture text not null check (architecture in ('arm64', 'x86_64', 'other')),
  properties jsonb not null check (jsonb_typeof(properties) = 'object'),
  error_domain text generated always as (properties ->> 'error_domain') stored,
  error_code text generated always as (properties ->> 'error_code') stored,
  error_fingerprint text generated always as (properties ->> 'error_fingerprint') stored,
  check (error_fingerprint is null or error_fingerprint ~ '^[0-9a-f]{64}$')
);

create table public.telemetry_installation_account_links (
  id bigint generated always as identity primary key,
  installation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  linked_at timestamptz not null,
  last_seen_at timestamptz not null,
  unlinked_at timestamptz,
  check (last_seen_at >= linked_at),
  check (unlinked_at is null or unlinked_at >= linked_at)
);

create unique index telemetry_installation_account_links_active_idx
  on public.telemetry_installation_account_links (installation_id)
  where unlinked_at is null;
create index telemetry_installation_account_links_user_idx
  on public.telemetry_installation_account_links (user_id, linked_at desc);

create table public.telemetry_ingestion_rate_windows (
  subject_type text not null check (subject_type in ('installation', 'account')),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  accepted_count integer not null check (accepted_count >= 0),
  primary key (subject_type, subject_hash, window_start)
);

create index telemetry_product_occurred_at_idx
  on public.telemetry_product_events (occurred_at desc);
create index telemetry_product_received_at_idx
  on public.telemetry_product_events (received_at desc);
create index telemetry_product_event_stage_idx
  on public.telemetry_product_events (catalog_version, event_name, stage, occurred_at desc);
create index telemetry_product_app_context_idx
  on public.telemetry_product_events (app_version, app_environment, release_channel, occurred_at desc);
create index telemetry_product_installation_idx
  on public.telemetry_product_events (installation_id, occurred_at desc);
create index telemetry_product_user_idx
  on public.telemetry_product_events (user_id, occurred_at desc);
create index telemetry_product_workspace_idx
  on public.telemetry_product_events (workspace_id, occurred_at desc) where workspace_id is not null;
create index telemetry_product_chat_idx
  on public.telemetry_product_events (chat_id, occurred_at desc) where chat_id is not null;
create index telemetry_product_turn_idx
  on public.telemetry_product_events (turn_id, occurred_at desc) where turn_id is not null;
create index telemetry_product_operation_idx
  on public.telemetry_product_events (operation_id, occurred_at desc) where operation_id is not null;
create index telemetry_product_incident_idx
  on public.telemetry_product_events (incident_id, occurred_at desc) where incident_id is not null;
create index telemetry_product_tool_call_idx
  on public.telemetry_product_events (tool_call_id, occurred_at desc) where tool_call_id is not null;
create index telemetry_product_source_sequence_idx
  on public.telemetry_product_events (installation_id, app_launch_id, source, source_sequence);
create index telemetry_product_host_sequence_idx
  on public.telemetry_product_events (installation_id, app_launch_id, host_observed_sequence);
create index telemetry_product_priority_idx
  on public.telemetry_product_events (priority, occurred_at desc);

create index telemetry_operational_occurred_at_idx
  on public.telemetry_operational_events (occurred_at desc);
create index telemetry_operational_received_at_idx
  on public.telemetry_operational_events (received_at desc);
create index telemetry_operational_event_stage_idx
  on public.telemetry_operational_events (catalog_version, event_name, stage, occurred_at desc);
create index telemetry_operational_app_context_idx
  on public.telemetry_operational_events (app_version, app_environment, release_channel, occurred_at desc);
create index telemetry_operational_installation_idx
  on public.telemetry_operational_events (installation_id, occurred_at desc);
create index telemetry_operational_user_idx
  on public.telemetry_operational_events (user_id, occurred_at desc);
create index telemetry_operational_workspace_idx
  on public.telemetry_operational_events (workspace_id, occurred_at desc) where workspace_id is not null;
create index telemetry_operational_chat_idx
  on public.telemetry_operational_events (chat_id, occurred_at desc) where chat_id is not null;
create index telemetry_operational_turn_idx
  on public.telemetry_operational_events (turn_id, occurred_at desc) where turn_id is not null;
create index telemetry_operational_operation_idx
  on public.telemetry_operational_events (operation_id, occurred_at desc) where operation_id is not null;
create index telemetry_operational_incident_idx
  on public.telemetry_operational_events (incident_id, occurred_at desc) where incident_id is not null;
create index telemetry_operational_tool_call_idx
  on public.telemetry_operational_events (tool_call_id, occurred_at desc) where tool_call_id is not null;
create index telemetry_operational_source_sequence_idx
  on public.telemetry_operational_events (installation_id, app_launch_id, source, source_sequence);
create index telemetry_operational_host_sequence_idx
  on public.telemetry_operational_events (installation_id, app_launch_id, host_observed_sequence);
create index telemetry_operational_priority_idx
  on public.telemetry_operational_events (priority, occurred_at desc);
create index telemetry_operational_error_idx
  on public.telemetry_operational_events (error_domain, error_code, error_fingerprint, occurred_at desc)
  where error_domain is not null or error_code is not null or error_fingerprint is not null;

alter table public.telemetry_product_events enable row level security;
alter table public.telemetry_operational_events enable row level security;
alter table public.telemetry_installation_account_links enable row level security;
alter table public.telemetry_ingestion_rate_windows enable row level security;

revoke all on public.telemetry_product_events from public, anon, authenticated;
revoke all on public.telemetry_operational_events from public, anon, authenticated;
revoke all on public.telemetry_installation_account_links from public, anon, authenticated;
revoke all on public.telemetry_ingestion_rate_windows from public, anon, authenticated;

grant all on public.telemetry_product_events to service_role;
grant all on public.telemetry_operational_events to service_role;
grant all on public.telemetry_installation_account_links to service_role;
grant all on public.telemetry_ingestion_rate_windows to service_role;

create or replace function public.telemetry_admit_and_insert(
  p_batch jsonb,
  p_user_id uuid,
  p_received_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_received_at timestamptz := coalesce(p_received_at, now());
  v_events jsonb := p_batch -> 'events';
  v_installation_id uuid;
  v_installation_hash text;
  v_account_hash text;
  v_window_start timestamptz := coalesce(p_received_at, now());
  v_new_count integer := 0;
  v_installation_count integer := 0;
  v_account_count integer := 0;
  v_has_sign_out boolean := false;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_events) <> 'array' or jsonb_array_length(v_events) < 1 then
    raise exception 'invalid_telemetry_batch';
  end if;

  v_installation_id := ((v_events -> 0) ->> 'installation_id')::uuid;
  if exists (
    select 1
    from jsonb_array_elements(v_events) event
    where (event ->> 'installation_id')::uuid <> v_installation_id
  ) then
    raise exception 'mixed_installation_batch';
  end if;

  v_installation_hash := encode(extensions.digest(v_installation_id::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('installation:' || v_installation_hash, 0));

  if p_user_id is not null then
    v_account_hash := encode(extensions.digest(p_user_id::text, 'sha256'), 'hex');
    perform pg_advisory_xact_lock(hashtextextended('account:' || v_account_hash, 0));
  end if;

  select count(*)::integer
  into v_new_count
  from jsonb_array_elements(v_events) event
  where
    (
      event ->> 'stream' = 'product'
      and not exists (
        select 1 from public.telemetry_product_events stored
        where stored.event_id = (event ->> 'event_id')::uuid
      )
    )
    or
    (
      event ->> 'stream' = 'operational'
      and not exists (
        select 1 from public.telemetry_operational_events stored
        where stored.event_id = (event ->> 'event_id')::uuid
      )
    );

  select coalesce(sum(accepted_count), 0)::integer
  into v_installation_count
  from public.telemetry_ingestion_rate_windows
  where subject_type = 'installation'
    and subject_hash = v_installation_hash
    and window_start > v_received_at - interval '10 minutes';

  if p_user_id is not null then
    select coalesce(sum(accepted_count), 0)::integer
    into v_account_count
    from public.telemetry_ingestion_rate_windows
    where subject_type = 'account'
      and subject_hash = v_account_hash
      and window_start > v_received_at - interval '10 minutes';
  end if;

  if v_installation_count + v_new_count > 600
    or (p_user_id is not null and v_account_count + v_new_count > 1200)
  then
    select coalesce(jsonb_agg(event_id order by ordinal), '[]'::jsonb)
    into v_accepted
    from (
      select event ->> 'event_id' as event_id, ordinal
      from jsonb_array_elements(v_events) with ordinality submitted(event, ordinal)
      where
        (event ->> 'stream' = 'product' and exists (
          select 1 from public.telemetry_product_events stored
          where stored.event_id = (event ->> 'event_id')::uuid
        ))
        or
        (event ->> 'stream' = 'operational' and exists (
          select 1 from public.telemetry_operational_events stored
          where stored.event_id = (event ->> 'event_id')::uuid
        ))
    ) duplicate_events;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', event_id,
          'reason', 'rate_limited',
          'permanent', false
        ) order by ordinal
      ),
      '[]'::jsonb
    )
    into v_rejected
    from (
      select event ->> 'event_id' as event_id, ordinal
      from jsonb_array_elements(v_events) with ordinality submitted(event, ordinal)
      where
        (event ->> 'stream' = 'product' and not exists (
          select 1 from public.telemetry_product_events stored
          where stored.event_id = (event ->> 'event_id')::uuid
        ))
        or
        (event ->> 'stream' = 'operational' and not exists (
          select 1 from public.telemetry_operational_events stored
          where stored.event_id = (event ->> 'event_id')::uuid
        ))
    ) new_events;

    return jsonb_build_object(
      'accepted', v_accepted,
      'rejected', v_rejected,
      'retry_after_ms', 600000
    );
  end if;

  if v_new_count > 0 then
    insert into public.telemetry_ingestion_rate_windows (
      subject_type, subject_hash, window_start, accepted_count
    ) values (
      'installation', v_installation_hash, v_window_start, v_new_count
    )
    on conflict (subject_type, subject_hash, window_start) do update
      set accepted_count = public.telemetry_ingestion_rate_windows.accepted_count + excluded.accepted_count;

    if p_user_id is not null then
      insert into public.telemetry_ingestion_rate_windows (
        subject_type, subject_hash, window_start, accepted_count
      ) values (
        'account', v_account_hash, v_window_start, v_new_count
      )
      on conflict (subject_type, subject_hash, window_start) do update
        set accepted_count = public.telemetry_ingestion_rate_windows.accepted_count + excluded.accepted_count;
    end if;
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_events) event
    where event ->> 'stream' = 'product'
      and event ->> 'event_name' = 'sign_out'
      and event ->> 'stage' = 'succeeded'
      and not exists (
        select 1
        from public.telemetry_product_events stored
        where stored.event_id = (event ->> 'event_id')::uuid
      )
  ) into v_has_sign_out;

  if p_user_id is not null then
    update public.telemetry_installation_account_links
    set last_seen_at = greatest(last_seen_at, v_received_at)
    where installation_id = v_installation_id
      and user_id = p_user_id
      and unlinked_at is null;

    if not found then
      update public.telemetry_installation_account_links
      set last_seen_at = greatest(last_seen_at, v_received_at),
          unlinked_at = greatest(linked_at, v_received_at)
      where installation_id = v_installation_id
        and unlinked_at is null;

      insert into public.telemetry_installation_account_links (
        installation_id, user_id, linked_at, last_seen_at
      ) values (
        v_installation_id, p_user_id, v_received_at, v_received_at
      );
    end if;
  end if;

  if v_has_sign_out then
    update public.telemetry_installation_account_links
    set last_seen_at = greatest(last_seen_at, v_received_at),
        unlinked_at = greatest(linked_at, v_received_at)
    where installation_id = v_installation_id
      and unlinked_at is null
      and (p_user_id is null or user_id = p_user_id);
  end if;

  insert into public.telemetry_product_events (
    event_id, catalog_version, event_name, stage, occurred_at, received_at,
    source, source_sequence, host_observed_sequence, installation_id, user_id,
    app_launch_id, workspace_id, chat_id, operation_id, turn_id, incident_id,
    tool_call_id, priority, app_version, app_build, app_environment,
    release_channel, macos_major_minor, architecture, properties
  )
  select
    (event ->> 'event_id')::uuid,
    (event ->> 'catalog_version')::smallint,
    event ->> 'event_name',
    event ->> 'stage',
    (event ->> 'occurred_at')::timestamptz,
    v_received_at,
    event ->> 'source',
    (event ->> 'source_sequence')::bigint,
    (event ->> 'host_observed_sequence')::bigint,
    (event ->> 'installation_id')::uuid,
    p_user_id,
    (event ->> 'app_launch_id')::uuid,
    nullif(event ->> 'workspace_id', '')::uuid,
    nullif(event ->> 'chat_id', '')::uuid,
    nullif(event ->> 'operation_id', '')::uuid,
    nullif(event ->> 'turn_id', '')::uuid,
    nullif(event ->> 'incident_id', '')::uuid,
    nullif(event ->> 'tool_call_id', '')::uuid,
    (event ->> 'priority')::smallint,
    event -> 'app' ->> 'version',
    event -> 'app' ->> 'build',
    event -> 'app' ->> 'environment',
    event -> 'app' ->> 'release_channel',
    event -> 'system' ->> 'macos_major_minor',
    event -> 'system' ->> 'architecture',
    event -> 'properties'
  from jsonb_array_elements(v_events) event
  where event ->> 'stream' = 'product'
  on conflict (event_id) do nothing;

  insert into public.telemetry_operational_events (
    event_id, catalog_version, event_name, stage, occurred_at, received_at,
    source, source_sequence, host_observed_sequence, installation_id, user_id,
    app_launch_id, workspace_id, chat_id, operation_id, turn_id, incident_id,
    tool_call_id, priority, app_version, app_build, app_environment,
    release_channel, macos_major_minor, architecture, properties
  )
  select
    (event ->> 'event_id')::uuid,
    (event ->> 'catalog_version')::smallint,
    event ->> 'event_name',
    event ->> 'stage',
    (event ->> 'occurred_at')::timestamptz,
    v_received_at,
    event ->> 'source',
    (event ->> 'source_sequence')::bigint,
    (event ->> 'host_observed_sequence')::bigint,
    (event ->> 'installation_id')::uuid,
    p_user_id,
    (event ->> 'app_launch_id')::uuid,
    nullif(event ->> 'workspace_id', '')::uuid,
    nullif(event ->> 'chat_id', '')::uuid,
    nullif(event ->> 'operation_id', '')::uuid,
    nullif(event ->> 'turn_id', '')::uuid,
    nullif(event ->> 'incident_id', '')::uuid,
    nullif(event ->> 'tool_call_id', '')::uuid,
    (event ->> 'priority')::smallint,
    event -> 'app' ->> 'version',
    event -> 'app' ->> 'build',
    event -> 'app' ->> 'environment',
    event -> 'app' ->> 'release_channel',
    event -> 'system' ->> 'macos_major_minor',
    event -> 'system' ->> 'architecture',
    event -> 'properties'
  from jsonb_array_elements(v_events) event
  where event ->> 'stream' = 'operational'
  on conflict (event_id) do nothing;

  select coalesce(jsonb_agg(event ->> 'event_id' order by ordinal), '[]'::jsonb)
  into v_accepted
  from jsonb_array_elements(v_events) with ordinality submitted(event, ordinal);

  return jsonb_build_object(
    'accepted', v_accepted,
    'rejected', '[]'::jsonb,
    'retry_after_ms', null
  );
end;
$$;

revoke all on function public.telemetry_admit_and_insert(jsonb, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.telemetry_admit_and_insert(jsonb, uuid, timestamptz) to service_role;

create or replace function public.telemetry_apply_retention()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_deleted bigint;
  v_operational_deleted bigint;
  v_rate_windows_deleted bigint;
  v_links_deleted bigint;
begin
  delete from public.telemetry_product_events
  where received_at < now() - interval '13 months';
  get diagnostics v_product_deleted = row_count;

  delete from public.telemetry_operational_events
  where received_at < now() - interval '90 days';
  get diagnostics v_operational_deleted = row_count;

  delete from public.telemetry_ingestion_rate_windows
  where window_start <= now() - interval '10 minutes';
  get diagnostics v_rate_windows_deleted = row_count;

  delete from public.telemetry_installation_account_links link
  where link.unlinked_at is not null
    and not exists (
      select 1 from public.telemetry_product_events event
      where event.installation_id = link.installation_id
        and event.user_id = link.user_id
        and event.received_at between link.linked_at and link.unlinked_at
    )
    and not exists (
      select 1 from public.telemetry_operational_events event
      where event.installation_id = link.installation_id
        and event.user_id = link.user_id
        and event.received_at between link.linked_at and link.unlinked_at
    );
  get diagnostics v_links_deleted = row_count;

  return jsonb_build_object(
    'product_deleted', v_product_deleted,
    'operational_deleted', v_operational_deleted,
    'rate_windows_deleted', v_rate_windows_deleted,
    'links_deleted', v_links_deleted
  );
end;
$$;

revoke all on function public.telemetry_apply_retention() from public, anon, authenticated;
grant execute on function public.telemetry_apply_retention() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'desktop-telemetry-retention-daily';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'desktop-telemetry-retention-daily',
  '0 4 * * *',
  $cron$select public.telemetry_apply_retention();$cron$
);
