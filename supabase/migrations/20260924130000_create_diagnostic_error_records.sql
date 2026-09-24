-- Stage 2 of automatic error diagnostics: scrubbed error text records.
-- pg_cron and pgcrypto are already enabled by
-- 20260904130000_create_desktop_telemetry.sql; not re-declared here.

create table public.diagnostic_error_records (
  id uuid primary key,
  received_at timestamptz not null default now(),
  occurred_at timestamptz not null,
  installation_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  app_version text not null check (char_length(app_version) between 1 and 64),
  build text not null check (char_length(build) between 1 and 32),
  source text not null check (source in ('turn', 'compaction', 'tool', 'export')),
  failure_site text not null check (char_length(failure_site) between 1 and 64),
  error_class text check (char_length(error_class) between 1 and 64),
  http_status smallint check (http_status between 100 and 599),
  native_error_domain text check (char_length(native_error_domain) between 1 and 64),
  native_error_code integer,
  -- Mirrors _shared/telemetry/validation.ts's isValidSite: same pattern, plus
  -- the 96-char path-length cap the pattern itself can't express (no
  -- lookahead in POSIX ARE either), checked here via split_part.
  code_site text check (
    code_site ~ '^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/){0,3}[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:swift|ts|mts|js|mjs):[0-9]{1,6}$'
    and char_length(split_part(code_site, ':', 1)) <= 96
  ),
  woven_job_id uuid,
  chat_id uuid,
  turn_id uuid,
  operation_id uuid,
  model_id text check (model_id ~ '^[A-Za-z0-9_.:/@-]{1,128}$'),
  errors jsonb not null check (
    jsonb_typeof(errors) = 'array'
    and jsonb_array_length(errors) between 1 and 4
  ),
  -- Row cap with headroom over validation.ts's 16 KB (16384) JSON-bytes
  -- budget: pg_column_size(row(...)) measures Postgres's own binary/jsonb
  -- storage, which is NOT the same number as JSON.stringify(record).length.
  -- A record at exactly 16384 JSON bytes can be a ~16414-byte row (anon) or
  -- a ~16430-byte row (authenticated, extra user_id) once envelope columns
  -- (received_at, installation_id, etc.) are included, which would fail a
  -- same-sized DB cap even though validation.ts already accepted it.
  -- 17408 (17 KiB) gives that margin. This constraint is named so the RPC
  -- below can tell "too big" apart from every other constraint failure.
  constraint diagnostic_error_records_row_size_check check (
    pg_column_size(row(
      id, received_at, occurred_at, installation_id, user_id, app_version,
      build, source, failure_site, error_class, http_status,
      native_error_domain, native_error_code, code_site, woven_job_id,
      chat_id, turn_id, operation_id, model_id, errors
    )) <= 17408
  )
);

create index diagnostic_error_records_received_at_idx
  on public.diagnostic_error_records (received_at desc);
create index diagnostic_error_records_occurred_at_idx
  on public.diagnostic_error_records (occurred_at desc);
create index diagnostic_error_records_installation_idx
  on public.diagnostic_error_records (installation_id, occurred_at desc);
create index diagnostic_error_records_user_idx
  on public.diagnostic_error_records (user_id, occurred_at desc)
  where user_id is not null;
create index diagnostic_error_records_chat_idx
  on public.diagnostic_error_records (chat_id, occurred_at desc)
  where chat_id is not null;
create index diagnostic_error_records_turn_idx
  on public.diagnostic_error_records (turn_id, occurred_at desc)
  where turn_id is not null;
create index diagnostic_error_records_operation_idx
  on public.diagnostic_error_records (operation_id, occurred_at desc)
  where operation_id is not null;
create index diagnostic_error_records_woven_job_idx
  on public.diagnostic_error_records (woven_job_id, occurred_at desc)
  where woven_job_id is not null;
create index diagnostic_error_records_failure_site_idx
  on public.diagnostic_error_records (failure_site, occurred_at desc);

alter table public.diagnostic_error_records enable row level security;

-- RLS is on with no policies: service role only. Do not add anon or
-- authenticated policies here without a fresh privacy review.
revoke all on public.diagnostic_error_records from public, anon, authenticated;
grant all on public.diagnostic_error_records to service_role;

-- Scoped to diagnostic-report specifically, not shared with
-- telemetry_ingestion_rate_windows: the two surfaces have different limits
-- (60/120 per 10 min here vs. 600/1200 for telemetry), and sharing one
-- counter would let one product's traffic burn the other's budget. Same
-- shape and window convention as telemetry's table on purpose, so the
-- reasoning there (sha256(subject id) as the row key, one row per rolling
-- 10-minute bucket) carries over unchanged.
create table public.diagnostic_report_rate_windows (
  subject_type text not null check (subject_type in ('installation', 'account')),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  accepted_count integer not null check (accepted_count >= 0),
  primary key (subject_type, subject_hash, window_start)
);

