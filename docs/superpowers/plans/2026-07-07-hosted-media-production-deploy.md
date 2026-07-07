# Hosted Media Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the hosted media backend on `feat/credit-models` to production without orphaned jobs, broken signed media URLs, missing model catalog rows, or mismatched worker/Trigger/Vercel configuration.

**Architecture:** Vercel hosts the authenticated API/control plane and the daily cleanup cron. Supabase stores catalog rows, reservations, job state, RPCs, usage events, and media asset metadata. Cloudflare Workers + R2 handle media bytes behind signed Woven URLs, while Trigger.dev Cloud executes and reconciles provider jobs.

**Tech Stack:** Next.js 16.2.3 route handlers, Supabase SQL/RPCs, Cloudflare Workers + R2, Trigger.dev 4.5.0, Vercel Cron, Fal, ElevenLabs, Vitest, pnpm.

**Docs digest:** `docs/superpowers/research/2026-07-07-hosted-media-production-deploy-docs.md`

## Global Constraints

- This is a deployment plan. Do not edit product code unless a gate fails and the user explicitly approves a fix.
- Use `pnpm`; do not switch package managers.
- Do not stage or commit the untracked `pnpm-workspace.yaml` unless the user explicitly asks.
- Deploy Cloudflare Worker, Trigger tasks, Vercel app, and Supabase migrations from the same final code state.
- Do not merge to `main` until Cloudflare Worker, Supabase migrations, and Trigger production tasks are ready; Vercel auto-deploy on `main` merge is the activation step.
- Production media upload completion mode must be `callback`; `MEDIA_UPLOAD_COMPLETION_MODE=manual` is local/provider-smoke only and is rejected in production.
- `MEDIA_TOKEN_SECRET` must be identical between the Vercel app and the Cloudflare media Worker for the same environment.
- `MEDIA_WORKER_SHARED_SECRET` must be identical between the Vercel app and the Cloudflare media Worker for the same environment.
- Never send `MEDIA_WORKER_SHARED_SECRET`, Supabase service role keys, Trigger keys, Fal keys, or Worker secrets to Harness or any client.
- Do not route all of `media.woven.video/*` to the Worker. Only `/uploads/*`, `/objects/*`, and `/internal/*` belong to the Worker because top-level hero assets still live on the same host.
- Production rollback should prefer disabling hosted media catalog rows and rolling Vercel/Worker deployments forward or back. Do not attempt destructive DB rollback after production migrations without a database backup and explicit approval.

---

## Deployment Surface Map

| Surface | Files / source of truth | Production responsibility |
| --- | --- | --- |
| Vercel app | `app/api/v1/media/*`, `app/api/internal/media/*`, `vercel.json`, `lib/media/*` | Auth, model catalog, upload slots, job creation/status/cancel, Fal webhook receiver, cleanup cron route |
| Supabase | `supabase/migrations/20260701120000_hosted_media_jobs.sql` through `20260706124000_disable_slack_notifications_for_test_identities.sql` | `media_assets`, media job RPCs, reservations/settlement caps, reconciliation, runtime catalog, chat-model removal, Slack test guard |
| Cloudflare Worker | `workers/media/index.ts`, `workers/media/wrangler.jsonc` | Signed upload/download/delete routes backed by R2 |
| Trigger.dev | `trigger.config.ts`, `trigger/media.ts`, `lib/media/trigger-dispatch.ts`, `lib/media/executor.ts` | `process-media-job`, per-kind queues, provider polling/waits, `reconcile-media-jobs` schedule |
| Production runbook | `docs/media-worker-deploy.md` | Existing deploy order, env matrix, local smoke and DB test notes |

---

### Task 1: Freeze The Deploy Commit And Run Local Preflight

**Files:**
- Read: `package.json`
- Read: `pnpm-lock.yaml`
- Read: `supabase/migrations/*.sql`
- Read: `docs/media-worker-deploy.md`
- No modifications

**Interfaces:**
- Consumes: current branch `feat/credit-models`, current HEAD, local Supabase/Docker for DB tests.
- Produces: one exact commit SHA that is safe to deploy across Vercel, Trigger, Cloudflare, and Supabase.

- [ ] **Step 1: Refresh remote refs**

```bash
git fetch origin
```

Expected: exits 0.

- [ ] **Step 2: Check branch and dirty state**

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

