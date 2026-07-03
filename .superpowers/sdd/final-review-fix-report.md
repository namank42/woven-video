# Final Review Fix Report

## Summary of fixes

- Merged `model.defaultParameters` with validated user parameters before media job quoting and job-input persistence so `pricing_quote`, stored `input.parameters`, and downstream provider payload construction now share the same effective parameter set.
- Preserved explicit user parameter values over catalog defaults while still storing the full effective parameter object used for reservation and settlement fallback.
- Mapped surfaced `media_quote_*` job-creation errors to public `400 invalid_media_input` responses instead of falling through to a generic `500`.
- Exposed `input_asset_schema.constraints` in `GET /api/v1/media/models` so Seedance cross-role requirements are visible in the public catalog.

## Tests added and red/green evidence

- Added `tests/media/jobs.test.ts` regressions for:
  - omitted duration on a defaulted per-second model
  - omitted `generate_audio` when the model default is `true`
  - explicit user parameter override while storing the full effective parameter set
- Extended `tests/media/job-routes.test.ts` to prove `media_quote_requires_explicit_duration` maps to `invalid_media_input`.
- Extended `tests/media/model-catalog-route.test.ts` to prove public catalog responses include `input_asset_schema.constraints`.

Red:

- `npm exec vitest run tests/media/jobs.test.ts tests/media/job-routes.test.ts tests/media/model-catalog-route.test.ts`
- Result: failed as expected with 5 failures:
  - missing defaulted duration caused `media_quote_requires_explicit_duration`
  - omitted `generate_audio` quoted `false` instead of the model default
  - stored job parameters omitted merged defaults
  - catalog route omitted `input_asset_schema.constraints`
  - quote errors surfaced as `500` instead of `400 invalid_media_input`

Green:

- `npm exec vitest run tests/media/jobs.test.ts tests/media/job-routes.test.ts tests/media/model-catalog-route.test.ts`
- Result: 3 files passed, 25 tests passed

## Commands run and results

- `npm exec vitest run tests/media/jobs.test.ts tests/media/job-routes.test.ts tests/media/model-catalog-route.test.ts`
  - first run: failed red with 5 expected regressions
  - second run: passed, 25 tests
- `npm exec vitest run tests/media`
  - passed, 23 files passed, 1 skipped, 224 tests passed, 6 skipped
- `npm exec -- tsc --noEmit`
  - passed
- `npm run lint -- app/api/v1/media/jobs/route.ts app/api/v1/media/models/route.ts lib/media/jobs.ts tests/media/jobs.test.ts tests/media/job-routes.test.ts tests/media/model-catalog-route.test.ts`
  - passed
- `RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... npm run test:media-db`
  - first sandboxed run failed with `connect EPERM 127.0.0.1:54321`
  - rerun outside sandbox passed, 1 file passed, 6 tests passed

## Commit SHA

- Current branch `HEAD` at delivery time (`fix(media): align quotes with catalog defaults`)

## Concerns

- None beyond the sandbox-localhost restriction on the first DB integration attempt; the same command passed once allowed to reach local Supabase.
