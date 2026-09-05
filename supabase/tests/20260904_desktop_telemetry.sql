begin;

select plan(42);

create function pg_temp.telemetry_event(
  p_event_id uuid,
  p_stream text,
  p_event_name text,
  p_stage text,
  p_installation_id uuid,
  p_priority integer,
  p_properties jsonb default '{}'::jsonb
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'event_id', p_event_id,
    'catalog_version', 1,
    'stream', p_stream,
    'event_name', p_event_name,
    'occurred_at', '2026-09-04T06:03:21.125Z',
    'source', 'desktop',
    'source_sequence', 1,
    'host_observed_sequence', 1,
    'installation_id', p_installation_id,
    'app_launch_id', '30000000-0000-4000-8000-000000000001',
    'stage', p_stage,
    'priority', p_priority,
    'app', jsonb_build_object(
      'version', '0.1.82',
      'build', '182',
      'environment', 'production',
      'release_channel', 'stable'
    ),
    'system', jsonb_build_object(
      'macos_major_minor', '15.6',
      'architecture', 'arm64'
    ),
    'properties', p_properties
  );
$$;

create function pg_temp.telemetry_batch(p_events jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'catalog_version', 1,
    'batch_id', gen_random_uuid(),
    'events', p_events
  );
$$;

select has_table('public', 'telemetry_product_events', 'product telemetry table exists');
select has_table('public', 'telemetry_operational_events', 'operational telemetry table exists');
select has_table('public', 'telemetry_installation_account_links', 'installation link table exists');
select has_table('public', 'telemetry_ingestion_rate_windows', 'rate window table exists');

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'telemetry_product_events',
        'telemetry_operational_events',
        'telemetry_installation_account_links',
        'telemetry_ingestion_rate_windows'
      )
  ),
  'RLS is enabled on every telemetry table'
);

select ok(
  (
    select bool_and(not has_table_privilege('anon', format('public.%I', table_name), privilege))
    from unnest(array[
      'telemetry_product_events',
      'telemetry_operational_events',
      'telemetry_installation_account_links',
      'telemetry_ingestion_rate_windows'
    ]) table_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  ),
  'anonymous clients have no telemetry table privileges'
);

select ok(
  (
    select bool_and(not has_table_privilege('authenticated', format('public.%I', table_name), privilege))
    from unnest(array[
      'telemetry_product_events',
      'telemetry_operational_events',
      'telemetry_installation_account_links',
      'telemetry_ingestion_rate_windows'
    ]) table_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  ),
  'authenticated clients have no telemetry table privileges'
);

