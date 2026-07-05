# Task 3 Report: Add Migration For Already-Applied Databases

## What changed
- Added `supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql`.
- The migration upserts the two enabled Google Lite catalog rows:
  - `google/nano-banana-2-lite`
  - `google/nano-banana-2-lite/edit`
- It disables the old Fal rows and tags them with `superseded_by`:
  - `fal-ai/nano-banana-lite`
  - `fal-ai/nano-banana-lite/edit`
- The new rows use the exact seed metadata JSON from `supabase/migrations/20260703180000_seed_media_runtime_catalog.sql`.
- Updated `tests/media/catalog-seed.test.ts` to validate the follow-up migration shape as an insert/upsert file instead of expecting the old update-assignment wording.

## Test command and output summary
- Command: `pnpm test tests/media/catalog-seed.test.ts`
- Result: PASS
- Summary: `1 test file passed, 6 tests passed`

## Local psql apply / verification result
- Apply command:
  - `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql`
- Result: `INSERT 0 2` and `UPDATE 2`
- Verification command:
  - `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select model, display_name, enabled, minimum_charge_usd_micros, reserve_amount_usd_micros, metadata #>> '{public_id}' as public_id, metadata #>> '{provider_endpoint}' as endpoint, metadata #>> '{pricing_formula,provider_rate_usd_per_image}' as rate from public.model_pricing_rules where model in ('google/nano-banana-2-lite','google/nano-banana-2-lite/edit','fal-ai/nano-banana-lite','fal-ai/nano-banana-lite/edit') order by model;"`
- Verification result: success; the two Google rows are enabled with reserve `47760` and rate `0.0398`, and the two old Fal rows are disabled with the same rate metadata.

## Files changed
- `supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql`
- `tests/media/catalog-seed.test.ts`
- `.superpowers/sdd/task-3-report.md`

## Self-review findings
- The migration is idempotent for the new Google rows through `insert ... on conflict do update`.
- The disable step only touches the two explicitly listed Fal models.
- The exact seed metadata JSON was copied for both new rows.
- The local database state matches the brief after applying the migration.

## Concerns
- None from this task. The only change outside the new migration was the test expectation update to match the upsert form of the follow-up migration.
