# Telemetry backend rollout — 2026-09-05

## Scope and state

Production project: `rlhjpovwwsqdeklhnvfl`.
Backend branch: `codex/desktop-telemetry-backend`; deployment started from
`19c6e42`, followed by the reviewed public-key configuration fix in this commit.
No desktop release, website/privacy publication, branch push, or main merge is
included in this rollout record.

Applied migrations, in order:

1. `20260904130000_create_desktop_telemetry.sql`
2. `20260905150000_fence_telemetry_account_unlink.sql`

The already-deployed Luna and catalog-visibility migrations were restored
byte-for-byte from backend main in `19c6e42`; they were not reapplied. Final
`supabase db push --linked --dry-run` reports the remote database is up to date.

## Retention override: cleanup is DISABLED

The user explicitly rejected automatic deletion after 90 days / 13 months.
Do not treat the foundation migration's retention defaults or the draft privacy
page as an approved policy. Production job `desktop-telemetry-retention-daily`
(job ID 1) was disabled with the user's approval:

```sql
select cron.alter_job(job_id := jobid, active := false)
from cron.job
where jobid = 1
  and jobname = 'desktop-telemetry-retention-daily'
  and command = 'select public.telemetry_apply_retention();';
```

After smoke testing, the job is still `active=false` with **zero recorded runs**.
No retention function was manually executed. No telemetry records were deleted.
This is a verified production scheduler override, not an edited historical
migration. A fresh database applying the foundation migration still creates an
active job: do not provision/roll out another environment without carrying over
the disabled state or an explicitly approved forward migration. Never re-enable
cleanup as part of a deployment retry.

The disabled job also included short-lived rate-window and old account-link
maintenance. That maintenance is paused too; decide it separately from event
retention rather than silently restoring the combined deletion job.

`app/privacy/page.tsx` still promises the unapproved 90-day/13-month periods.
**Do not publish that draft.** Retention wording and policy need reconciliation
before the client rollout; an indefinite-retention policy has not been approved.

## Function deployment and authentication remediation

Deployed only `telemetry-ingest`, using:

```sh
supabase functions deploy telemetry-ingest \
  --project-ref rlhjpovwwsqdeklhnvfl \
  --no-verify-jwt --use-api \
  --import-map supabase/functions/deno.json
```

The first bundling attempt omitted the explicit import map and failed before
deployment. Retrying with the existing map resolved the shared SDK import.

The initial live smoke then found application-level 401s for the valid desktop
legacy anon key. Management API metadata matched that key to the current public
project key; REST recognized it as anon. Its SHA-256 did not match the hosted
reserved `SUPABASE_ANON_KEY` digest. The function's strict equality check therefore
rejected it before schema validation.

Configured `WOVEN_TELEMETRY_PUBLIC_ANON_KEY` with the independently verified
current **public legacy anon key**, without printing or persisting key values in
evidence. The function uses this explicit override, with the old reserved-key
fallback for local setups. Invalid user JWTs still cannot fall back to anonymous
admission. No shared billing/auth function or desktop credential was changed.

The index-handler regression first failed with expected 200 / actual 401.
`pnpm exec vitest run tests/telemetry` then passed **80/80 tests across 4 files**.
Independent focused review approved the complete auth fix, regression, and docs
with no findings. The corrected function was subsequently deployed successfully.

## Production smoke evidence

Eight bounded HTTP checks passed:

| Check | Result |
| --- | --- |
| Missing credential | 401 |
| Invalid user Bearer with valid public apikey | 401 |
| Unknown public key | 401 |
| One product + one operational event | 200, 2 accepted |
| Retry the exact same batch | 200, 2 acknowledged |
| Synthetic forbidden `prompt` property | 400, 0 accepted |
| Anonymous direct table insert | 401 |
| Anonymous direct ingestion RPC | 401 |

Read-only SQL verification found exactly **one row in each stream**, proving the
retry did not duplicate rows. Both rows have null user ID, empty properties,
`development` environment, and `internal` release channel. They are synthetic
deployment probes, not real desktop activity. They are retained, not deleted.

- Installation: `a6bb6ac0-11dc-4617-943f-b25d0db63928`
- Product event: `f4cc7e5b-4c64-4e9b-8d25-5cfbeceea340`
- Operational event: `c9baeb7e-039e-4623-b886-6b265b221027`
- Local smoke script: `/private/tmp/woven-telemetry-production-smoke.4rVwnK/smoke.mjs`

The earlier rejected probe used installation
`299dc65c-3d6e-47a7-9aef-f7471d3e0bb9`; it received 401 before admission.

All four telemetry tables have RLS enabled and deny SELECT/INSERT to both anon
and authenticated roles. Both telemetry RPCs deny EXECUTE to those roles and
grant it to service_role. No production user rows were inspected.

This smoke did not create/login a user, exercise a real signed-in user JWT, run a
production rate-limit storm, or establish a production performance budget. Those
must not be claimed from this evidence. Earlier local tests remain separate.