Expected:
- branch is `feat/credit-models`
- no tracked file changes
- the only acceptable untracked file is `pnpm-workspace.yaml`
- record the `HEAD` SHA in the deployment notes

- [ ] **Step 3: Update this feature branch against current `origin/main` before deploying**

Use one of these on `feat/credit-models`, matching the repo's normal branch-update policy:

```bash
git rebase origin/main
```

or:

```bash
git merge origin/main
```

Expected: exits 0. If conflicts appear, stop deployment preparation and resolve them before continuing.

- [ ] **Step 4: Verify install and pinned Trigger CLI**

```bash
CI=true pnpm install --frozen-lockfile
CI=true pnpm exec trigger --version
```

Expected: install exits 0, and Trigger CLI prints `4.5.0`.

- [ ] **Step 5: Run non-DB checks**

```bash
git diff --check
CI=true pnpm test
CI=true pnpm lint
CI=true pnpm run build
```

Expected:
- `git diff --check` exits 0
- test suite exits 0
- lint exits 0; existing warnings are acceptable only if they match the known unused-disable / unused-parameter warnings
- build exits 0

- [ ] **Step 6: Run SQL/RPC integration tests locally**

```bash
supabase start
supabase db reset
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SUPABASE_SERVICE_ROLE_KEY" CI=true pnpm run test:media-db
```

Expected: `tests/media/db-rpcs.integration.test.ts` passes. If the sandbox blocks local Postgres, rerun the same command outside the sandbox before deploying.

- [ ] **Step 7: Push the final branch commit**

```bash
git push origin feat/credit-models
```

Expected: remote branch contains the exact commit from Step 2 after any branch update. Do not merge to `main` yet.

---

### Task 2: Prepare Production Secrets And Environment Variables

**Files:**
- Read: `.env.example`
- Read: `lib/media/env.ts`
- Read: `workers/media/wrangler.jsonc`
- Read: `docs/media-worker-deploy.md`
- No modifications

**Interfaces:**
- Consumes: production Supabase project, Vercel project, Trigger.dev project, Cloudflare account for `woven.video`.
- Produces: consistent secret/env state before any production deploy starts processing media jobs.

- [ ] **Step 1: Generate or choose secret values**

Generate fresh random production values if they do not already exist:

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 32
```

Use them as:
- first value: `MEDIA_TOKEN_SECRET`
- second value: `MEDIA_WORKER_SHARED_SECRET`
- third value: `CRON_SECRET`

Expected: each media secret is at least 32 characters, and `CRON_SECRET` is at least 16 characters.

- [ ] **Step 2: Set Vercel production media env**

Set these in the Vercel project production environment:

```text
MEDIA_BASE_URL=https://media.woven.video
MEDIA_UPLOAD_COMPLETION_MODE=callback
MEDIA_TOKEN_SECRET=$PRODUCTION_MEDIA_TOKEN_SECRET
MEDIA_WORKER_SHARED_SECRET=$PRODUCTION_MEDIA_WORKER_SHARED_SECRET
MEDIA_MAX_UPLOAD_BYTES=104857600
MEDIA_UPLOAD_URL_TTL_SECONDS=900
MEDIA_DOWNLOAD_URL_TTL_SECONDS=900
MEDIA_OUTPUT_RETENTION_SECONDS=2592000
MEDIA_JOB_TIMEOUT_SECONDS=3600
MEDIA_FAL_WEBHOOK_BASE_URL=https://www.woven.video
FAL_WEBHOOK_JWKS_URL=
TRIGGER_PROJECT_REF=$PRODUCTION_TRIGGER_PROJECT_REF
TRIGGER_SECRET_KEY=$PRODUCTION_TRIGGER_SECRET_KEY
TRIGGER_ACCESS_TOKEN=$PRODUCTION_TRIGGER_ACCESS_TOKEN
CRON_SECRET=$PRODUCTION_CRON_SECRET
FAL_KEY=$PRODUCTION_FAL_KEY
ELEVENLABS_API_KEY=$PRODUCTION_ELEVENLABS_API_KEY
```

Expected: Vercel production has all keys above. `MEDIA_UPLOAD_COMPLETION_MODE` must be `callback`, not `manual`.

- [ ] **Step 3: Verify existing production app env still exists**

Confirm these existing production variables are still present:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_LICENSE_PRICE_ID
STRIPE_SUBSCRIPTION_PRICE_ID
AI_GATEWAY_API_KEY
AI_GATEWAY_BASE_URL
EXA_API_KEY
WOVEN_SITE_URL=https://www.woven.video
WOVEN_ALLOWED_ORIGIN=https://www.woven.video
WOVEN_ENFORCE_LICENSE=false
```

