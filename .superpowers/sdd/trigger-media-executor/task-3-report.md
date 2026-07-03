# Task 3 Report: Extract Exact-Job Media Executor

## Status

NEEDS_CONTEXT

## What I completed

- Read the task brief and current worker/existing tests.
- Added the required red-phase test file at `tests/media/executor.test.ts` using the exact initial test set from the brief.
- Verified the expected first failure using the local Vitest binary because `pnpm` is unavailable in this shell:
  - `pnpm exec vitest run tests/media/executor.test.ts` -> `zsh:1: command not found: pnpm`
  - `./node_modules/.bin/vitest run tests/media/executor.test.ts` -> failed because `@/lib/media/executor` did not exist.
- Added `lib/media/job-claims.ts` from the brief.
- Added `lib/media/executor.ts` by copying the reusable worker logic and preserving the brief’s top-level `processMediaJob` durable wait loop.

## Blocking issue

The brief’s required initial test set conflicts with the brief’s required `processMediaJob` loop semantics.

### Evidence

1. The brief requires the first executor test to use a single claimed job row and expect `waiting_provider`:
   - `.superpowers/sdd/trigger-media-executor/task-3-brief.md:99-109`

2. That same test harness shifts one value per `claim_media_job_by_id` call:
   - `.superpowers/sdd/trigger-media-executor/task-3-brief.md:192-199`

3. The brief also requires `processMediaJob` to keep looping and call `waitFor({ seconds: 5 })` until the step result is not `waiting_provider`:
   - `.superpowers/sdd/trigger-media-executor/task-3-brief.md:315-347`

4. With those exact requirements together:
   - first claim returns the single queued job
   - adapter returns `waiting_provider`
   - top-level `processMediaJob` waits and reclaims
   - second claim returns `null` because the queue is exhausted
   - the function returns `not_claimed`, not `waiting_provider`

5. Current local reproduction:
   - `tests/media/executor.test.ts:72-88`
   - `lib/media/executor.ts:47-65`
   - observed failure: expected `{ jobId: "job_1", status: "waiting_provider" }`, received `{ jobId: "job_1", status: "not_claimed" }`

## Context needed

Please clarify which behavior is correct for `processMediaJob` after it has already entered provider wait and the next `claim_media_job_by_id(jobId)` returns `null`:

1. Return `waiting_provider` and end the Trigger run.
2. Return `not_claimed`.
3. Change the required initial test fixture so the first test does not exercise the durable wait loop.

## Repo state

- No commit created.
- Modified files are currently:
  - `lib/media/job-claims.ts`
  - `lib/media/executor.ts`
  - `tests/media/executor.test.ts`

---

## Update after clarification

The clarification resolved the contract mismatch: `processMediaJob` remains the full Trigger loop, and reclaiming `null` after a durable wait returns `{ jobId, status: "not_claimed" }`.

### Final implementation

- Updated the first executor test to use a terminal provider result (`provider_failed`) instead of `waiting_provider`.
- Expanded `tests/media/executor.test.ts` into the consolidated behavior suite for the extracted executor, including:
  - exact `jobId` claim ordering
  - durable wait + reclaim success
  - durable wait + reclaim `null` => `not_claimed`
  - uploaded input signing / legacy role inference
  - public error behavior for missing model, missing adapter, provider failure, stale claim, and output materialization failure
  - settlement, pricing quote fallback, and sanitized metadata assertions
  - the migration assertions previously housed in `tests/media/worker.test.ts`
- Deleted `tests/media/worker.test.ts` after equivalent coverage was moved.
- Kept `processMediaJobStep` private.
- Verified `lib/media/executor.ts` has no heartbeat lease logic:
  - `rg -n "extend_claimed_media_job_lease|withLeaseHeartbeat" lib/media/executor.ts` -> no output

### Test results

- `pnpm exec vitest run tests/media/executor.test.ts` -> `zsh:1: command not found: pnpm`
- `./node_modules/.bin/vitest run tests/media/executor.test.ts` -> PASS (`33 passed`)
- `./node_modules/.bin/vitest run tests/media/executor.test.ts tests/media/provider-adapters.test.ts tests/media/output-assets.test.ts` -> PASS (`60 passed`)

### Final scoped files

- `lib/media/job-claims.ts`
- `lib/media/executor.ts`
- `tests/media/executor.test.ts`
- deleted: `tests/media/worker.test.ts`

---

## Task 3 fix append

### Status

DONE

### What changed

- Normalized `claim_media_job_by_id` RPC results in `lib/media/job-claims.ts` so literal `null` and the Supabase null-composite row shape both resolve to `null`.
- Added regression coverage in `tests/media/executor.test.ts` for:
  - exact claim returning the null-composite shape and resolving `not_claimed` without calling the adapter
  - reclaim after provider wait returning the null-composite shape, still waiting `5` seconds, and resolving `not_claimed` without throwing

### Verification

- `pnpm exec vitest run tests/media/executor.test.ts` -> `zsh:1: command not found: pnpm`
- `./node_modules/.bin/vitest run tests/media/executor.test.ts` -> PASS (`35 passed`)
- `rg -n "extend_claimed_media_job_lease|withLeaseHeartbeat" lib/media/executor.ts` -> no output
- `./node_modules/.bin/vitest run tests/media/executor.test.ts tests/media/provider-adapters.test.ts tests/media/output-assets.test.ts` -> PASS (`62 passed`)
