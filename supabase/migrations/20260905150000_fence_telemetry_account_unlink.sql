-- Preserve the already-applied foundation migration; replace only link semantics.
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
  v_has_new_sign_out boolean := false;
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
      and event ->> 'stage' = 'attempted'
  ) into v_has_sign_out;

  select exists (
    select 1
    from jsonb_array_elements(v_events) event
    where event ->> 'stream' = 'product'
      and event ->> 'event_name' = 'sign_out'
      and event ->> 'stage' = 'attempted'
      and not exists (
        select 1
        from public.telemetry_product_events stored
        where stored.event_id = (event ->> 'event_id')::uuid
      )
  ) into v_has_new_sign_out;

  if p_user_id is not null and not v_has_sign_out then
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

  -- Only the still-authenticated pre-clear attempt may unlink its own interval.
  -- Delayed anonymous history and signout for another account cannot mutate links.
  -- Replays still suppress normal linking, but must not apply unlink again.
  if v_has_new_sign_out and p_user_id is not null then
    update public.telemetry_installation_account_links
    set last_seen_at = greatest(last_seen_at, v_received_at),
        unlinked_at = greatest(linked_at, v_received_at)
    where installation_id = v_installation_id
      and unlinked_at is null
      and user_id = p_user_id;
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