Expected: all are present. Keep `WOVEN_ENFORCE_LICENSE=false` until the production Harness build expects `license_required` responses.

- [ ] **Step 4: Set Trigger.dev production env**

In the Trigger.dev production environment for the Woven project, set exactly these runtime keys:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
FAL_KEY
ELEVENLABS_API_KEY
MEDIA_BASE_URL=https://media.woven.video
MEDIA_UPLOAD_COMPLETION_MODE=callback
MEDIA_TOKEN_SECRET=$PRODUCTION_MEDIA_TOKEN_SECRET
MEDIA_WORKER_SHARED_SECRET=$PRODUCTION_MEDIA_WORKER_SHARED_SECRET
MEDIA_MAX_UPLOAD_BYTES=104857600
MEDIA_UPLOAD_URL_TTL_SECONDS=900
MEDIA_DOWNLOAD_URL_TTL_SECONDS=900
MEDIA_OUTPUT_RETENTION_SECONDS=2592000
MEDIA_JOB_TIMEOUT_SECONDS=3600
MEDIA_FAL_WEBHOOK_BASE_URL=https://www.woven.video
FAL_WEBHOOK_JWKS_URL=
```

Expected: Trigger tasks can read the same Supabase, provider, and media settings as the Vercel app.

- [ ] **Step 5: Check whether the production Cloudflare Worker already exists**

```bash
npx wrangler secret list --config workers/media/wrangler.jsonc
```

Expected:
- If the Worker exists, the command lists secret names or an empty list.
- If the Worker does not exist, the command fails with `Worker "woven-media" not found`; continue in Task 3 with the first-time Worker creation path.

- [ ] **Step 6: Set Cloudflare Worker production secrets if the Worker already exists**

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc
```

Expected: both secrets are stored for the top-level `woven-media` Worker environment. Use the exact same production values from Vercel. If Step 5 reported that the Worker is missing, skip this step for now and set the secrets in Task 3 after the first Worker deploy creates it.

---

### Task 3: Deploy And Verify The Production Cloudflare Media Worker

**Files:**
- Read: `workers/media/index.ts`
- Read: `workers/media/wrangler.jsonc`
- Read: `docs/landing-page-media.md`
- No modifications

**Interfaces:**
- Consumes: Cloudflare account, `woven-media` R2 bucket, `media.woven.video` proxied routes, Worker secrets from Task 2.
- Produces: public signed media upload/download/delete routes that do not interfere with top-level landing media.

- [ ] **Step 1: Verify Cloudflare account and bucket**

```bash
npx wrangler whoami
npx wrangler r2 bucket list
```

Expected: Wrangler is authenticated to the Cloudflare account that owns `woven.video`, and `woven-media` appears in the bucket list.

- [ ] **Step 2: Create `woven-media` only if missing**

```bash
npx wrangler r2 bucket create woven-media
```

Expected: run only if Step 1 did not show `woven-media`; otherwise skip this command.

- [ ] **Step 3: Deploy the Worker to create or update it**

```bash
pnpm run media:edge:deploy
```

Expected: deployment exits 0 for Worker `woven-media`.

- [ ] **Step 4: Set production Worker secrets after first-time Worker creation if needed**