select ok(
  (
    select bool_and(has_table_privilege('service_role', format('public.%I', table_name), privilege))
    from unnest(array[
      'telemetry_product_events',
      'telemetry_operational_events',
      'telemetry_installation_account_links',
      'telemetry_ingestion_rate_windows'
    ]) table_name
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  ),
  'service role owns telemetry table access'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.telemetry_admit_and_insert(jsonb,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'service role can execute ingestion transaction'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.telemetry_admit_and_insert(jsonb,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute ingestion transaction'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.telemetry_apply_retention()',
    'EXECUTE'
  ),
  'service role can execute retention'
);

select has_table('public', 'analytics_events', 'legacy analytics table remains available');

insert into auth.users (id, email, created_at)
values
  ('30000000-0000-4000-8000-000000000010', 'telemetry-one@example.test', now()),
  ('30000000-0000-4000-8000-000000000011', 'telemetry-two@example.test', now()),
  ('30000000-0000-4000-8000-000000000012', 'telemetry-three@example.test', now());

select is(
  jsonb_array_length(
    public.telemetry_admit_and_insert(
      pg_temp.telemetry_batch(jsonb_build_array(
        pg_temp.telemetry_event(
          '30000000-0000-4000-8000-000000000020',
          'product',
          'app_lifecycle',
          'foregrounded',
          '30000000-0000-4000-8000-000000000030',
          2
        ),
        pg_temp.telemetry_event(
          '30000000-0000-4000-8000-000000000021',
          'operational',
          'telemetry_delivery_summary',
          'reported',
          '30000000-0000-4000-8000-000000000030',
          3,
          '{"recorded_count":2,"accepted_count":2}'::jsonb
        )
      )),
      '30000000-0000-4000-8000-000000000010',
      now()
    ) -> 'accepted'
  ),
  2,
  'a valid mixed batch accepts both events'
);

select is(
  (select count(*)::integer from public.telemetry_product_events where event_id = '30000000-0000-4000-8000-000000000020'),
  1,
  'product events route only to the product table'
);

select is(
  (select count(*)::integer from public.telemetry_operational_events where event_id = '30000000-0000-4000-8000-000000000021'),
  1,
  'operational events route only to the operational table'
);

select is(
  (select user_id from public.telemetry_product_events where event_id = '30000000-0000-4000-8000-000000000020'),
  '30000000-0000-4000-8000-000000000010'::uuid,
  'stored account identity comes from the server argument'
);

select is(
  jsonb_array_length(
    public.telemetry_admit_and_insert(
      pg_temp.telemetry_batch(jsonb_build_array(
        pg_temp.telemetry_event(
          '30000000-0000-4000-8000-000000000020',
          'product',
          'app_lifecycle',
          'foregrounded',
          '30000000-0000-4000-8000-000000000030',
          2
        ),
        pg_temp.telemetry_event(
          '30000000-0000-4000-8000-000000000021',
          'operational',
          'telemetry_delivery_summary',
          'reported',
          '30000000-0000-4000-8000-000000000030',
          3
        )
      )),
      '30000000-0000-4000-8000-000000000010',
      now()
    ) -> 'accepted'
  ),
  2,
  'an idempotent retry acknowledges both duplicate event IDs'
);

select is(
  (
    (select count(*) from public.telemetry_product_events where event_id = '30000000-0000-4000-8000-000000000020') +
    (select count(*) from public.telemetry_operational_events where event_id = '30000000-0000-4000-8000-000000000021')
  )::integer,
  2,
  'idempotent retries do not duplicate rows'
);

select is(
  (
    select sum(accepted_count)::integer
    from public.telemetry_ingestion_rate_windows
    where subject_type = 'installation'
      and subject_hash = encode(extensions.digest('30000000-0000-4000-8000-000000000030', 'sha256'), 'hex')
  ),
  2,
  'idempotent retries do not consume rate capacity twice'
);

select is(
  (
    select count(*)::integer
    from public.telemetry_installation_account_links
    where installation_id = '30000000-0000-4000-8000-000000000030'
      and user_id = '30000000-0000-4000-8000-000000000010'
      and unlinked_at is null
  ),
  1,
  'retries refresh one idempotent active account link'
);

do $$
begin
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000022',
        'product',
        'app_lifecycle',
        'foregrounded',
        '30000000-0000-4000-8000-000000000030',
        2
      )
    )),
    '30000000-0000-4000-8000-000000000011',
    now() + interval '1 second'
  );
end;
$$;

select ok(
  (
    select count(*) = 2
      and count(*) filter (where unlinked_at is null and user_id = '30000000-0000-4000-8000-000000000011') = 1
      and count(*) filter (where unlinked_at is not null and user_id = '30000000-0000-4000-8000-000000000010') = 1
    from public.telemetry_installation_account_links
    where installation_id = '30000000-0000-4000-8000-000000000030'
  ),
  'switching accounts closes the prior interval and opens a new one'
);

do $$
begin
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000023',
        'product',
        'sign_out',
        'succeeded',
        '30000000-0000-4000-8000-000000000030',
        2
      )
    )),
    null,
    now() + interval '2 seconds'
  );
end;
$$;

select is(
  (
    select count(*)::integer
    from public.telemetry_installation_account_links
    where installation_id = '30000000-0000-4000-8000-000000000030'
      and unlinked_at is null
  ),
  1,
  'a delayed anonymous sign-out cannot close the newer account interval'
);

do $$ begin
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(pg_temp.telemetry_event(
      '30000000-0000-4000-8000-000000001024', 'product', 'sign_out', 'attempted',
      '30000000-0000-4000-8000-000000000030', 2))),
    '30000000-0000-4000-8000-000000000010', now() + interval '3 seconds');
end $$;
select is((select count(*)::integer from public.telemetry_installation_account_links
  where installation_id = '30000000-0000-4000-8000-000000000030'
  and user_id = '30000000-0000-4000-8000-000000000011' and unlinked_at is null),
  1, 'a delayed authenticated signout for A neither opens A nor closes B');

select is(jsonb_array_length(public.telemetry_admit_and_insert(
  pg_temp.telemetry_batch(jsonb_build_array(pg_temp.telemetry_event(
    '30000000-0000-4000-8000-000000001024', 'product', 'sign_out', 'attempted',
    '30000000-0000-4000-8000-000000000030', 2))),
  '30000000-0000-4000-8000-000000000010', now() + interval '3.5 seconds') -> 'accepted'),
  1, 'an authenticated duplicate signout attempt remains idempotently accepted');