alter table public.diagnostic_report_rate_windows enable row level security;
revoke all on public.diagnostic_report_rate_windows from public, anon, authenticated;
grant all on public.diagnostic_report_rate_windows to service_role;

create or replace function public.diagnostic_report_admit_and_insert(
  p_records jsonb,
  p_installation_id uuid,
  p_app_version text,
  p_build text,
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
  v_window_start timestamptz := coalesce(p_received_at, now());
  v_installation_hash text;
  v_account_hash text;
  v_new_count integer;
  v_installation_count integer := 0;
  v_account_count integer := 0;
  v_global_count integer := 0;
  v_actually_new_count integer := 0;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_record jsonb;
  v_record_id text;
  v_constraint_name text;
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'invalid_diagnostic_batch';
  end if;

  v_new_count := jsonb_array_length(p_records);
  if v_new_count = 0 then
    return jsonb_build_object(
      'accepted', '[]'::jsonb, 'rejected', '[]'::jsonb, 'retry_after_ms', null
    );
  end if;

  -- Known limit, shared with telemetry_ingestion_rate_windows's identical
  -- design: a client that rotates installation_id defeats the per-
  -- installation counter (each new id starts a fresh budget). The global
  -- cap below is the backstop for that specific evasion, not a fix for it.
  v_installation_hash := encode(extensions.digest(p_installation_id::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('diagnostic_installation:' || v_installation_hash, 0));

  if p_user_id is not null then
    v_account_hash := encode(extensions.digest(p_user_id::text, 'sha256'), 'hex');
    perform pg_advisory_xact_lock(hashtextextended('diagnostic_account:' || v_account_hash, 0));
  end if;

  select coalesce(sum(accepted_count), 0)::integer
  into v_installation_count
  from public.diagnostic_report_rate_windows
  where subject_type = 'installation'
    and subject_hash = v_installation_hash
    and window_start > v_received_at - interval '10 minutes';

  if p_user_id is not null then
    select coalesce(sum(accepted_count), 0)::integer
    into v_account_count
    from public.diagnostic_report_rate_windows
    where subject_type = 'account'
      and subject_hash = v_account_hash
      and window_start > v_received_at - interval '10 minutes';
  end if;

  -- Global cap across all callers, regardless of installation/account:
  -- every accepted record has exactly one 'installation'-type row, so
  -- summing only that subject_type counts each record once (summing both
  -- subject_types would double-count authenticated records).
  select coalesce(sum(accepted_count), 0)::integer
  into v_global_count
  from public.diagnostic_report_rate_windows
  where subject_type = 'installation'
    and window_start > v_received_at - interval '10 minutes';

  -- All or nothing per batch: unlike telemetry's per-event rate limiting,
  -- a batch that would push any counter over its limit is rejected whole,
  -- with nothing inserted and nothing counted against any window. This
  -- pre-flight check uses the submitted count (v_new_count) as a
  -- conservative upper bound; the window counters themselves are updated
  -- after the insert loop below with the count of records actually newly
  -- written, not this upper bound.
  if v_installation_count + v_new_count > 60
    or (p_user_id is not null and v_account_count + v_new_count > 120)
    or v_global_count + v_new_count > 5000
  then
    return jsonb_build_object(
      'accepted', '[]'::jsonb, 'rejected', '[]'::jsonb, 'retry_after_ms', 600000
    );
  end if;

  -- Each record is inserted inside its own exception-handled subtransaction:
  -- validation.ts's rules are close to, but not a strict subset of, this
  -- table's constraints -- a record can sit exactly at validation.ts's
  -- 16384-byte JSON budget yet exceed this table's row-size cap, because
  -- Postgres's own row/jsonb storage accounting differs from
  -- JSON.stringify(record).length. A bulk INSERT ... SELECT would abort the
  -- whole statement (and therefore the whole batch, a 500) on that one row;
  -- a per-record BEGIN/EXCEPTION block instead turns it into a single
  -- rejected entry and lets every other record in the batch still land.
  for v_record in select * from jsonb_array_elements(p_records)
  loop
    v_record_id := v_record ->> 'record_id';
    begin
      insert into public.diagnostic_error_records (
        id, received_at, occurred_at, installation_id, user_id, app_version,
        build, source, failure_site, error_class, http_status,
        native_error_domain, native_error_code, code_site, woven_job_id,
        chat_id, turn_id, operation_id, model_id, errors
      ) values (
        (v_record ->> 'record_id')::uuid,
        v_received_at,
        (v_record ->> 'occurred_at')::timestamptz,
        p_installation_id,
        p_user_id,
        p_app_version,
        p_build,
        v_record ->> 'source',
        v_record ->> 'failure_site',
        v_record ->> 'error_class',
        nullif(v_record ->> 'http_status', '')::smallint,
        v_record ->> 'native_error_domain',
        nullif(v_record ->> 'native_error_code', '')::integer,
        v_record ->> 'code_site',
        nullif(v_record ->> 'woven_job_id', '')::uuid,
        nullif(v_record ->> 'chat_id', '')::uuid,
        nullif(v_record ->> 'turn_id', '')::uuid,
        nullif(v_record ->> 'operation_id', '')::uuid,
        v_record ->> 'model_id',
        v_record -> 'errors'
      )
      on conflict (id) do nothing;

      -- FOUND is true only when a row was actually written: on conflict do
      -- nothing means an idempotent resubmission still counts as accepted
      -- (it did not error), but it must NOT count as newly inserted for the
      -- rate-limit windows below, which track real new writes only.
      v_accepted := v_accepted || to_jsonb(v_record_id);
      if found then
        v_actually_new_count := v_actually_new_count + 1;
      end if;
    exception
      -- Only a genuinely bad record is rejected here: class 23 (integrity
      -- constraint violation -- includes check_violation, so the row-size
      -- cap and every other CHECK on this table) and class 22 (data
      -- exception -- a bad cast, e.g. an out-of-range smallint). Every
      -- other error (lock_timeout, deadlock_detected, serialization
      -- failure, and so on -- all transient, none of them mean this record
      -- is invalid) is deliberately left uncaught: it propagates out of
      -- this function, the whole call fails, the edge function returns a
      -- 5xx, and the client retries the whole batch instead of treating a
      -- transient DB condition as a permanent per-record rejection and
      -- deleting the record from its local queue.
      when integrity_constraint_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name = 'diagnostic_error_records_row_size_check' then
          v_rejected := v_rejected || jsonb_build_array(
            jsonb_build_object('record_id', v_record_id, 'reason', 'payload_too_large')
          );
        else
          v_rejected := v_rejected || jsonb_build_array(
            jsonb_build_object('record_id', v_record_id, 'reason', 'invalid_schema')
          );
        end if;
      when data_exception then
        v_rejected := v_rejected || jsonb_build_array(
          jsonb_build_object('record_id', v_record_id, 'reason', 'invalid_schema')
        );
    end;
  end loop;

  -- Rate-limit windows are updated here, after the loop, with the count of
  -- records actually newly written -- not the pre-flight v_new_count used
  -- for the upfront gate above. A duplicate-of-an-already-stored id or a
  -- record the database itself rejected consumes no budget.
  if v_actually_new_count > 0 then
    insert into public.diagnostic_report_rate_windows (
      subject_type, subject_hash, window_start, accepted_count
    ) values (
      'installation', v_installation_hash, v_window_start, v_actually_new_count
    )
    on conflict (subject_type, subject_hash, window_start) do update
      set accepted_count = public.diagnostic_report_rate_windows.accepted_count + excluded.accepted_count;

    if p_user_id is not null then
      insert into public.diagnostic_report_rate_windows (
        subject_type, subject_hash, window_start, accepted_count
      ) values (
        'account', v_account_hash, v_window_start, v_actually_new_count
      )
      on conflict (subject_type, subject_hash, window_start) do update
        set accepted_count = public.diagnostic_report_rate_windows.accepted_count + excluded.accepted_count;
    end if;
  end if;

  return jsonb_build_object(
    'accepted', v_accepted, 'rejected', v_rejected, 'retry_after_ms', null
  );
end;
$$;

revoke all on function public.diagnostic_report_admit_and_insert(
  jsonb, uuid, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.diagnostic_report_admit_and_insert(
  jsonb, uuid, text, text, uuid, timestamptz
) to service_role;

create or replace function public.diagnostic_error_records_apply_retention()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted bigint;
  v_rate_windows_deleted bigint;
begin
  delete from public.diagnostic_error_records
  where received_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;

  delete from public.diagnostic_report_rate_windows
  where window_start <= now() - interval '10 minutes';
  get diagnostics v_rate_windows_deleted = row_count;

  return jsonb_build_object(
    'deleted', v_deleted, 'rate_windows_deleted', v_rate_windows_deleted
  );
end;
$$;

revoke all on function public.diagnostic_error_records_apply_retention()
  from public, anon, authenticated;
grant execute on function public.diagnostic_error_records_apply_retention()
  to service_role;

-- Separate, newly-approved retention decision (privacy policy draft,
-- 2026-09-24): 90-day deletion for error reports specifically. This is
-- independent of desktop-telemetry-retention-daily, which production
-- disabled out of band pending its own retention approval -- see
-- docs/superpowers/telemetry-production-rollout-2026-09-05.md. Do not use
-- this job to silently re-enable that unrelated, still-unapproved job.
select cron.schedule(
  'diagnostic-error-records-retention-daily',
  '0 5 * * *',
  $cron$select public.diagnostic_error_records_apply_retention();$cron$
);