Run this step if Task 2 Step 5 reported `Worker "woven-media" not found` before Task 3 Step 3:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc
```

Expected: both secrets are stored for the top-level `woven-media` Worker environment. Use the exact same production values from Vercel.

- [ ] **Step 5: Verify production Worker secret names**

```bash
npx wrangler secret list --config workers/media/wrangler.jsonc
```

Expected: lists both `MEDIA_TOKEN_SECRET` and `MEDIA_WORKER_SHARED_SECRET`.

- [ ] **Step 6: Verify routes are scoped**

Check Cloudflare routes match `workers/media/wrangler.jsonc`:

```text
media.woven.video/uploads/*
media.woven.video/objects/*
media.woven.video/internal/*
```

Expected: no route for plain `media.woven.video/*`.

- [ ] **Step 7: Verify top-level landing assets still bypass the Worker**

```bash
curl -sI https://media.woven.video/woven-hero-v4.mp4
curl -sI https://media.woven.video/woven-hero-v4.png
```

Expected: both return HTTP 200. If either fails after Worker deploy, stop before Vercel deploy because route scope is wrong.

- [ ] **Step 8: Verify protected object route rejects unsigned access**

```bash
curl -s -o /tmp/woven-media-worker-unsigned.txt -w "%{http_code}\n" https://media.woven.video/objects/not-a-real-asset
cat /tmp/woven-media-worker-unsigned.txt
```

Expected: HTTP `401` with `Unauthorized`.

---

### Task 4: Apply Production Supabase Migrations And Verify Catalog/Billing State

**Files:**
- Read: `supabase/migrations/20260701120000_hosted_media_jobs.sql`
- Read: `supabase/migrations/20260703180000_seed_media_runtime_catalog.sql`
- Read: `supabase/migrations/20260706120000_cap_media_settlement.sql`
- Read: `supabase/migrations/20260706121000_media_reconciliation_lease_fix.sql`
- Read: `supabase/migrations/20260706122000_reseed_gpt_image_sized_rates.sql`
- Read: `supabase/migrations/20260706123000_disable_redundant_hosted_chat_models.sql`
- Read: `supabase/migrations/20260706124000_disable_slack_notifications_for_test_identities.sql`
- No modifications

**Interfaces:**
- Consumes: production Supabase project, final branch commit.
- Produces: production schema/RPC/catalog state compatible with the new app and Trigger executor.

- [ ] **Step 1: Take or verify a production database backup**

Use the Supabase dashboard backup/snapshot mechanism for the production project.

Expected: a restorable backup exists before applying the July 2026 migration batch.

- [ ] **Step 2: Link CLI to the production Supabase project**

```bash
supabase link --project-ref "$SUPABASE_PROD_PROJECT_REF"
supabase migration list
```

Expected: `supabase migration list` points to the production project and shows pending migrations from this branch.

- [ ] **Step 3: Apply migrations**

```bash
supabase db push
```

Expected: exits 0 and applies every migration through:

```text
20260706124000_disable_slack_notifications_for_test_identities.sql
```

- [ ] **Step 4: Verify media schema and RPC tail**

Run in the production SQL console or via `psql "$SUPABASE_PROD_DB_URL"`:

```sql
select to_regclass('public.media_assets') as media_assets_table;

select exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'generation_jobs'
    and column_name = 'provider_attempt_nonce'
) as has_provider_attempt_nonce;

select
  proname,
  count(*) as overloads
from pg_proc
where proname in (
  'claim_media_job_by_id',
  'record_media_job_trigger_dispatch',
  'find_media_jobs_for_trigger_reconciliation',
  'finalize_expired_media_jobs_for_reconciliation',
  'record_and_settle_claimed_media_job',
  'settle_claimed_media_job'
)
group by proname
order by proname;
```

Expected:
- `media_assets_table = public.media_assets`
- `has_provider_attempt_nonce = true`
- every listed RPC appears

- [ ] **Step 5: Verify enabled media catalog rows**

```sql
select
  operation,
  count(*) filter (where enabled) as enabled_count
from public.model_pricing_rules
where operation in (
  'image_generation',
  'video_generation',
  'text_to_speech',
  'sound_effects',
  'music_generation',
  'reel_captions'
)
group by operation
order by operation;

select provider, model, operation, enabled
from public.model_pricing_rules
where model in (
  'google/nano-banana-2-lite',
  'google/nano-banana-2-lite/edit',
  'fal-ai/nano-banana-lite',
  'fal-ai/nano-banana-lite/edit'
)
order by model;
```

Expected:
- image/video/audio generation rows exist and have enabled rows
- `google/nano-banana-2-lite` and `google/nano-banana-2-lite/edit` are enabled
- old `fal-ai/nano-banana-lite` rows are disabled if present

- [ ] **Step 6: Verify redundant hosted chat models are disabled**

```sql
select provider, model, operation, enabled
from public.model_pricing_rules
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and model in (
    'anthropic/claude-haiku-4.5',
    'xai/grok-4.3'
  )
order by model;
```

Expected: any returned rows have `enabled = false`.

---

### Task 5: Deploy Trigger.dev Tasks From The Same Commit

**Files:**
- Read: `trigger.config.ts`
- Read: `trigger/media.ts`
- Read: `lib/media/trigger-dispatch.ts`
- No modifications

**Interfaces:**
- Consumes: Trigger production project ref, Trigger deploy token, production runtime env from Task 2, migrated Supabase DB from Task 4.
- Produces: deployed `process-media-job` and `reconcile-media-jobs` tasks.

- [ ] **Step 1: Confirm local env for deploy command**

```bash
test -n "$TRIGGER_PROJECT_REF"
test -n "$TRIGGER_ACCESS_TOKEN"
CI=true pnpm exec trigger --version
```

Expected: `test` commands exit 0 and Trigger CLI version is `4.5.0`.

- [ ] **Step 2: Deploy Trigger tasks**

```bash
TRIGGER_PROJECT_REF="$TRIGGER_PROJECT_REF" TRIGGER_ACCESS_TOKEN="$TRIGGER_ACCESS_TOKEN" pnpm run trigger:deploy
```

Expected: deploy exits 0.

- [ ] **Step 3: Verify Trigger tasks and schedule**

In the Trigger.dev dashboard for the production project, verify:

```text
process-media-job
reconcile-media-jobs
```

Expected:
- `process-media-job` is deployed
- `reconcile-media-jobs` is scheduled with cron `*/5 * * * *`
- media queues/tags are visible on test runs after smoke:
  - `media-kind:image`
  - `media-kind:video`
  - `media-kind:audio`
  - `media-dispatch-source:create`
  - `media-dispatch-source:reconcile`
  - `media-dispatch-source:webhook`

---

### Task 6: Activate Vercel Auto-Deploy And Confirm Cron Registration

**Files:**
- Read: `vercel.json`
- Read: `app/api/internal/media/cleanup/route.ts`
- Read: `app/api/v1/media/webhooks/fal/[[...hint]]/route.ts`
- No modifications

**Interfaces:**
- Consumes: Vercel production env from Task 2, Cloudflare Worker from Task 3, Supabase migrations from Task 4, Trigger tasks from Task 5.
- Produces: production API routes and daily media cleanup cron after the `main` merge triggers Vercel auto-deploy.

- [ ] **Step 1: Verify all pre-Vercel gates are complete**

Confirm these tasks are complete before merging:

```text
Task 2: production env/secrets set
Task 3: Cloudflare media Worker deployed and scoped routes verified
Task 4: production Supabase migrations applied and catalog verified
Task 5: Trigger.dev production tasks deployed
```

Expected: every pre-Vercel dependency is ready. If any item is incomplete, do not merge to `main`.

- [ ] **Step 2: Merge to `main` to trigger Vercel auto-deploy**

Preferred path: merge the reviewed branch or PR into `main` using the repo's normal GitHub flow.

If using the GitHub CLI, first verify the PR target and merge method:

```bash
gh pr view --json baseRefName,headRefName,mergeStateStatus
```

Expected: `baseRefName` is `main`, `headRefName` is `feat/credit-models`, and the PR is mergeable.

Then merge only after explicit approval for production activation:

```bash
gh pr merge
```

Expected: the merge to `main` starts the Vercel production auto-deploy.

Manual fallback only if auto-deploy is disabled or fails to start:

```bash
vercel deploy --prod
```

Expected: Vercel production deployment completes successfully.

- [ ] **Step 3: Inspect production deployment**

```bash
vercel ls --prod
```

Expected: latest production deployment points at the `main` merge commit or an equivalent production build containing the final branch code from Task 1.

- [ ] **Step 4: Confirm cron config**

Verify `vercel.json` in the deployed commit contains:

```json
{
  "crons": [
    {
      "path": "/api/internal/media/cleanup",
      "schedule": "0 8 * * *"
    }
  ]
}
```

Expected: Vercel shows a daily production cron for `/api/internal/media/cleanup`.

- [ ] **Step 5: Manually verify cleanup route authorization**

```bash
curl -s -o /tmp/woven-cleanup-unauthorized.json -w "%{http_code}\n" https://www.woven.video/api/internal/media/cleanup
cat /tmp/woven-cleanup-unauthorized.json
```

Expected: HTTP `401`.

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://www.woven.video/api/internal/media/cleanup
```

