# Task 8 Report: Final Verification And Smoke Runbook

Status: DONE

## Summary

Completed the final Trigger media executor verification pass. Final verification exposed blockers in multiple required steps before Task 8 could honestly pass:

- Typecheck failed on `dispatchMediaJob` payload typing because `app/api/v1/media/jobs/route.ts` passed `MediaKind` to a dispatcher contract that only supports `image|video|audio`.
- Remote R2 rejected output uploads from the media Worker.
- The supported `media:dev:local` script did not export `TRIGGER_PROJECT_REF` before Trigger loaded `trigger.config.ts`.

These blockers are fixed, the plan/runbook now match the working local flow, and the supported local stack successfully generated and downloaded a Nano Banana Lite image through local Next, local Trigger.dev, local Cloudflare Worker, real Fal, local Supabase, and remote R2.

## Files Changed

- `app/api/v1/media/jobs/route.ts`
- `tests/media/job-routes.test.ts`
- `tests/media/trigger-tasks.test.ts`
- `lib/media/trigger-dispatch.ts`
- `tests/media/trigger-dispatch.test.ts`
- `workers/media/index.ts`
- `tests/media/media-worker.test.ts`
- `scripts/trigger-dev.mjs`
- `package.json`
- `.env.example`
- `.gitignore`
- `eslint.config.mjs`
- `lib/media/env.ts`
- `tests/media/env.test.ts`
- `tests/media/assets.test.ts`
- `tests/media/output-assets.test.ts`
- `tests/media/output-urls.test.ts`
- `docs/media-worker-deploy.md`
- `docs/superpowers/plans/2026-07-03-trigger-media-executor.md`

## Verification Commands And Results

### Full unit test suite

Bare `pnpm` is not installed in this shell and `corepack` is unavailable, so the pnpm entrypoints were run with `npx pnpm@latest --config.verify-deps-before-run=false` to avoid purging the existing non-pnpm `node_modules`.

```bash
npx pnpm@latest --config.verify-deps-before-run=false test
```

Result:

- PASS
- `Test Files  29 passed | 1 skipped (30)`
- `Tests  258 passed | 10 skipped (268)`

### Typecheck

```bash
./node_modules/.bin/tsc --noEmit
```

Result:

- PASS

### Lint

```bash
npx pnpm@latest --config.verify-deps-before-run=false run lint
```

Result:

- PASS with the allowed pre-existing `app/opengraph-image.tsx` warning only.
- Added `.trigger/**` to `eslint.config.mjs` because Trigger.dev generates local build output under `.trigger/tmp`.

### Supabase DB integration

```bash
zsh -lc 'eval "$(supabase status -o env | sed "s/^/export /")"; RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" npx pnpm@latest --config.verify-deps-before-run=false exec vitest run tests/media/db-rpcs.integration.test.ts'
```

Result:

- PASS
- `Test Files  1 passed (1)`
- `Tests  10 passed (10)`

Supabase DB integration tests passed successfully.

### Local real-Fal smoke

Required startup:

```bash
npx pnpm@latest --config.verify-deps-before-run=false run media:dev:local
```

Initial supported-script result:

- Next and Wrangler started.
- Trigger failed before loading tasks because `trigger.config.ts` requires `TRIGGER_PROJECT_REF`, and Trigger resolves config before applying `--env-file`.

Fix:

- Added `scripts/trigger-dev.mjs`.
- Updated `package.json` so `pnpm run trigger:dev` exports `TRIGGER_PROJECT_REF` from `.env.local` before Trigger reads `trigger.config.ts`, then starts Trigger with `--env-file .env.local`.

Supported-script rerun:

- Next listened on `http://localhost:3000`.
- Cloudflare media edge Worker listened on `http://localhost:8787` with remote `woven-media` R2.
- Trigger.dev reported `Local worker ready on branch: default [node] -> 20260703.2`.

Initial real provider smoke:

- Nano Banana Lite reached Fal and stored a provider job id.
- Output materialization failed with `media_output_materialization_failed`.
- The output media asset failure metadata showed `media_output_upload_failed:500`.
- Wrangler logged remote R2 rejecting `MEDIA_BUCKET.put(...)` with HTTP 400.

Fix:

- Changed Worker R2 `customMetadata` keys from underscore names to hyphenated names.
- Updated Worker tests to assert the hyphenated object metadata contract.

Final real smoke rerun through `media:dev:local`:

- Created Nano Banana Lite job `c0771932-0198-4325-b181-5a60c97a4868`.
- `POST /api/v1/media/jobs` returned `200` and `queued`.
- Public status progressed through `queued` -> `waiting_provider` -> `succeeded`.
- Local Supabase row has `provider = fal`, `media_model_id = fal-ai/nano-banana-lite`, a stored provider job id, `error = null`, and `final_cost_usd_micros = 1200000`.
- Output asset `46449818-64d5-51b8-8775-4b887bdf8305` is `ready`, `image/png`, `978248` bytes, with an R2 storage key.
- Public job read returned one output with a signed download URL.
- The signed download returned `200 image/png` and `978248` bytes.

Smoke status:

- PASS

## Narrow Fixes Made

### Unsupported media kind guard

- Typecheck blocker from Step 2: the `MediaKind` model kind was too broad for
  `dispatchMediaJob` (`image|video|audio`), so the route could pass unsupported
  kinds.
- Added a guard rejecting non-Trigger media kinds before reservation/dispatch.
- Moved the supported-kind predicate into `lib/media/trigger-dispatch.ts` so the route and dispatcher share the same contract.
- Added route and dispatch-helper tests.

### Remote R2 output upload metadata

- Changed Worker R2 custom metadata keys to hyphenated names.
- Covered the metadata contract in `tests/media/media-worker.test.ts`.

### Trigger local startup

- Added `scripts/trigger-dev.mjs`.
- Updated `trigger:dev` to export `TRIGGER_PROJECT_REF` before Trigger loads config and to pass `.env.local` for task runtime secrets.

### Stale local artifacts and env

- Ignored `.trigger/` in Git and ESLint.
- Removed the dead `MEDIA_WORKER_POLL_MS` setting now that the polling worker path is gone.
- Recorded this as a final verification requirement cleanup to enforce the global
  constraint that no supported local/production path relies on the old polling
  worker mode.

## Concerns / Follow-Up

- Production Trigger.dev env currently lists only default telemetry/heartbeat variables; the Woven/Fal/Supabase/media task secrets still need to be configured in Trigger Cloud before production deployment.
- The repo still has the pre-existing `app/opengraph-image.tsx` unused eslint-disable warning.
