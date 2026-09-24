# Error diagnostics backend rollout — 2026-09-25

## Scope and state

Production project: `rlhjpovwwsqdeklhnvfl`.
Branch: `feat/error-diagnostics`. It was deployed from `5d4a010` (backend) and `36a87db` (privacy page, not deployed).
Nothing in this rollout includes a push, a merge to main, a website deploy, or a desktop release.

The user approved the deploy, the pre-request guard, and the rate limits on 2026-09-25.

**Preflight:**
- `supabase db push --linked --dry-run` listed exactly the two migrations below.
- The `authenticator` role settings had no `pgrst.db_pre_request` and no per-database override. They were `session_preload_libraries=supautils, safeupdate`, `statement_timeout=8s` and `lock_timeout=8s`.

**Migrations applied**, in this order:
1. `20260924130000_create_diagnostic_error_records.sql`
2. `20260924140000_guard_locked_rpc_calls.sql`

**Functions deployed:** `diagnostic-report` (new) and `telemetry-ingest` (its auth helper moved to `_shared/auth.ts`). The same command was used for both:

```sh
supabase functions deploy <fn> --project-ref rlhjpovwwsqdeklhnvfl \
  --no-verify-jwt --use-api --import-map supabase/functions/deno.json
```

## Why the pre-request guard exists

On `supabase/postgres:17.6.1.111`, which is the image production runs, any call to a function the caller has no EXECUTE on segfaults the Postgres backend and restarts the whole database. This is supabase/postgres#2377, and the issue is still open.
- Locally, it reproduced through PostgREST with the public key, even for a one-line `select 1` function.
- 48 `public` functions are locked for anon.
- The guard (`public.pgrst_pre_request`) refuses those calls with a normal 42501 before PostgREST runs them. Nothing else changes.

To remove it once Supabase fixes the bug:
1. `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';`
2. Only then, drop the functions.

**Never** drop the functions first: that fails every API request.

## Verification

- **The guard is live.** `pg_stat_statements` calls to `select "public"."pgrst_pre_request"()` went from 0 to 3 after three ordinary API requests.
- **The crash fix works in production.** After the guard was confirmed live, an anon call to `telemetry_admit_and_insert` returned 401 `permission denied for function`, and the API stayed healthy afterwards (no 503).
- **Smoke checks: 10/10.**

| Check | Result |
| --- | --- |
| `diagnostic-report`: missing credential | 401 |
| `diagnostic-report`: invalid user Bearer + public apikey | 401 |
| `diagnostic-report`: valid record + record with a `/Users/…` code_site | 200; one accepted, one rejected `invalid_schema` |
| `diagnostic-report`: identical retry | 200, idempotent |
| `diagnostic-report`: body over 64 KB | 413 |
| Anon direct insert into `diagnostic_error_records` | 401 |
| `telemetry-ingest`: missing credential | 401 |
| `telemetry-ingest`: invalid user Bearer + public apikey | 401 |
| `telemetry-ingest`: valid current-app batch | 200, accepted |
| `telemetry-ingest`: forbidden `prompt` property | 400 |

- **Cron.**
  - `diagnostic-error-records-retention-daily` is active at `0 5 * * *`. It deletes rows older than 90 days, as the privacy page promises.
  - `desktop-telemetry-retention-daily` is still **inactive**, unchanged from the 2026-09-05 override.

**Synthetic probe rows** are retained, not deleted:
- installation `324dee06-a942-4cd9-96d2-8bddb0a53de3`;
- diagnostic record `bc7b5d8e-7d83-4d2f-bf0b-e615424d2eb5` (app_version `0.0.0`);
- telemetry event `c308b610-533f-4445-a3ff-897f32231662` (environment `development`, channel `internal`).

## Rate limits (user-approved)

Each limit is per 10 minutes and applies to diagnostic records only:
- 60 per installation;
- 120 per account;
- a global backstop of 5000.

Over the limit, the whole batch gets 429 with `retry_after_ms` and a `Retry-After` header. The desktop app also caps itself at 3 per 10 minutes per failure kind and 50 per day.

## Still to do before the desktop release

- Publish the privacy page (`36a87db`) before the app version that sends reports ships.
- Merge `feat/error-diagnostics`.
