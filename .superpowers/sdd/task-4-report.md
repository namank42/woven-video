# Task 4 Report

## Implementation summary

- Added `validateProviderFetchableMediaBaseUrl` in `lib/media/provider-input-urls.ts` to enforce the provider-fetchable `MEDIA_BASE_URL` rule only when a job includes uploaded input asset IDs.
- Updated `app/api/v1/media/jobs/route.ts` to run that guard immediately after `parseMediaJobInputAssets` succeeds and before `createReservedMediaJob`, returning the brief-mandated `media_storage_misconfigured` error for localhost-style `MEDIA_BASE_URL` values.
- Expanded `tests/media/job-routes.test.ts` with the two Task 4 route cases and restored `process.env` after each test so the localhost override stays isolated.

## Tests and results

- RED command:
  - `pnpm test tests/media/job-routes.test.ts`
  - Result: FAIL, 1 test failed and 15 passed.
- GREEN command:
  - `pnpm test tests/media/job-routes.test.ts`
  - Result: PASS, 1 test file passed and 16 tests passed.
- Self-review check:
  - `git diff --check -- app/api/v1/media/jobs/route.ts lib/media/provider-input-urls.ts tests/media/job-routes.test.ts .superpowers/sdd/task-4-report.md`
  - Result: PASS, no diff formatting issues.

## TDD RED/GREEN evidence

### RED

Command:

```bash
pnpm test tests/media/job-routes.test.ts
```

Observed failure:

```text
FAIL  tests/media/job-routes.test.ts > media job routes > rejects uploaded-input provider jobs when MEDIA_BASE_URL points at localhost
AssertionError: expected 503 to be 500
```

This showed the uploaded-input route still reached reservation/dispatch code instead of failing early on localhost `MEDIA_BASE_URL`.

### GREEN

Command:

```bash
pnpm test tests/media/job-routes.test.ts
```

Observed result:

```text
Test Files  1 passed (1)
     Tests  16 passed (16)
```

## Files changed

- `lib/media/provider-input-urls.ts`
- `app/api/v1/media/jobs/route.ts`
- `tests/media/job-routes.test.ts`
- `.superpowers/sdd/task-4-report.md`

## Self-review findings

- The guard is scoped to provider-fetched uploaded inputs only; text-only jobs still reserve and dispatch normally with a localhost `MEDIA_BASE_URL`.
- The route now fails before job reservation and before Trigger dispatch, which matches the task requirement to block misconfigured uploaded-input jobs early.
- The new helper reuses `isLoopbackMediaBaseUrl` from `lib/media/env.ts` and keeps the decision logic out of the route body.
- I did not touch unrelated workspace changes, including the pre-existing untracked `pnpm-workspace.yaml`.

## Concerns

- The focused vitest run still emits existing Node warnings about `module.register()` deprecation and missing `--localstorage-file`, but the Task 4 assertions pass and the warnings are unrelated to this change.