select is((select count(*)::integer from public.telemetry_installation_account_links
  where installation_id = '30000000-0000-4000-8000-000000000030'
  and user_id = '30000000-0000-4000-8000-000000000011' and unlinked_at is null),
  1, 'a duplicate signout attempt for A cannot replace the newer active B link');

do $$ begin
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(pg_temp.telemetry_event(
      '30000000-0000-4000-8000-000000001025', 'product', 'sign_out', 'attempted',
      '30000000-0000-4000-8000-000000000030', 2))),
    '30000000-0000-4000-8000-000000000011', now() + interval '4 seconds');
end $$;
select is((select count(*)::integer from public.telemetry_installation_account_links
  where installation_id = '30000000-0000-4000-8000-000000000030' and unlinked_at is null),
  0, 'a pre-clear signout attempt authenticated as B closes only B');

do $$ begin
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(pg_temp.telemetry_event(
      '30000000-0000-4000-8000-000000001025', 'product', 'sign_out', 'attempted',
      '30000000-0000-4000-8000-000000000030', 2))),
    '30000000-0000-4000-8000-000000000011', now() + interval '5 seconds');
end $$;
select is((select count(*)::integer from public.telemetry_installation_account_links
  where installation_id = '30000000-0000-4000-8000-000000000030' and unlinked_at is null),
  0, 'a duplicate signout attempt cannot reopen the signed-out account');

do $$
begin
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000080',
        'product',
        'app_lifecycle',
        'foregrounded',
        '30000000-0000-4000-8000-000000000081',
        2
      )
    )),
    '30000000-0000-4000-8000-000000000010',
    now() + interval '10 seconds'
  );
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000082',
        'product',
        'sign_out',
        'succeeded',
        '30000000-0000-4000-8000-000000000081',
        2
      )
    )),
    null,
    now() + interval '11 seconds'
  );
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000083',
        'product',
        'app_lifecycle',
        'foregrounded',
        '30000000-0000-4000-8000-000000000081',
        2
      )
    )),
    '30000000-0000-4000-8000-000000000011',
    now() + interval '12 seconds'
  );
end;
$$;

select is(
  jsonb_array_length(
    public.telemetry_admit_and_insert(
      pg_temp.telemetry_batch(jsonb_build_array(
        pg_temp.telemetry_event(
          '30000000-0000-4000-8000-000000000082',
          'product',
          'sign_out',
          'succeeded',
          '30000000-0000-4000-8000-000000000081',
          2
        )
      )),
      null,
      now() + interval '13 seconds'
    ) -> 'accepted'
  ),
  1,
  'retrying the historical sign-out idempotently accepts its event ID'
);

select ok(
  (
    select count(*) = 1
      and count(*) filter (
        where user_id = '30000000-0000-4000-8000-000000000011'
      ) = 1
    from public.telemetry_installation_account_links
    where installation_id = '30000000-0000-4000-8000-000000000081'
      and unlinked_at is null
  ),
  'retrying an old sign-out cannot close a newer active account link'
);

do $$
begin
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000024',
        'operational',
        'storage_incident',
        'failed',
        '30000000-0000-4000-8000-000000000031',
        0,
        jsonb_build_object(
          'error_domain', 'storage',
          'error_code', 'write_failed',
          'error_fingerprint', repeat('a', 64)
        )
      )
    )),
    null,
    now()
  );
end;
$$;

select is(
  (
    select error_domain || ':' || error_code || ':' || error_fingerprint
    from public.telemetry_operational_events
    where event_id = '30000000-0000-4000-8000-000000000024'
  ),
  'storage:write_failed:' || repeat('a', 64),
  'operational error dimensions are generated from validated properties'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'telemetry_operational_events'
      and indexname = 'telemetry_operational_error_idx'
  ),
  'operational error dimensions have a dedicated index'
);

insert into public.telemetry_ingestion_rate_windows (
  subject_type, subject_hash, window_start, accepted_count
)
values (
  'installation',
  encode(extensions.digest('30000000-0000-4000-8000-000000000032', 'sha256'), 'hex'),
  date_trunc('minute', now()),
  600
);

select is(
  public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000025',
        'product',
        'app_lifecycle',
        'foregrounded',
        '30000000-0000-4000-8000-000000000032',
        2
      )
    )),
    null,
    now()
  ) -> 'rejected' -> 0 ->> 'reason',
  'rate_limited',
  'installation traffic is capped at 600 events per rolling ten minutes'
);

select is(
  (select count(*)::integer from public.telemetry_product_events where event_id = '30000000-0000-4000-8000-000000000025'),
  0,
  'installation-rate-limited events are not stored'
);

