# Media Worker Deployment

This runbook keeps the app, Supabase schema, media Worker, R2 bucket, and reel-captions client compatibility in the right order.

## Required Infrastructure

- Cloudflare R2 bucket: `woven-media`
- Cloudflare Worker routes:
  - `https://media.woven.video/uploads/*`
  - `https://media.woven.video/objects/*`
  - `https://media.woven.video/internal/*`
- Vercel app route: `https://www.woven.video`
- Supabase migrations through `20260702160000_media_job_readiness_deadlines_cleanup.sql`

Do not route all of `media.woven.video/*` to this Worker. The host also serves existing top-level landing and hero assets such as `woven-hero-v*.mp4` and `woven-hero-v*.png`; the Worker must only own `/uploads/*`, `/objects/*`, and `/internal/*`.

## Worker Secrets

Set these before deploying the Worker:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc
```

The values must match the app's `MEDIA_TOKEN_SECRET` and `MEDIA_WORKER_SHARED_SECRET`.

`npm run media:worker:deploy` uses `npx wrangler` so a clean checkout does not require a globally installed Wrangler binary. The deploy machine still needs npm network access to fetch Wrangler when it is not already cached or globally available. Production deploy pipelines may pin or add Wrangler as a dev dependency for repeatable deploys.

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
CRON_SECRET=<random 16+ character secret for Vercel Cron>
```

The timeout, worker polling, Fal webhook, and cron values are consumed by follow-up hosted-media tasks in this plan. Set them before enabling the completed hosted media flow, but do not expect the cleanup cron or Fal webhook smoke tests to work at the Task 2-only head.

## Deployment Order

1. Create or verify the `woven-media` R2 bucket.
2. Set Worker secrets with `npx wrangler secret put`.
3. Deploy the Worker with `npm run media:worker:deploy`.
4. Set app env vars in Vercel.
5. Apply Supabase migrations.
6. Deploy the app.
7. Start or restart the media worker process.
8. After the cleanup task lands, confirm Vercel Cron is active for `/api/internal/media/cleanup`.
9. Smoke-test upload, job creation, job status, output download, and, after the follow-up tasks land, Fal webhook and cleanup.

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

## Rollback Notes

- Do not roll back the app to a build that writes Supabase Storage reel-captions jobs after applying hosted-media-only client changes.
- If the Worker is unavailable, disable hosted media creation at the app/router layer before users create jobs.
- After Task 4 adds Worker `/internal/delete`, the R2 physical cleanup path is idempotent for already-deleted keys because R2 `delete` succeeds even when the object is absent.