Expected: JSON with `deleted_count` and `object_delete_count`. Running this once manually is safe because cleanup is idempotent.

---

### Task 7: Production API Smoke Test With A Real Account

**Files:**
- Read: `app/api/v1/media/models/route.ts`
- Read: `app/api/v1/media/uploads/route.ts`
- Read: `app/api/v1/media/jobs/route.ts`
- Read: `app/api/v1/media/jobs/[jobId]/route.ts`
- No modifications

**Interfaces:**
- Consumes: production bearer token for a test Woven account with enough credits.
- Produces: proof that model catalog, job reservation, Trigger execution, Fal provider calls, R2 output storage, and signed output reads work in production.

- [ ] **Step 1: Export a production test token**

```bash
test -n "$PROD_WOVEN_BEARER_TOKEN"
```

Expected: exits 0. Do not paste the token into shell history if your shell persists secrets.

- [ ] **Step 2: Verify authenticated balance and model catalog**

```bash
curl -fsS https://www.woven.video/api/v1/billing/balance \
  -H "Authorization: Bearer $PROD_WOVEN_BEARER_TOKEN"

curl -fsS "https://www.woven.video/api/v1/media/models?kind=image" \
  -H "Authorization: Bearer $PROD_WOVEN_BEARER_TOKEN" \
  -o /tmp/woven-prod-image-models.json

jq '.models[] | {id, kind, operation, supports_uploaded_inputs}' /tmp/woven-prod-image-models.json
```

