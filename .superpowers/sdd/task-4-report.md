# Task 4 Report: Parse And Store Role-Aware Job Input Assets

## Status

DONE

## Summary

Implemented Task 4 on `feat/credit-models` by introducing shared parsing and validation for role-aware media job input assets, updating the media job route to accept `input_assets`, and persisting both `input_assets` and compatibility `input_asset_ids` plus `pricing_quote` into `generation_jobs.input`. Job reservation now uses the quote-aware reserve amount.

## What Changed

### New shared parser/validator

- Added `lib/media/input-assets.ts`.
- Added `MediaJobInputAsset`.
- Added `parseMediaJobInputAssets(...)` to:
  - reject requests that send both `input_assets` and `input_asset_ids`
  - parse explicit `input_assets`
  - preserve legacy `input_asset_ids` only when the role inference is unambiguous
  - validate duplicate asset IDs, known roles, and per-role min/max requirements
- Added shared helpers to reuse role validation inside job creation.

### Route handler

- Updated `app/api/v1/media/jobs/route.ts`.
- Kept `dynamic = "force-dynamic"` and `runtime = "nodejs"`.
- Added `input_assets?: unknown` to the request body type.
- Replaced legacy-only `input_asset_ids` parsing with `parseMediaJobInputAssets(...)`.
- Passed both `inputAssets` and `inputAssetIds` to `createReservedMediaJob(...)`.

### Job creation and storage

- Updated `lib/media/jobs.ts`.
- `createReservedMediaJob(...)` now accepts:
  - `inputAssets: MediaJobInputAsset[]`
  - `inputAssetIds: string[]`
- Validates role assignments before touching Supabase.
- Computes `pricingQuote = quoteMediaJob({ model, parameters })`.
- Reserves from `reservationUsdMicros(model, pricingQuote)`.
- Stores this in `generation_jobs.input`:
  - `input_assets`
  - `input_asset_ids`
  - `pricing_quote`
- Validates loaded asset rows against role-specific `contentTypePrefixes` when a model defines role schema.
- Preserves the legacy family-based content-type check for older no-role-schema models.

## TDD Notes

1. Added the Task 4 route tests to `tests/media/job-routes.test.ts`.
2. Updated and added the Task 4 job tests in `tests/media/jobs.test.ts`.
3. Ran the focused tests first and confirmed they failed for the expected missing behavior.
4. Implemented the minimal production changes to satisfy those failures.
5. Re-ran the same focused tests and got a clean pass.

## Verification

Focused test command actually executed in this shell:

```bash
./node_modules/.bin/vitest run tests/media/job-routes.test.ts tests/media/jobs.test.ts
```

Result:

- `2` test files passed
- `15` tests passed

Additional check:

```bash
git diff --check -- app/api/v1/media/jobs/route.ts lib/media/jobs.ts lib/media/input-assets.ts tests/media/job-routes.test.ts tests/media/jobs.test.ts
```

Passed with no diff formatting issues.

## Self-Review

- The route change stays inside the existing auth/license/error boundary.
- Legacy compatibility remains limited to the ambiguous-free path for `input_asset_ids`.
- Role-aware validation now runs both:
  - at parse time for request payloads
  - at job creation time before persistence and asset lookup
- Existing no-role-schema models still work through the compatibility path and legacy content-family validation.
- No unrelated dirty files were modified.

## Files Changed

- `app/api/v1/media/jobs/route.ts`
- `lib/media/jobs.ts`
- `lib/media/input-assets.ts`
- `tests/media/job-routes.test.ts`
- `tests/media/jobs.test.ts`

## Notes

- The task brief asked for `pnpm exec vitest ...`, but `pnpm` is not available on this shell PATH. I ran the equivalent local Vitest binary from `node_modules/.bin` instead, against the exact same test targets.
