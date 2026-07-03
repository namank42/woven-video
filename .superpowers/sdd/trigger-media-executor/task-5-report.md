# Task 5 Report: Dispatch Trigger From Job Creation And Fail Closed

## Scope

- Updated `app/api/v1/media/jobs/route.ts`
- Updated `lib/media/jobs.ts`
- Updated `tests/media/job-routes.test.ts`

No Trigger task files, DB migrations, webhook routes, old worker files, package scripts, or docs were modified.

## Requirements Implemented

1. `POST /api/v1/media/jobs` now dispatches Trigger immediately after `createReservedMediaJob(...)` succeeds.
2. Trigger dispatch uses `dispatchMediaJob(...)` from `lib/media/trigger-dispatch.ts`.
3. Trigger dispatch failures now fail closed:
   - call `failReservedMediaJobDispatch(job.id)`
   - release the reserved credits by reusing `releaseReservation(...)`
   - mark the job failed with `media_executor_unavailable`
   - return `503` with error code `media_executor_unavailable`
4. The successful response body is unchanged and does not expose Trigger run IDs to Harness.

## TDD Record

### Red

Added/updated route tests in `tests/media/job-routes.test.ts`:

- extended the queued-response test to assert `dispatchMediaJob(...)` is called with:
  - `jobId: "job_1"`
  - `userId: "user_1"`
  - `modelId: "fal:frontier-video"`
  - `kind: "video"`
- added a new failure test asserting dispatch failure:
  - returns `503`
  - returns error code `media_executor_unavailable`
  - calls `failReservedMediaJobDispatch("job_1")`
  - logs `console.error("Failed to dispatch media job", error)`

Attempted command from brief:

```bash
pnpm exec vitest run tests/media/job-routes.test.ts -t "queued job response|Trigger dispatch"
```

Exact error:

```text
zsh:1: command not found: pnpm
```

Fallback command used:

```bash
./node_modules/.bin/vitest run tests/media/job-routes.test.ts -t "queued job response|Trigger dispatch"
```

Observed failure:

- queued-response test failed because `dispatchMediaJob` was never called
- dispatch-failure test failed because the route still returned `200`

### Green

Implemented:

- `failReservedMediaJobDispatch(jobId: string): Promise<void>` in `lib/media/jobs.ts`
- post-create dispatch and fail-closed handling in `app/api/v1/media/jobs/route.ts`

Adjusted route-test fixtures to reflect the current route contract:

- mocked `@/lib/media/trigger-dispatch` in successful route tests
- added `failReservedMediaJobDispatch` to `@/lib/media/jobs` mocks where needed
- added `kind` to mocked model fixtures now consumed by dispatch

## Verification

Because `pnpm` was unavailable in this shell, verification used the local Vitest binary.

Passed:

```bash
./node_modules/.bin/vitest run tests/media/job-routes.test.ts
./node_modules/.bin/vitest run tests/media/job-routes.test.ts tests/media/trigger-dispatch.test.ts tests/media/executor.test.ts
```

Results:

- `tests/media/job-routes.test.ts`: 11 passed
- focused media set: 48 passed

## Notes

- Route handler conventions were preserved:
  - `export const dynamic = "force-dynamic"`
  - `export const runtime = "nodejs"`
  - `Response.json(...)` success shape unchanged
  - `apiError(...)` continues to provide error responses
- Dispatch cleanup is intentionally route-owned only for this task’s boundary. No Trigger task code was touched.