Expected:
- balance route returns 200
- image catalog includes `google/nano-banana-2-lite`
- catalog rows include `parameter_schema` and `input_asset_schema`

- [ ] **Step 3: Create a low-cost text-to-image job**

```bash
curl -fsS -X POST https://www.woven.video/api/v1/media/jobs \
  -H "Authorization: Bearer $PROD_WOVEN_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/nano-banana-2-lite",
    "parameters": {
      "prompt": "A small blue ceramic cup on a white studio table.",
      "num_images": 1,
      "aspect_ratio": "1:1",
      "output_format": "png",
      "sync_mode": false,
      "limit_generations": true,
      "safety_tolerance": "4"
    }
  }' \
  -o /tmp/woven-prod-image-job.json

jq . /tmp/woven-prod-image-job.json
```

Expected: response has `id`, `status` is `queued`, and `reserved_credits_usd_micros` is nonzero.

- [ ] **Step 4: Poll until terminal**

```bash
JOB_ID="$(jq -r '.id' /tmp/woven-prod-image-job.json)"
for i in $(seq 1 60); do
  curl -fsS "https://www.woven.video/api/v1/media/jobs/$JOB_ID" \
    -H "Authorization: Bearer $PROD_WOVEN_BEARER_TOKEN" \
    -o /tmp/woven-prod-image-job-status.json
  jq '{id,status,error,outputs,final_cost_usd_micros,reserved_credits_usd_micros}' /tmp/woven-prod-image-job-status.json
  STATUS="$(jq -r '.status' /tmp/woven-prod-image-job-status.json)"
  test "$STATUS" = "succeeded" && break
  test "$STATUS" = "failed" && exit 1
  sleep 5
done
test "$(jq -r '.status' /tmp/woven-prod-image-job-status.json)" = "succeeded"
```

Expected: job reaches `succeeded` and has at least one signed output URL.

- [ ] **Step 5: Verify signed output URL**

```bash
OUTPUT_URL="$(jq -r '.outputs[0].url' /tmp/woven-prod-image-job-status.json)"
curl -sI "$OUTPUT_URL"
```

Expected: HTTP `200` and an image content type.

- [ ] **Step 6: Verify DB accounting for the smoke job**

Run in production SQL console or `psql "$SUPABASE_PROD_DB_URL"`:

```sql
select
  id,
  type,
  status,
  provider,
  provider_job_id,
  error,
  reserved_amount_usd_micros,
  final_cost_usd_micros,
  completed_at
from public.generation_jobs
where id = 'PASTE_JOB_ID_FROM_STEP_4';
```

Expected:
- `type = media_job`
- `status = succeeded`
- `provider = fal`
- `provider_job_id` is not null
- `error` is null
- `final_cost_usd_micros <= reserved_amount_usd_micros`

---

### Task 8: Production Uploaded-Input Smoke Test

**Files:**
- Read: `app/api/v1/media/uploads/route.ts`
- Read: `app/api/v1/media/uploads/[assetId]/complete/route.ts`
- Read: `app/api/internal/media/uploads/complete/route.ts`
- Read: `workers/media/index.ts`
- No modifications

**Interfaces:**
- Consumes: production bearer token, production Worker, production R2, Fal key.
- Produces: proof that Fal can fetch Woven-signed input URLs from production R2.

