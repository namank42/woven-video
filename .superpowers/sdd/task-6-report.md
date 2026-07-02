## What I implemented

- Added media job deadlines on creation by writing `expires_at` from `MEDIA_JOB_TIMEOUT_SECONDS`.
- Updated worker claim normalization to read `expires_at`.
- Released expired claimed jobs before any model lookup or provider call with `media_job_timed_out`.
- Added a lease-heartbeat wrapper around in-flight provider calls that extends the claim every 120 seconds for 300 seconds.
- Reused the existing readiness/deadline migration as-is; it already contained the required `expires_at` column and lease RPC scaffolding for this task.

## What I tested and test results

- `./node_modules/.bin/vitest run tests/media/jobs.test.ts` — PASS
- `./node_modules/.bin/vitest run tests/media/worker.test.ts` — PASS
- `./node_modules/.bin/vitest run tests/media/env.test.ts tests/media/jobs.test.ts tests/media/worker.test.ts` — PASS

## TDD Evidence: RED and GREEN commands/output summary

### RED

- `./node_modules/.bin/vitest run tests/media/jobs.test.ts`
  - Failed because the inserted `generation_jobs` payload was missing `expires_at`.
- `./node_modules/.bin/vitest run tests/media/worker.test.ts`
  - Failed because expired claimed jobs were not short-circuited before provider handling.
- `./node_modules/.bin/vitest run tests/media/worker.test.ts`
  - Failed because no `extend_claimed_media_job_lease` RPC was called during a long-running provider request.

### GREEN

- `./node_modules/.bin/vitest run tests/media/jobs.test.ts`
  - Passed after adding `expires_at` at job creation and updating test env setup.
- `./node_modules/.bin/vitest run tests/media/worker.test.ts`
  - Passed after adding expired-job release and lease heartbeat behavior.
- `./node_modules/.bin/vitest run tests/media/env.test.ts tests/media/jobs.test.ts tests/media/worker.test.ts`
  - Passed: 3 files, 45 tests.

## Files changed

- `lib/media/jobs.ts`
- `lib/media/worker.ts`
- `tests/media/jobs.test.ts`
- `tests/media/worker.test.ts`

## Self-review findings

- Scope stayed within the task-owned files.
- The heartbeat is intentionally narrow: it only wraps the provider call, skips jobs without a claim token, and suppresses stale-claim noise while still logging unexpected lease-extension failures.
- No migration edit was needed because the existing migration already matched the task’s DB scaffolding requirements.

## Issues or concerns

- No blocking issues.

## Review Fix Follow-up

### What I fixed

- Split timeout reading from full media env validation by adding `getMediaJobTimeoutSeconds()` and switching media job creation to use it.
- Added rejection handling in the worker heartbeat loop so rejected lease-extension RPC calls are logged and swallowed instead of surfacing as unhandled promise rejections.

### Additional TDD evidence

#### RED

- `./node_modules/.bin/vitest run tests/media/env.test.ts`
  - Failed because `getMediaJobTimeoutSeconds` did not exist yet.
- `./node_modules/.bin/vitest run tests/media/jobs.test.ts`
  - Failed because job creation still called `getMediaEnv()` and threw `Missing MEDIA_TOKEN_SECRET.` when only the timeout env var was set.
- `./node_modules/.bin/vitest run tests/media/worker.test.ts`
  - Failed because rejected heartbeat RPC calls were unhandled and never reached `console.error`.

#### GREEN

- `./node_modules/.bin/vitest run tests/media/env.test.ts`
  - Passed after adding the narrow timeout reader.
- `./node_modules/.bin/vitest run tests/media/jobs.test.ts`
  - Passed after enqueueing switched to the narrow timeout reader.
- `./node_modules/.bin/vitest run tests/media/worker.test.ts`
  - Passed after adding heartbeat rejection handling.
- `./node_modules/.bin/vitest run tests/media/env.test.ts tests/media/jobs.test.ts tests/media/worker.test.ts`
  - Passed: 3 files, 48 tests.
