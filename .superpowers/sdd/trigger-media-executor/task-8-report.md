# Task 8 Report: Final Verification And Smoke Runbook

Status: DONE_WITH_CONCERNS

## Summary

Completed the Task 8 verification pass for the Trigger media executor migration, fixed two narrow verification blockers, updated the deploy runbook, and checked off the completed plan steps. The required local real-Fal smoke remains unverified because the shell lacked `pnpm`, `.env.local` lacked Trigger runtime vars, and no authenticated bearer token was available for the media job route.

## Files Changed

- `app/api/v1/media/jobs/route.ts`
- `tests/media/job-routes.test.ts`
- `tests/media/trigger-tasks.test.ts`
- `docs/media-worker-deploy.md`
- `docs/superpowers/plans/2026-07-03-trigger-media-executor.md`

## Verification Commands And Results

### 1. Full unit test suite

Command required by brief:

```bash
pnpm test
```

Result:

- Failed immediately: `zsh:1: command not found: pnpm`

Fallback used:

```bash
./node_modules/.bin/vitest run
```

Result:

- PASS
- `Test Files  29 passed | 1 skipped (30)`
- `Tests  257 passed | 10 skipped (267)`

### 2. Typecheck

Command:

```bash
./node_modules/.bin/tsc --noEmit
```

Initial result:

- FAIL
- `app/api/v1/media/jobs/route.ts(77,9): error TS2322: Type 'MediaKind' is not assignable to type '"image" | "video" | "audio"'`

Fix:

- Added a route-level guard rejecting non-Trigger media kinds before reservation/dispatch.

Verification rerun:

```bash
./node_modules/.bin/tsc --noEmit
```

Result:

- PASS

### 3. Lint

Command required by brief:

```bash
pnpm run lint
```

Result:

- Failed immediately: `zsh:1: command not found: pnpm`

Fallback used:

```bash
./node_modules/.bin/eslint .
```

Result:

- PASS with the allowed pre-existing warning only:
- `/Users/naman/projects/woven-video/app/opengraph-image.tsx`
- `32:12  warning  Unused eslint-disable directive (no problems were reported from '@next/next/no-img-element')`

Fix included during lint cleanup:

- Replaced `any` casts in `tests/media/trigger-tasks.test.ts` with `unknown as` plus explicit test-local task shapes.

### 4. Supabase DB integration tests

Command required by brief:

```bash
eval "$(supabase status -o env | sed 's/^/export /')"
RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" pnpm exec vitest run tests/media/db-rpcs.integration.test.ts
```

Observed issues:

- `pnpm exec ...` failed immediately because `pnpm` is unavailable in this shell.
- First fallback attempt using `./node_modules/.bin/vitest` still failed because `supabase status -o env` tried to write `~/.supabase/telemetry.json` and hit sandbox `EPERM`, so the test process did not receive `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

Escalated fallback used:

```bash
zsh -lc 'eval "$(supabase status -o env | sed "s/^/export /")"; RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" ./node_modules/.bin/vitest run tests/media/db-rpcs.integration.test.ts'
```

Result:

- PASS
- `Test Files  1 passed (1)`
- `Tests  10 passed (10)`

### 5. Local real-Fal smoke

Command required by brief:

```bash
pnpm run media:dev:local
```

Result:

- Failed immediately: `zsh:1: command not found: pnpm`

Additional prerequisite checks:

- `.env.local` has `FAL_KEY`, `MEDIA_BASE_URL`, `MEDIA_TOKEN_SECRET`, `MEDIA_WORKER_SHARED_SECRET`, local Supabase URL, and local service-role key.
- `.env.local` is missing `TRIGGER_PROJECT_REF`.
- `.env.local` is missing `TRIGGER_SECRET_KEY`.
- Shell env is missing `TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY`, `TRIGGER_ACCESS_TOKEN`, and `LOCAL_OR_PROD_TOKEN`.
- `lib/api/auth.ts` requires a real bearer token for `/api/v1/media/jobs`; the service-role key is not enough.

Smoke status:

- NOT RUN
- Left unchecked in the plan.

## Narrow Fixes Made

### Unsupported media kind guard

- File: `app/api/v1/media/jobs/route.ts`
- Added `isTriggerMediaKind()` and reject `kind: "captions"` before job reservation and Trigger dispatch.
- Prevents unsupported models from falling into the generic executor-unavailable `503` path.

### Regression test for the guard

- File: `tests/media/job-routes.test.ts`
- Added a failing-then-passing test covering `kind: "captions"` and asserting `400 invalid_media_input` with no reservation or dispatch.

### Lint-safe Trigger task assertions

- File: `tests/media/trigger-tasks.test.ts`
- Removed `any` casts called out by the Task 7 reviewer and kept the test assertions explicit.

## Runbook / Plan Updates

### `docs/media-worker-deploy.md`

Added Task 8 verification notes covering:

- repo-local verification fallbacks when `pnpm` is unavailable
- local smoke prerequisites for `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY`
- bearer-token requirement for authenticated media job routes
- Supabase CLI sandbox caveat for `supabase status -o env`

### `docs/superpowers/plans/2026-07-03-trigger-media-executor.md`

- Checked off Steps 1-4
- Left Step 5 unchecked with a concrete note describing the blockers
- Checked off Steps 6-7 after creating the final verification commit

## Self-Review

Reviewed the diff for scope and verified the changes stay within Task 8 ownership:

- one route guard
- one new route test
- one lint/type cleanup in an existing Trigger task test
- runbook and plan updates only in the Task 8-owned docs

## Concerns / Unverified Items

1. The local real-Fal smoke was not completed.
2. The runbook still carries the pre-existing `app/opengraph-image.tsx` lint warning.
3. I did not spend Task 8 scope on the unrelated reviewer note about `docs/reel-caption-generation.md`.
4. I did not add coverage for `package.json` script presence to `tests/media/legacy-worker-removal.test.ts`; the reviewer had already marked that as a minor note, not a Task 8 requirement.

## Commit

- Created a final verification commit with message `fix: finalize trigger media executor verification`.
