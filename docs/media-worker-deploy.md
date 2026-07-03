# Media Executor Deployment

This runbook keeps the app, Supabase schema, media Worker, R2 bucket, and reel-captions client compatibility in the right order.

## Required Infrastructure

- Cloudflare R2 bucket: `woven-media`
- Cloudflare Worker routes:
  - `https://media.woven.video/uploads/*`
  - `https://media.woven.video/objects/*`
  - `https://media.woven.video/internal/*`
- Vercel app route: `https://www.woven.video`
- Supabase migrations through `20260703180000_seed_media_runtime_catalog.sql`

Do not route all of `media.woven.video/*` to this Worker. The host also serves existing top-level landing and hero assets such as `woven-hero-v*.mp4` and `woven-hero-v*.png`; the Worker must only own `/uploads/*`, `/objects/*`, and `/internal/*`.

## Worker Secrets

Set these before deploying the Worker:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc
```

The values must match the app's `MEDIA_TOKEN_SECRET` and `MEDIA_WORKER_SHARED_SECRET`.

`pnpm run media:edge:deploy` uses `npx wrangler` so a clean checkout does not require a globally installed Wrangler binary. The deploy machine still needs npm network access to fetch Wrangler when it is not already cached or globally available. Production deploy pipelines may pin or add Wrangler as a dev dependency for repeatable deploys.

## App Environment

Set these on the app before enabling hosted media creation:

```dotenv
MEDIA_BASE_URL=https://media.woven.video
MEDIA_TOKEN_SECRET=<same value as Worker>
MEDIA_WORKER_SHARED_SECRET=<same value as Worker>
MEDIA_MAX_UPLOAD_BYTES=104857600
MEDIA_UPLOAD_URL_TTL_SECONDS=900
MEDIA_DOWNLOAD_URL_TTL_SECONDS=900
MEDIA_OUTPUT_RETENTION_SECONDS=2592000
MEDIA_JOB_TIMEOUT_SECONDS=3600
MEDIA_WORKER_POLL_MS=5000
MEDIA_FAL_WEBHOOK_BASE_URL=https://www.woven.video
# Optional override. Defaults to https://rest.fal.ai/.well-known/jwks.json.
FAL_WEBHOOK_JWKS_URL=
TRIGGER_PROJECT_REF=
TRIGGER_SECRET_KEY=
TRIGGER_ACCESS_TOKEN=
CRON_SECRET=<random 16+ character secret for Vercel Cron>
```

The timeout, Fal webhook, Trigger, and cron values are consumed by the hosted-media flow. Set them before enabling the completed media executor path.

## Trigger.dev Configuration

- `TRIGGER_PROJECT_REF` is read by `trigger.config.ts`.
- `TRIGGER_SECRET_KEY` is required anywhere Woven API code dispatches Trigger tasks.
- `TRIGGER_ACCESS_TOKEN` is required for non-interactive Trigger deploys.
- Configure Supabase, Fal, ElevenLabs, and media storage secrets in Trigger.dev Cloud with the same names used by local `.env.local`.

## Deployment Order

1. Create or verify the `woven-media` R2 bucket.
2. Set Worker secrets with `npx wrangler secret put`.
3. Deploy the Cloudflare media edge Worker with `pnpm run media:edge:deploy`.
4. Set app env vars in Vercel.
5. Apply Supabase migrations.
6. Deploy the app.
7. Deploy Trigger.dev tasks with `pnpm run trigger:deploy`.
8. After the cleanup task lands, confirm Vercel Cron is active for `/api/internal/media/cleanup`.
9. Smoke-test upload, job creation, job status, output download, and, after the follow-up tasks land, Fal webhook and cleanup.

## Local Development

Run local hosted media with:

```bash
pnpm run media:dev:local
```

That starts:

- `pnpm run dev` for the Next.js API routes
- `pnpm run media:edge:local` for the Cloudflare media Worker on `127.0.0.1:8787`
- `pnpm run trigger:dev` for Trigger.dev local task execution

Trigger.dev is the supported executor in local and production. Do not run a separate polling worker.

Task 8 local verification notes from `2026-07-03`:

- If `pnpm` is unavailable in the current shell, use the repo-local binaries for verification:
  - `./node_modules/.bin/vitest run`
  - `./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/eslint .`
- Local Trigger media smoke also needs `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY` alongside the existing Supabase, media Worker, and `FAL_KEY` env vars.
- The authenticated media job routes require a real bearer token for a signed-in user. A service-role key alone is not sufficient for `/api/v1/media/jobs`.

## Curated Media Model Catalog

Clean schema deployments seed enabled production media rows in `model_pricing_rules` through
`20260703180000_seed_media_runtime_catalog.sql`. Production deploy no longer requires manually
enabling `fal:launch-placeholder-video`.

Before enabling job creation in production, verify:

```bash
pnpm run test:media-db
curl -s https://www.woven.video/api/v1/media/models \
  -H "Authorization: Bearer $LOCAL_OR_PROD_TOKEN"
curl -s "https://www.woven.video/api/v1/media/models?kind=image" \
  -H "Authorization: Bearer $LOCAL_OR_PROD_TOKEN"
```

The catalog response must include image, video, and audio rows, `input_asset_schema`, and
`parameter_schema`. Do not enable rows that rely on generic recursive Fal URL extraction.

## Smoke Tests

1. Create a temp upload asset through `POST /api/v1/media/uploads`.
2. PUT a small object to the returned `upload_url`.
3. Create a hosted media job that references the uploaded input.
4. Confirm the job starts as `queued`, then `running` or `waiting_provider`.
5. Confirm output URLs are absent in stored `generation_jobs.output` and present in `GET /api/v1/media/jobs/:jobId`.
6. Confirm `GET https://media.woven.video/objects/:assetId?token=...` returns the output before retention expiry.
7. After Task 4 implements cleanup, invoke `GET /api/internal/media/cleanup` with `Authorization: Bearer $CRON_SECRET` in staging and confirm expired R2 keys are deleted.

## Local SQL RPC Tests

Run these before shipping schema changes:

```bash
supabase start
supabase db reset
RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key> npm run test:media-db
```

In Codex/sandboxed shells, `supabase status -o env` may fail before the test runs because the CLI writes
`~/.supabase/telemetry.json`. If that happens, rerun the env export + Vitest command outside the sandbox so
the integration result reflects the database state instead of the sandbox filesystem restriction.

## Rollback Notes

- Do not roll back the app to a build that writes Supabase Storage reel-captions jobs after applying hosted-media-only client changes.
- If the Worker is unavailable, disable hosted media creation at the app/router layer before users create jobs.
- After Task 4 adds Worker `/internal/delete`, the R2 physical cleanup path is idempotent for already-deleted keys because R2 `delete` succeeds even when the object is absent.
