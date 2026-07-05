# Task 4 Report - Replace Stale Lite IDs In Active Tests And Docs

## What changed

- Replaced the stale Lite model ID `fal-ai/nano-banana-lite` with `google/nano-banana-2-lite` across the active media test fixtures.
- Updated the media runtime catalog spec to list the Google Lite IDs instead of the legacy Fal IDs.
- Updated the older media runtime catalog research note so its active endpoint/source table now points at the Google Lite endpoints.
- Aligned the DB RPC integration test with the Google Lite catalog entries.
- Kept the intentional migration/history references in the migration SQLs, the catalog-seed test, and the superseded pricing note.

## Test command and output summary

Command:

```bash
pnpm test tests/media/pricing.test.ts tests/media/job-routes.test.ts tests/media/fal-webhook-route.test.ts tests/media/trigger-dispatch.test.ts tests/media/trigger-tasks.test.ts tests/pricing-page-rates.test.ts tests/media/catalog-seed.test.ts
```

Result:

- 7 test files passed
- 52 tests passed
- No failures in the targeted media suite

## Stale-ID scan output and rationale

Command:

```bash
rg -n "fal-ai/nano-banana-lite" tests lib supabase docs/superpowers/research docs/superpowers/specs
```

Remaining references:

- `docs/superpowers/research/2026-07-05-fal-nano-banana-lite-pricing.md` - intentional historical/superseded note that explains the migration from the old Fal Lite endpoints to the Google Lite endpoints.
- `tests/media/catalog-seed.test.ts` - intentional migration verification for the seed and follow-up migration SQL.
- `supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql` - intentional migration SQL that rewrites old IDs to the new Google IDs.
- `supabase/migrations/20260705123000_adjust_nano_banana_lite_pricing.sql` - intentional migration SQL that still references the old IDs while adjusting the historical pricing data.

No unexpected stale-ID references remained in active tests or current spec/research docs after the replacements.

## Files changed

- `tests/media/job-routes.test.ts`
- `tests/media/fal-webhook-route.test.ts`
- `tests/media/trigger-dispatch.test.ts`
- `tests/media/trigger-tasks.test.ts`
- `tests/media/pricing.test.ts`
- `tests/media/db-rpcs.integration.test.ts`
- `docs/superpowers/research/2026-07-03-media-runtime-catalog-docs.md`
- `docs/superpowers/specs/2026-07-03-media-runtime-catalog-design.md`

## Self-review findings

- Verified the active media tests now use `google/nano-banana-2-lite` consistently.
- Verified the current catalog spec no longer points engineers at `fal-ai/nano-banana-lite`.
- Verified the old ID still appears only in migration/history surfaces allowed by the brief.

## Concerns

- `tests/media/catalog-seed.test.ts` and the migration SQLs intentionally still mention the old IDs for migration coverage and historical correctness.
- The superseded 2026-07-05 pricing note still contains the legacy IDs by design.
