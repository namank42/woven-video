# Media Executor Deployment

This runbook keeps the app, Supabase schema, media Worker, R2 bucket, and reel-captions client compatibility in the right order.

## Required Infrastructure

- Cloudflare R2 bucket: `woven-media`
- Cloudflare Worker routes:
  - `https://media.woven.video/uploads/*`
  - `https://media.woven.video/objects/*`
  - `https://media.woven.video/internal/*`
- Vercel app route: `https://www.woven.video`

Local provider smoke:

- Cloudflare R2 bucket: `woven-media-dev`
- Cloudflare proxied DNS record for `media-dev.woven.video`
- Cloudflare Worker routes:
  - `https://media-dev.woven.video/uploads/*`
  - `https://media-dev.woven.video/objects/*`
  - `https://media-dev.woven.video/internal/*`
- Local app route: `http://127.0.0.1:3000`
- Local Supabase: `http://127.0.0.1:54321`

Both environments require Supabase migrations through `20260703190000_trigger_media_executor.sql`.

Do not route all of `media.woven.video/*` to this Worker. The host also serves existing top-level landing and hero assets such as `woven-hero-v*.mp4` and `woven-hero-v*.png`; the Worker must only own `/uploads/*`, `/objects/*`, and `/internal/*`.

## Worker Secrets

Set production Worker secrets before deploying production:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc
```

Set dev Worker secrets before deploying the `dev` environment:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc --env dev
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc --env dev
```

For local provider smoke, `.env.local` must use the same `MEDIA_TOKEN_SECRET` value as the dev Worker.
Harness must never receive `MEDIA_WORKER_SHARED_SECRET`.

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

For Worker route development, run:

```bash
pnpm run media:dev:local
```

That starts:

- `pnpm run dev` for the Next.js API routes
- `pnpm run media:edge:local` for the Cloudflare media Worker on `127.0.0.1:8787`
- `pnpm run trigger:dev` for Trigger.dev local task execution

This localhost Worker path is not valid for real Fal provider smoke tests that include uploaded
inputs, because Fal cannot fetch `127.0.0.1` URLs.

For real local provider smoke with uploaded inputs, set `.env.local` to:

```dotenv
MEDIA_BASE_URL=https://media-dev.woven.video
MEDIA_UPLOAD_COMPLETION_MODE=manual
```

Then run:

```bash
pnpm run media:dev:smoke
```

That starts local Next and Trigger.dev dev only. It does not start `media:edge:local`; media bytes go
through the deployed dev Worker and `woven-media-dev`.

Trigger.dev is the supported executor in local and production. Do not run a separate polling worker.

## Dev R2 And Worker Provisioning

Verify Wrangler is logged into the Cloudflare account that owns `woven.video`:

```bash
npx wrangler whoami
npx wrangler r2 bucket list
```

Verify `media-dev.woven.video` has a proxied DNS record in Cloudflare. Worker Routes require a
proxied DNS record for the hostname. If there is no real origin for this dev hostname, create a
proxied `AAAA` record pointing to `100::` through the Cloudflare dashboard or API before deploying
the Worker routes.

Create the dev bucket if it is missing:

```bash
npx wrangler r2 bucket create woven-media-dev
```

Apply lifecycle cleanup for local smoke objects:

```bash
npx wrangler r2 bucket lifecycle set woven-media-dev --file workers/media/r2-dev-lifecycle.json
```

Set dev Worker secrets:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc --env dev
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc --env dev
```

Deploy the dev Worker:

```bash
pnpm run media:edge:deploy:dev
```

Do not point local provider smoke at `https://media.woven.video`; that would write local test objects
to production storage and the production Worker would try to complete uploads against the production
app.

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
2. Confirm local provider-smoke upload responses include:
   - `upload_url` on `https://media-dev.woven.video/uploads/...`
   - `completion.method = "POST"`
   - `completion.url = "/api/v1/media/uploads/<assetId>/complete"`
3. PUT a small object to the returned `upload_url`.
4. POST to the returned `completion.url` with the same bearer token.
5. Create a hosted media job that references the uploaded input.
6. Confirm the job starts as `queued`, then `running` or `waiting_provider`.
7. Confirm output URLs are absent in stored `generation_jobs.output` and present in `GET /api/v1/media/jobs/:jobId`.
8. Confirm `GET https://media.woven.video/objects/:assetId?token=...` returns the output before retention expiry.
9. After Task 4 implements cleanup, invoke `GET /api/internal/media/cleanup` with `Authorization: Bearer $CRON_SECRET` in staging and confirm expired R2 keys are deleted.

## Local SQL RPC Tests

Run these before shipping schema changes:

```bash
supabase start
supabase db reset
RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key> pnpm run test:media-db
```

If `pnpm` is unavailable in the current shell, use:

```bash
RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key> npx pnpm@latest --config.verify-deps-before-run=false run test:media-db
```

In Codex/sandboxed shells, `supabase status -o env` may fail before the test runs because the CLI writes
`~/.supabase/telemetry.json`. If that happens, rerun the env export + Vitest command outside the sandbox so
the integration result reflects the database state instead of the sandbox filesystem restriction.

## Local Expired Media Job Cleanup

This branch had local-only Trigger noise from stale integration-test fixture rows. The fix is the
same RPC used by scheduled reconciliation, not a production backfill.

Run this only against local Supabase:

```bash
eval "$(supabase status -o env | awk -F= '
  /^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=/{print "export " $0}
  /^API_URL=/{print "export SUPABASE_URL=" $2}
  /^SERVICE_ROLE_KEY=/{print "export SUPABASE_SERVICE_ROLE_KEY=" $2}
')"
pnpm exec tsx -e 'import { createClient } from "@supabase/supabase-js";
void (async () => {
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await admin.rpc("finalize_expired_media_jobs_for_reconciliation", { p_limit: 1000, p_now: new Date().toISOString() });
if (error) throw error;
console.log(JSON.stringify({ finalized: data?.length ?? 0, jobs: data }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});'
```

Verify no expired active media jobs remain:

```bash
eval "$(supabase status -o env | awk -F= '
  /^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=/{print "export " $0}
  /^API_URL=/{print "export SUPABASE_URL=" $2}
  /^SERVICE_ROLE_KEY=/{print "export SUPABASE_SERVICE_ROLE_KEY=" $2}
')"
pnpm exec tsx -e 'import { createClient } from "@supabase/supabase-js";
void (async () => {
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await admin.from("generation_jobs").select("id,status,error,model,expires_at").eq("type", "media_job").in("status", ["creating", "queued", "running", "waiting_provider"]).lte("expires_at", new Date().toISOString());
if (error) throw error;
console.log(JSON.stringify({ remaining: data?.length ?? 0, jobs: data }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});'
```

Expected: `remaining` is `0`.

## Rollback Notes

- Do not roll back the app to a build that writes Supabase Storage reel-captions jobs after applying hosted-media-only client changes.
- If the Worker is unavailable, disable hosted media creation at the app/router layer before users create jobs.
- After Task 4 adds Worker `/internal/delete`, the R2 physical cleanup path is idempotent for already-deleted keys because R2 `delete` succeeds even when the object is absent.