insert into public.telemetry_ingestion_rate_windows (
  subject_type, subject_hash, window_start, accepted_count
)
values (
  'account',
  encode(extensions.digest('30000000-0000-4000-8000-000000000012', 'sha256'), 'hex'),
  date_trunc('minute', now()),
  1200
);

select is(
  public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000026',
        'product',
        'app_lifecycle',
        'foregrounded',
        '30000000-0000-4000-8000-000000000033',
        2
      )
    )),
    '30000000-0000-4000-8000-000000000012',
    now()
  ) -> 'rejected' -> 0 ->> 'reason',
  'rate_limited',
  'authenticated accounts are capped at 1200 events per rolling ten minutes'
);

select is(
  (select count(*)::integer from public.telemetry_product_events where event_id = '30000000-0000-4000-8000-000000000026'),
  0,
  'account-rate-limited events are not stored'
);

do $$
begin
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000027',
        'product',
        'app_lifecycle',
        'foregrounded',
        '30000000-0000-4000-8000-000000000034',
        2
      )
    )),
    null,
    date_trunc('minute', now()) + interval '30.123 seconds'
  );
end;
$$;

select is(
  (
    select window_start
    from public.telemetry_ingestion_rate_windows
    where subject_type = 'installation'
      and subject_hash = encode(extensions.digest('30000000-0000-4000-8000-000000000034', 'sha256'), 'hex')
  ),
  date_trunc('minute', now()) + interval '30.123 seconds',
  'rolling rate windows retain the exact server admission timestamp'
);

do $$
begin
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000040', 'product', 'app_lifecycle', 'foregrounded',
        '30000000-0000-4000-8000-000000000050', 2
      )
    )), null, now() - interval '13 months 1 day'
  );
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000041', 'product', 'app_lifecycle', 'foregrounded',
        '30000000-0000-4000-8000-000000000051', 2
      )
    )), null, now() - interval '13 months' + interval '1 day'
  );
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000042', 'operational', 'telemetry_delivery_summary', 'reported',
        '30000000-0000-4000-8000-000000000052', 3
      )
    )), null, now() - interval '91 days'
  );
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000043', 'operational', 'telemetry_delivery_summary', 'reported',
        '30000000-0000-4000-8000-000000000053', 3
      )
    )), null, now() - interval '89 days'
  );
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000044', 'product', 'app_lifecycle', 'foregrounded',
        '30000000-0000-4000-8000-000000000060', 2
      )
    )), '30000000-0000-4000-8000-000000000010', now() - interval '13 months 2 days'
  );
  perform public.telemetry_admit_and_insert(
    pg_temp.telemetry_batch(jsonb_build_array(
      pg_temp.telemetry_event(
        '30000000-0000-4000-8000-000000000045', 'product', 'sign_out', 'attempted',
        '30000000-0000-4000-8000-000000000060', 2
      )
    )), '30000000-0000-4000-8000-000000000010', now() - interval '13 months 1 day'
  );
end;
$$;

select public.telemetry_apply_retention();

select ok(
  not exists (select 1 from public.telemetry_product_events where event_id = '30000000-0000-4000-8000-000000000040')
  and exists (select 1 from public.telemetry_product_events where event_id = '30000000-0000-4000-8000-000000000041'),
  'product retention deletes only rows older than 13 months'
);

select ok(
  not exists (select 1 from public.telemetry_operational_events where event_id = '30000000-0000-4000-8000-000000000042')
  and exists (select 1 from public.telemetry_operational_events where event_id = '30000000-0000-4000-8000-000000000043'),
  'operational retention deletes only rows older than 90 days'
);

select ok(
  not exists (
    select 1 from public.telemetry_ingestion_rate_windows
    where window_start <= now() - interval '10 minutes'
  )
  and exists (
    select 1 from public.telemetry_ingestion_rate_windows
    where window_start > now() - interval '10 minutes'
  ),
  'retention deletes expired rate windows and preserves current windows'
);

select is(
  (
    select count(*)::integer
    from public.telemetry_installation_account_links
    where installation_id = '30000000-0000-4000-8000-000000000060'
  ),
  0,
  'retention removes ended installation links after their references age out'
);

select is(
  (
    select count(*)::integer
    from public.telemetry_installation_account_links
    where installation_id = '30000000-0000-4000-8000-000000000030'
      and user_id = '30000000-0000-4000-8000-000000000010'
  ),
  1,
  'retention preserves an ended link while a referenced event remains'
);

select is(
  (
    select count(*)::integer
    from cron.job
    where jobname = 'desktop-telemetry-retention-daily'
      and schedule = '0 4 * * *'
      and active
  ),
  1,
  'the named daily retention cron schedule is active'
);

select * from finish();

rollback;