- [ ] **Step 1: Create a tiny PNG smoke file**

```bash
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=' | base64 -D > /tmp/woven-smoke.png
SMOKE_SIZE="$(wc -c < /tmp/woven-smoke.png | tr -d ' ')"
```

Expected: `/tmp/woven-smoke.png` exists and `SMOKE_SIZE` is greater than `0`.

- [ ] **Step 2: Create an upload slot**

```bash
curl -fsS -X POST https://www.woven.video/api/v1/media/uploads \
  -H "Authorization: Bearer $PROD_WOVEN_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"purpose\":\"media_input\",\"filename\":\"woven-smoke.png\",\"content_type\":\"image/png\",\"size_bytes\":$SMOKE_SIZE}" \
  -o /tmp/woven-prod-upload.json

jq . /tmp/woven-prod-upload.json
```

Expected:
- `upload_url` starts with `https://media.woven.video/uploads/`
- response does not include `completion`, because production completion mode is `callback`

- [ ] **Step 3: PUT bytes to the Worker upload URL**

```bash
UPLOAD_URL="$(jq -r '.upload_url' /tmp/woven-prod-upload.json)"
curl -fsS -X PUT "$UPLOAD_URL" \
  -H "Content-Type: image/png" \
  -H "Content-Length: $SMOKE_SIZE" \
  --data-binary @/tmp/woven-smoke.png
```

Expected: upload returns JSON `{ "ok": true }`. The Worker callback should mark the asset uploaded in production Supabase.

- [ ] **Step 4: Create an uploaded-input edit job**

```bash
ASSET_ID="$(jq -r '.asset_id' /tmp/woven-prod-upload.json)"
curl -fsS -X POST https://www.woven.video/api/v1/media/jobs \
  -H "Authorization: Bearer $PROD_WOVEN_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"google/nano-banana-2-lite/edit\",
    \"input_assets\": [
      { \"asset_id\": \"$ASSET_ID\", \"role\": \"reference_images\" }
    ],
    \"parameters\": {
      \"prompt\": \"Turn the tiny image into a simple blue square icon on a white background.\",
      \"num_images\": 1,
      \"aspect_ratio\": \"1:1\",
      \"output_format\": \"png\",
      \"sync_mode\": false,
      \"limit_generations\": true,
      \"safety_tolerance\": \"4\"
    }
  }" \
  -o /tmp/woven-prod-upload-job.json

jq . /tmp/woven-prod-upload-job.json
```

Expected: response has `status = queued`.

- [ ] **Step 5: Poll uploaded-input job until terminal**

```bash
UPLOAD_JOB_ID="$(jq -r '.id' /tmp/woven-prod-upload-job.json)"
for i in $(seq 1 60); do
  curl -fsS "https://www.woven.video/api/v1/media/jobs/$UPLOAD_JOB_ID" \
    -H "Authorization: Bearer $PROD_WOVEN_BEARER_TOKEN" \
    -o /tmp/woven-prod-upload-job-status.json
  jq '{id,status,error,outputs,final_cost_usd_micros,reserved_credits_usd_micros}' /tmp/woven-prod-upload-job-status.json
  STATUS="$(jq -r '.status' /tmp/woven-prod-upload-job-status.json)"
  test "$STATUS" = "succeeded" && break
  test "$STATUS" = "failed" && exit 1
  sleep 5
done
test "$(jq -r '.status' /tmp/woven-prod-upload-job-status.json)" = "succeeded"
```

Expected: job reaches `succeeded`. If it fails with provider download errors, stop rollout because production Fal cannot fetch Woven media URLs.

---

### Task 9: Production Monitoring And Rollback Gates

**Files:**
- Read: `lib/media/trigger-dispatch.ts`
- Read: `app/api/v1/media/jobs/[jobId]/route.ts`
- Read: `app/api/internal/media/cleanup/route.ts`
- No modifications unless rollback is explicitly approved.

**Interfaces:**
- Consumes: production logs/dashboards across Vercel, Trigger, Cloudflare, and Supabase.
- Produces: go/no-go decision for broader Harness rollout.

- [ ] **Step 1: Monitor Trigger runs**

In Trigger.dev production dashboard, inspect runs for:

```text
process-media-job
reconcile-media-jobs
```

