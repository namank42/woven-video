# Task 7 Report: Remove Old Polling Worker Path And Update Runbooks

## Status

DONE_WITH_CONCERNS

## Summary

Removed the unsupported polling-worker execution path and its legacy tests, deleted the old drain route and worker-only startup diagnostics, and updated the hosted-media runbook plus `.env.example` for the Trigger.dev executor flow.

## Files Changed

- Deleted `scripts/media-worker.ts`
- Deleted `app/api/internal/media/jobs/drain/route.ts`
- Deleted `lib/media/worker.ts`
- Deleted `lib/media/worker-startup.ts`
- Deleted `tests/media/worker.test.ts`
- Deleted `tests/media/worker-startup.test.ts`
- Deleted `tests/media/drain-route.test.ts`
- Added `tests/media/legacy-worker-removal.test.ts`
- Modified `.env.example`
- Modified `docs/media-worker-deploy.md`

## What Changed

1. Removed the old polling worker entrypoint and the internal single-job drain route.
2. Removed the now-orphaned `lib/media/worker.ts` and `lib/media/worker-startup.ts` modules.
3. Dropped the legacy worker and drain-route tests after confirming `tests/media/executor.test.ts` already covers the active exact-job executor flow.
4. Added a focused regression test that asserts the unsupported files stay deleted and the Trigger.dev runbook/env entries remain present.
5. Added `TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY`, and `TRIGGER_ACCESS_TOKEN` to `.env.example`.
6. Rewrote `docs/media-worker-deploy.md` to the media-executor flow:
   - renamed the document to `# Media Executor Deployment`
   - switched local dev to `pnpm run media:dev:local`
   - documented `pnpm run media:edge:deploy` and `pnpm run trigger:deploy`
   - added Trigger.dev environment guidance
   - explicitly stated that Trigger.dev is the supported executor in local and production

## TDD Notes

- Added `tests/media/legacy-worker-removal.test.ts` first.
- Verified RED with:

```bash
./node_modules/.bin/vitest run tests/media/legacy-worker-removal.test.ts
```

- Initial result:

```text
FAIL tests/media/legacy-worker-removal.test.ts > legacy polling worker removal > removes unsupported polling worker entrypoints and updates operator docs
AssertionError: expected true to be false
```

- After removals and doc/env updates, verified GREEN with the same command.

## Verification Commands And Results

### Exact reference grep before edits

```bash
rg -n "media:worker|media-worker|drainOneMediaJob|media/jobs/drain|worker-startup" package.json app lib scripts tests docs
```

Result before edits: legacy worker script, drain route, worker-startup module, and old tests were present.

### Exact reference grep after edits

```bash
rg -n "media:worker|media-worker|drainOneMediaJob|media/jobs/drain|worker-startup" package.json app lib scripts tests docs
```

Result after edits: no supported polling-worker implementation files remain. Residual hits are:

- archived `docs/superpowers/` specs/plans that intentionally preserve history
- supported edge-boundary code/tests still using the existing `x-woven-media-worker-secret` header

### Exact old-reference grep from Step 6

```bash
rg -n "media:worker|scripts/media-worker|drainOneMediaJob|media/jobs/drain|polling worker" package.json app lib scripts tests docs
```

Result: residual hits remain in archived `docs/superpowers/` files and in `docs/media-worker-deploy.md` because the brief explicitly required the sentence `Do not run a separate polling worker.`.

### Focused regression test

```bash
./node_modules/.bin/vitest run tests/media/legacy-worker-removal.test.ts
```

Result: PASS

### Full media tests from the brief

Tried exact brief command first:

```bash
pnpm exec vitest run tests/media
```

Result:

```text
zsh:1: command not found: pnpm
```

Fallback command:

```bash
./node_modules/.bin/vitest run tests/media
```

Result:

```text
Test Files  25 passed | 1 skipped (26)
Tests  232 passed | 10 skipped (242)
```

### Typecheck from the brief

Exact brief command:

```bash
./node_modules/.bin/tsc --noEmit
```

Initial result:

```text
.next/types/validator.ts(242,39): error TS2307: Cannot find module '../../app/api/internal/media/jobs/drain/route.js'
app/api/v1/media/jobs/route.ts(77,9): error TS2322: Type 'MediaKind' is not assignable to type '"image" | "video" | "audio"'.
```

Refreshed generated Next route types with:

```bash
./node_modules/.bin/next typegen
```

Result:

```text
Generating route types...
✓ Types generated successfully
```

Reran typecheck:

```bash
./node_modules/.bin/tsc --noEmit
```

Final result:

```text
app/api/v1/media/jobs/route.ts(77,9): error TS2322: Type 'MediaKind' is not assignable to type '"image" | "video" | "audio"'.
```

This remaining type error appears unrelated to Task 7.

### Lint from the brief

Tried exact brief command first:

```bash
pnpm run lint
```

Result:

```text
zsh:1: command not found: pnpm
```

Fallback command:

```bash
./node_modules/.bin/eslint .
```

Result:

```text
app/opengraph-image.tsx
  32:12  warning  Unused eslint-disable directive

tests/media/trigger-tasks.test.ts
  51:48  error  Unexpected any
  78:53  error  Unexpected any
```

The lint errors in `tests/media/trigger-tasks.test.ts` are pre-existing and unrelated to the polling-worker removal.

## Self-Review

- Confirmed the deleted polling path has no remaining supported entrypoint, route, or worker-only startup module.
- Confirmed active media execution coverage remains in `tests/media/executor.test.ts`.
- Confirmed `.env.example` and `docs/media-worker-deploy.md` reflect Trigger.dev local/prod execution.
- Confirmed no archived `docs/superpowers/` files were edited.

## Concerns

1. The exact post-change grep in the brief still returns matches because:
   - archived `docs/superpowers/` files intentionally retain historical references
   - supported media edge routes/tests still use `x-woven-media-worker-secret`
   - the brief also required a runbook sentence containing `polling worker`
2. `./node_modules/.bin/tsc --noEmit` still fails on an existing `MediaKind` mismatch in `app/api/v1/media/jobs/route.ts`.
3. `./node_modules/.bin/eslint .` still fails on existing `tests/media/trigger-tasks.test.ts` `no-explicit-any` errors, plus the known `app/opengraph-image.tsx` warning.

## Commit

Pending at report creation time. Updated after commit below.