Expected:
- smoke jobs have `media-dispatch-source:create`
- Fal webhook wakes have `media-dispatch-source:webhook`
- reconciliation runs do not repeatedly redispatch the same already-terminal job
- no unexpected `model_not_enabled`, `provider_not_configured`, or `media_job_timed_out` for fresh smoke jobs

- [ ] **Step 2: Monitor Vercel logs**

Filter for:

```text
/api/v1/media/models
/api/v1/media/uploads
/api/v1/media/jobs
/api/v1/media/webhooks/fal
/api/internal/media/cleanup
```

Expected:
- no recurring 401s except intentional unauthenticated checks
- no `MEDIA_UPLOAD_COMPLETION_MODE=manual is not allowed in production`
- no missing media env errors
- Fal webhook route returns 200 for valid provider callbacks

- [ ] **Step 3: Monitor Cloudflare Worker logs**

Expected:
- upload PUTs reach `media.woven.video/uploads/*`
- output downloads reach `media.woven.video/objects/*`
- internal deletes are only accepted with `x-woven-media-worker-secret`
- no top-level hero asset traffic is served by the Worker route

- [ ] **Step 4: Disable hosted media if smoke fails after migrations**

Run only with explicit approval:

```sql
update public.model_pricing_rules
set enabled = false,
    updated_at = now()
where operation in (
  'image_generation',
  'video_generation',
  'text_to_speech',
  'sound_effects',
  'music_generation'
);
```

Expected: `/api/v1/media/models` stops returning generation models. This is the fastest rollback lever for media generation without reversing migrations.

- [ ] **Step 5: Re-enable redundant hosted chat models only if chat rollout breaks**

Run only with explicit approval:

```sql
update public.model_pricing_rules
set enabled = true,
    updated_at = now()
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and model in (
    'anthropic/claude-haiku-4.5',
    'xai/grok-4.3'
  );
```

Expected: old redundant hosted chat rows become visible again if the chat-model removal unexpectedly breaks production Harness.

- [ ] **Step 6: Stop cleanup cron without deleting code if needed**

If cleanup is deleting the wrong keys, rotate or unset `CRON_SECRET` in Vercel production so scheduled calls return 401, then redeploy a fix.

Expected: Vercel cron invocations fail closed and stop deleting objects until a corrected deploy is ready.

---

### Task 10: Harness Rollout Handoff

**Files:**
- Read: `docs/media-worker-deploy.md`
- Read: `app/api/v1/media/models/route.ts`
- Read: `app/api/v1/media/jobs/route.ts`
- No modifications in this repo.

**Interfaces:**
- Consumes: successful backend smoke tests from Tasks 7 and 8.
- Produces: safe enablement instructions for the Harness agent/app.

- [ ] **Step 1: Send Harness the production contract**

Provide this backend contract:

```text
Base URL: https://www.woven.video
Auth: Authorization: Bearer $WOVEN_SUPABASE_SESSION_TOKEN
Models: GET /api/v1/media/models and optional ?kind=image|video|audio|captions
Upload slot: POST /api/v1/media/uploads
Upload bytes: PUT returned upload_url
Production upload completion: automatic Worker callback, no manual completion call
Create job: POST /api/v1/media/jobs
Status: GET /api/v1/media/jobs/:jobId
Cancel queued job: POST /api/v1/media/jobs/:jobId/cancel
Costs: use estimated_cost_usd_micros, reserved_credits_usd_micros, final_cost_usd_micros from API responses
Model schemas: validate against parameter_schema and input_asset_schema from catalog
```

Expected: Harness does not hardcode provider model parameters or prices; it consumes the backend catalog.

- [ ] **Step 2: Keep Harness disabled until backend smoke is green**

Expected: production users do not see media generation tools until:
- Task 7 text-to-image smoke is green
- Task 8 uploaded-input smoke is green
- Trigger dashboard shows successful `process-media-job` runs
- Vercel logs show no recurring media route errors

---

## Self-Review

**Spec coverage:** The plan covers branch freeze, tests, Vercel env/cron, Cloudflare Worker/R2, Supabase migrations/catalog/billing changes, Trigger deployment, production smoke, monitoring, rollback, and Harness handoff.

**Placeholder scan:** Secret values and project references are intentionally represented as environment variables or dashboard-set values. No source file should receive secret literals.

**Type consistency:** Model IDs, route paths, env names, Trigger task IDs, cron path, SQL operation names, and Worker routes match the current branch files inspected for this plan.
