# Media Important Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining Important findings from Claude's hosted-media-jobs review after the two Critical findings were handled in `docs/superpowers/plans/2026-07-02-media-critical-fixes.md`.

**Architecture:** Keep the media-job system transactional at the database boundary: jobs are not claimable until credit reservation and input attachment are complete; cleanup claims objects before physical R2 deletion and only finalizes DB deletion after the Worker confirms deletion. Fal callbacks become real production callbacks by wiring `webhookUrl`, verifying Fal signatures against a configured JWKS URL, and expiring the waiting-job lease so the worker polls immediately. Worker safety improves with provider diagnostics, job deadlines, lease heartbeats, and opt-in real Supabase RPC tests.

**Tech Stack:** Next.js 16.2.3 route handlers, Supabase SQL RPCs and supabase-js admin client, Cloudflare Worker R2 bindings, Vercel Cron, `@fal-ai/client@1.10.1`, Node `crypto`, Vitest.

**Docs digest:** `docs/superpowers/research/2026-07-02-media-important-fixes-docs.md`, plus the original hosted-media digest at `docs/superpowers/research/2026-07-01-hosted-generations-docs.md`.

**Review status:** Critical #1 (undeclared parameters) is fixed by commits `5ce9acc` and `0b1c55a`. Critical #2 (15-minute output URLs/retention) is fixed by commits `aec0528`, `e43513e`, `98edd59`, and `3f902d2`; Task 5 in that plan is complete because output download URLs are now re-signed on status reads.

**Verification commands:**
- Unit tests: `./node_modules/.bin/vitest run`
- Targeted unit tests: `./node_modules/.bin/vitest run tests/media/<file>.test.ts`
- Types: `./node_modules/.bin/tsc --noEmit`
- Lint: `./node_modules/.bin/eslint`
- Opt-in DB tests after `supabase start && supabase db reset`: `RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key> ./node_modules/.bin/vitest run tests/media/db-rpcs.integration.test.ts`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/20260702160000_media_job_readiness_deadlines_cleanup.sql` | Create | Add `creating` job status, `expires_at`, `deleting` asset status, claim readiness, deletion-claim RPCs, and lease heartbeat RPC |
| `lib/media/jobs.ts` | Modify | Insert jobs as `creating`, reserve/attach inputs, then publish as `queued` with a deadline |
| `tests/media/jobs.test.ts` | Modify | Cover non-claimable job creation and queued publication after reservation/attachment |
| `tests/media/worker.test.ts` | Modify | Cover SQL migration text, provider diagnostics, deadline, and heartbeat behavior |
| `workers/media/index.ts` | Modify | Add authenticated `POST /internal/delete` for R2 object deletion |
| `workers/media/types.d.ts` | Modify | Allow `R2Bucket.delete(string | string[])` |
| `lib/media/cleanup.ts` | Modify | Claim expired assets, call complete/release helpers, and expose physical deletion flow to the route |
| `app/api/internal/media/cleanup/route.ts` | Modify | Run cleanup from internal POST or Vercel Cron GET, call the media Worker delete endpoint, and finalize or release deletion claims |
| `vercel.json` | Create | Schedule daily production cleanup cron |
| `tests/media/cleanup.test.ts` | Modify | Cover claim/complete/release behavior and Worker delete failure handling |
| `tests/media/cleanup-route.test.ts` | Create | Cover secret check, Worker delete call, complete on success, release on failure |
| `workers/media/index.test.ts` or `tests/media/worker-r2.test.ts` | Create | Cover internal delete endpoint auth, validation, and batch delete call |
| `lib/media/providers/fal.ts` | Modify | Pass `webhookUrl` to `fal.queue.submit` when configured |
| `lib/media/providers/fal-webhooks.ts` | Create | Verify Fal webhook headers, timestamp tolerance, body digest, JWKS, and Ed25519 signature |
| `app/api/v1/media/webhooks/fal/route.ts` | Modify | Verify raw signed webhook body, update progress, and release the waiting lease |
| `tests/media/fal-webhook-route.test.ts` | Modify | Cover missing/invalid signatures and lease release on valid webhook |
| `tests/media/fal-webhooks.test.ts` | Create | Unit-test Fal signature verifier with generated Ed25519 keys |
| `lib/media/env.ts` | Modify | Add Fal webhook, media job timeout, and worker poll env settings |
| `tests/media/env.test.ts` | Modify | Cover new env settings |
| `.env.example` | Modify | Document new env vars |
| `docs/media-worker-deploy.md` | Create | Add deployment order, env/secrets, migration, Worker, and smoke-test runbook |
| `workers/media/wrangler.jsonc` | Create | Provide the Worker deployment config for `media.woven.video` and R2 binding |
| `package.json` | Modify | Add `media:worker:deploy` and `test:media-db` scripts |
| `lib/media/provider.ts` | Modify | Allow provider failure results with sanitized metadata |
| `lib/media/worker.ts` | Modify | Store provider diagnostics, enforce deadline, and heartbeat long leases |
| `tests/media/provider-adapters.test.ts` | Modify | Verify Fal submit includes `webhookUrl` when env is configured |
| `tests/media/db-rpcs.integration.test.ts` | Create | Opt-in local Supabase tests for claim, settle/release, and cancel RPC races |

---

### Task 1: Make media jobs claimable only after reservation and input attachment

**Files:**
- Create: `supabase/migrations/20260702160000_media_job_readiness_deadlines_cleanup.sql`
- Modify: `lib/media/jobs.ts`
- Test: `tests/media/jobs.test.ts`
- Test: `tests/media/worker.test.ts`

- [ ] **Step 1: Write the migration text tests**

Append these tests to `tests/media/worker.test.ts` in the migration/text area used by the existing SQL assertions:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("media job readiness migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260702160000_media_job_readiness_deadlines_cleanup.sql"),
    "utf8",
  );

  it("adds a non-claimable creating status", () => {
    expect(migration).toContain("'creating'");
    expect(migration).toContain("status in ('queued', 'running', 'waiting_provider')");
    expect(migration).not.toContain("status in ('creating', 'queued', 'running', 'waiting_provider')");
  });

  it("requires queued media jobs to have a reservation before claim", () => {
    expect(migration).toContain("coalesce(jobs.reserved_amount_usd_micros, 0) > 0");
  });

  it("requires queued input_asset_ids to be attached to the job before claim", () => {
    expect(migration).toContain("jsonb_array_elements_text");
    expect(migration).toContain("assets.job_id = jobs.id");
    expect(migration).toContain("assets.kind = 'input'");
    expect(migration).toContain("assets.status = 'attached'");
  });
});
```

Run: `./node_modules/.bin/vitest run tests/media/worker.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 2: Create the readiness and shared RPC migration**

Create `supabase/migrations/20260702160000_media_job_readiness_deadlines_cleanup.sql` with this content. Later tasks in this plan will fill the cleanup and heartbeat RPCs in the same migration, so create all of them now:

```sql
alter table public.generation_jobs
  drop constraint if exists generation_jobs_status_check;

alter table public.generation_jobs
  add constraint generation_jobs_status_check
  check (status in (
    'creating',
    'queued',
    'running',
    'waiting_provider',
    'downloading_outputs',
    'succeeded',
    'failed',
    'cancelled'
  ));

alter table public.generation_jobs
  add column if not exists expires_at timestamptz;

alter table public.media_assets
  drop constraint if exists media_assets_status_check;

alter table public.media_assets
  add constraint media_assets_status_check
  check (status in ('pending', 'uploaded', 'attached', 'ready', 'deleting', 'deleted', 'failed'));

create or replace function public.claim_media_jobs(
  p_limit integer default 1,
  p_lease_seconds integer default 300
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception 'claim_media_jobs_limit_out_of_range';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'claim_media_jobs_lease_seconds_out_of_range';
  end if;

  return query
  with candidates as (
    select jobs.id
    from public.generation_jobs jobs
    where jobs.type = 'media_job'
      and jobs.status in ('queued', 'running', 'waiting_provider')
      and (
        jobs.status = 'queued'
        or jobs.claim_expires_at is null
        or jobs.claim_expires_at < now()
      )
      and (
        jobs.status <> 'queued'
        or (
          coalesce(jobs.reserved_amount_usd_micros, 0) > 0
          and not exists (
            select 1
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(coalesce(jobs.input->'input_asset_ids', '[]'::jsonb)) = 'array'
                  then coalesce(jobs.input->'input_asset_ids', '[]'::jsonb)
                else '[]'::jsonb
              end
            ) as input_asset_id(asset_id)
            where not exists (
              select 1
              from public.media_assets assets
              where assets.id::text = input_asset_id.asset_id
                and assets.user_id = jobs.user_id
                and assets.job_id = jobs.id
                and assets.kind = 'input'
                and assets.status = 'attached'
            )
          )
        )
      )
    order by jobs.created_at asc
    for update skip locked
    limit p_limit
  )
  update public.generation_jobs jobs
  set status = case
        when jobs.status = 'queued' then 'running'
        else jobs.status
      end,
      started_at = coalesce(jobs.started_at, now()),
      claim_expires_at = now() + make_interval(secs => p_lease_seconds),
      claim_token = gen_random_uuid(),
      progress = coalesce(jobs.progress, '{}'::jsonb) || jsonb_build_object(
        'stage', case
          when jobs.status = 'queued' then 'claimed'
          else coalesce(jobs.progress->>'stage', jobs.status)
        end
      )
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

create or replace function public.extend_claimed_media_job_lease(
  p_job_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer default 300
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'media_job_lease_seconds_out_of_range';
  end if;

  update public.generation_jobs
  set claim_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_job_id
    and type = 'media_job'
    and claim_token = p_claim_token
    and status in ('running', 'waiting_provider', 'downloading_outputs')
    and (claim_expires_at is null or claim_expires_at >= now())
  returning * into v_job;

  if not found then
    raise exception 'media_job_stale_claim';
  end if;

  return v_job;
end;
$$;

create or replace function public.claim_expired_media_assets_for_deletion(
  p_now timestamptz default now(),
  p_limit integer default 100
)
returns table(id uuid, storage_key text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'media_asset_deletion_limit_out_of_range';
  end if;

  return query
  with candidates as (
    select assets.id, assets.status as previous_status
    from public.media_assets assets
    left join public.generation_jobs jobs on jobs.id = assets.job_id
    where assets.status <> 'deleting'
      and assets.status <> 'deleted'
      and (
        (assets.status in ('pending', 'uploaded') and assets.upload_expires_at is not null and assets.upload_expires_at < p_now)
        or (assets.kind = 'output' and assets.status = 'ready' and assets.download_expires_at is not null and assets.download_expires_at < p_now)
        or (assets.kind = 'input' and assets.status = 'attached' and jobs.status in ('succeeded', 'failed', 'cancelled'))
      )
    order by assets.created_at asc
    for update skip locked
    limit p_limit
  )
  update public.media_assets assets
  set status = 'deleting',
      metadata = coalesce(assets.metadata, '{}'::jsonb)
        || jsonb_build_object('delete_previous_status', candidates.previous_status),
      updated_at = now()
  from candidates
  where assets.id = candidates.id
  returning assets.id, assets.storage_key;
end;
$$;

create or replace function public.complete_media_asset_deletions(
  p_asset_ids uuid[],
  p_now timestamptz default now()
)
returns setof public.media_assets
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_asset_ids is null then
    raise exception 'media_asset_ids_required';
  end if;

  return query
  update public.media_assets assets
  set status = 'deleted',
      deleted_at = coalesce(assets.deleted_at, p_now),
      metadata = coalesce(assets.metadata, '{}'::jsonb) - 'delete_previous_status',
      updated_at = now()
  where assets.id = any(p_asset_ids)
    and assets.status = 'deleting'
  returning assets.*;
end;
$$;

create or replace function public.release_media_asset_deletion_claims(
  p_asset_ids uuid[]
)
returns setof public.media_assets
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_asset_ids is null then
    raise exception 'media_asset_ids_required';
  end if;

  return query
  update public.media_assets assets
  set status = coalesce(nullif(assets.metadata->>'delete_previous_status', ''), 'failed'),
      metadata = coalesce(assets.metadata, '{}'::jsonb) - 'delete_previous_status',
      updated_at = now()
  where assets.id = any(p_asset_ids)
    and assets.status = 'deleting'
  returning assets.*;
end;
$$;

revoke all on function public.claim_media_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_media_jobs(integer, integer) to service_role;

revoke all on function public.extend_claimed_media_job_lease(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_claimed_media_job_lease(uuid, uuid, integer) to service_role;

revoke all on function public.claim_expired_media_assets_for_deletion(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_expired_media_assets_for_deletion(timestamptz, integer) to service_role;

revoke all on function public.complete_media_asset_deletions(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.complete_media_asset_deletions(uuid[], timestamptz) to service_role;

revoke all on function public.release_media_asset_deletion_claims(uuid[]) from public, anon, authenticated;
grant execute on function public.release_media_asset_deletion_claims(uuid[]) to service_role;
```

- [ ] **Step 3: Update job creation tests**

In `tests/media/jobs.test.ts`, update the successful creation expectation so the `generation_jobs` insert uses `status: "creating"` and add an update expectation to publish the job as queued after reservation and attachment:

```ts
expect(admin.tables).toEqual([
  "media_assets",
  "generation_jobs",
  "media_assets",
  "generation_jobs",
]);

expect(admin.inserts[0]).toMatchObject({
  type: "media_job",
  status: "creating",
  progress: { stage: "creating", percent: null },
});

expect(admin.updates[0]).toMatchObject({
  status: "queued",
  progress: { stage: "queued", percent: 0 },
});
```

Add a failure-path assertion to the attachment-failure test:

```ts
expect(admin.updates).not.toContainEqual(expect.objectContaining({ status: "queued" }));
```

Run: `./node_modules/.bin/vitest run tests/media/jobs.test.ts`

Expected: FAIL because `lib/media/jobs.ts` still inserts queued jobs and does not publish with a second update.

- [ ] **Step 4: Publish queued jobs only after reservation and attachment**

In `lib/media/jobs.ts`, change the initial insert payload from queued to creating:

```ts
      status: "creating",
      progress: { stage: "creating", percent: null },
```

After `attachInputAssets(...)` succeeds and before returning, update the job:

```ts
  const { data: queuedJob, error: queueError } = await admin
    .from("generation_jobs")
    .update({
      status: "queued",
      progress: { stage: "queued", percent: 0 },
    })
    .eq("id", job.id)
    .eq("status", "creating")
    .select(JOB_SELECT)
    .single();

  if (queueError || !queuedJob) {
    await detachInputAssets(admin, inputAssetIds);
    await releaseReservedJob(admin, job.id, "media_job_queue_failed");
    throw new Error(queueError?.message ?? "media_job_queue_failed");
  }

  return normalizeMediaJobRow(queuedJob);
```

Keep the existing reserve-failure and attach-failure cleanup branches, but ensure they run before the queued update.

- [ ] **Step 5: Run readiness tests**

Run:

```bash
./node_modules/.bin/vitest run tests/media/jobs.test.ts tests/media/worker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260702160000_media_job_readiness_deadlines_cleanup.sql lib/media/jobs.ts tests/media/jobs.test.ts tests/media/worker.test.ts
git commit -m "fix: gate media job claims on readiness"
```

---

### Task 2: Add deployment runbook and Worker config

**Files:**
- Create: `workers/media/wrangler.jsonc`
- Create: `docs/media-worker-deploy.md`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Create the Worker deployment config**

Create `workers/media/wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "woven-media",
  "main": "index.ts",
  "compatibility_date": "2026-07-02",
  "routes": [
    {
      "pattern": "media.woven.video/*",
      "custom_domain": true
    }
  ],
  "r2_buckets": [
    {
      "binding": "MEDIA_BUCKET",
      "bucket_name": "woven-media"
    }
  ],
  "vars": {
    "WOVEN_API_BASE_URL": "https://www.woven.video",
    "MEDIA_MAX_UPLOAD_BYTES": "104857600"
  }
}
```

- [ ] **Step 2: Add the deploy script**

In `package.json`, add this script beside the existing media scripts:

```json
"media:worker:deploy": "wrangler deploy --config workers/media/wrangler.jsonc",
"test:media-db": "RUN_SUPABASE_DB_TESTS=1 vitest run tests/media/db-rpcs.integration.test.ts"
```

- [ ] **Step 3: Document env vars**

Append these entries to `.env.example` near the existing media env vars:

```dotenv
MEDIA_JOB_TIMEOUT_SECONDS=3600
MEDIA_WORKER_POLL_MS=5000
MEDIA_FAL_WEBHOOK_BASE_URL=https://www.woven.video
FAL_WEBHOOK_JWKS_URL=
CRON_SECRET=
```

Keep `FAL_WEBHOOK_JWKS_URL` empty in the example because the plan does not hard-code an unverified Fal JWKS endpoint.

- [ ] **Step 4: Add the deploy runbook**

Create `docs/media-worker-deploy.md`:

````md
# Media Worker Deployment

This runbook keeps the app, Supabase schema, media Worker, R2 bucket, and reel-captions client compatibility in the right order.

## Required Infrastructure

- Cloudflare R2 bucket: `woven-media`
- Cloudflare Worker route: `https://media.woven.video`
- Vercel app route: `https://www.woven.video`
- Supabase migrations through `20260702160000_media_job_readiness_deadlines_cleanup.sql`

## Worker Secrets

Set these before deploying the Worker:

```bash
wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc
wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc
```

The values must match the app's `MEDIA_TOKEN_SECRET` and `MEDIA_WORKER_SHARED_SECRET`.

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
FAL_WEBHOOK_JWKS_URL=<Fal JWKS URL from Fal webhook docs/dashboard>
CRON_SECRET=<random 16+ character secret for Vercel Cron>
```

## Deployment Order

1. Create or verify the `woven-media` R2 bucket.
2. Set Worker secrets with `wrangler secret put`.
3. Deploy the Worker with `npm run media:worker:deploy`.
4. Set app env vars in Vercel.
5. Apply Supabase migrations.
6. Deploy the app.
7. Start or restart the media worker process.
8. Confirm Vercel Cron is active for `/api/internal/media/cleanup`.
9. Smoke-test upload, job creation, job status, output download, Fal webhook, and cleanup.

## Smoke Tests

1. Create a temp upload asset through `POST /api/v1/media/uploads`.
2. PUT a small object to the returned `upload_url`.
3. Create a hosted media job that references the uploaded input.
4. Confirm the job starts as `queued`, then `running` or `waiting_provider`.
5. Confirm output URLs are absent in stored `generation_jobs.output` and present in `GET /api/v1/media/jobs/:jobId`.
6. Confirm `GET https://media.woven.video/objects/:assetId?token=...` returns the output before retention expiry.
7. Invoke `GET /api/internal/media/cleanup` with `Authorization: Bearer $CRON_SECRET` in staging and confirm expired R2 keys are deleted.

## Rollback Notes

- Do not roll back the app to a build that writes Supabase Storage reel-captions jobs after applying hosted-media-only client changes.
- If the Worker is unavailable, disable hosted media creation at the app/router layer before users create jobs.
- The cleanup path is idempotent for already-deleted R2 keys because R2 `delete` succeeds even when the object is absent.
````

- [ ] **Step 5: Run docs/config checks**

Run:

```bash
./node_modules/.bin/eslint
```

Expected: PASS with only the pre-existing warnings.

- [ ] **Step 6: Commit**

```bash
git add workers/media/wrangler.jsonc docs/media-worker-deploy.md package.json .env.example
git commit -m "docs: add media worker deployment runbook"
```

---

### Task 3: Wire and verify Fal webhooks

**Files:**
- Create: `lib/media/providers/fal-webhooks.ts`
- Modify: `lib/media/providers/fal.ts`
- Modify: `app/api/v1/media/webhooks/fal/route.ts`
- Modify: `lib/media/env.ts`
- Modify: `tests/media/provider-adapters.test.ts`
- Create: `tests/media/fal-webhooks.test.ts`
- Modify: `tests/media/fal-webhook-route.test.ts`

- [ ] **Step 1: Add env support tests**

In `tests/media/env.test.ts`, add:

```ts
it("parses Fal webhook and worker timing settings", () => {
  setMediaEnv({
    MEDIA_TOKEN_SECRET: "x".repeat(32),
    MEDIA_WORKER_SHARED_SECRET: "y".repeat(32),
    MEDIA_FAL_WEBHOOK_BASE_URL: "https://www.woven.video/",
    FAL_WEBHOOK_JWKS_URL: "https://fal.example/.well-known/jwks.json",
    MEDIA_JOB_TIMEOUT_SECONDS: "7200",
    MEDIA_WORKER_POLL_MS: "2500",
  });

  expect(getMediaEnv()).toMatchObject({
    falWebhookBaseUrl: "https://www.woven.video",
    falWebhookJwksUrl: "https://fal.example/.well-known/jwks.json",
    jobTimeoutSeconds: 7200,
    workerPollMs: 2500,
  });
});
```

Run: `./node_modules/.bin/vitest run tests/media/env.test.ts`

Expected: FAIL because these fields do not exist.

- [ ] **Step 2: Add env fields**

In `lib/media/env.ts`, extend `MediaEnv`:

```ts
  falWebhookBaseUrl: string | null;
  falWebhookJwksUrl: string | null;
  jobTimeoutSeconds: number;
  workerPollMs: number;
```

Add this helper:

```ts
function nullableUrlEnv(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}
```

Return the new fields from `getMediaEnv()`:

```ts
    falWebhookBaseUrl: nullableUrlEnv("MEDIA_FAL_WEBHOOK_BASE_URL"),
    falWebhookJwksUrl: nullableUrlEnv("FAL_WEBHOOK_JWKS_URL"),
    jobTimeoutSeconds: integerEnv("MEDIA_JOB_TIMEOUT_SECONDS", 60 * 60),
    workerPollMs: integerEnv("MEDIA_WORKER_POLL_MS", 5000),
```

- [ ] **Step 3: Write Fal adapter webhookUrl test**

In `tests/media/provider-adapters.test.ts`, add:

```ts
it("passes webhookUrl to Fal queue submit when configured", async () => {
  vi.stubEnv("MEDIA_TOKEN_SECRET", "x".repeat(32));
  vi.stubEnv("MEDIA_WORKER_SHARED_SECRET", "y".repeat(32));
  vi.stubEnv("MEDIA_FAL_WEBHOOK_BASE_URL", "https://www.woven.video/");
  const { falMediaAdapter } = await import("@/lib/media/providers/fal");
  mocks.falSubmit.mockResolvedValue({ request_id: "fal_req_webhook" });

  await falMediaAdapter.run({
    model: mediaModel(),
    parameters: { prompt: "a lake" },
    inputUrls: [],
  });

  expect(mocks.falSubmit).toHaveBeenCalledWith("fal-ai/frontier-video", {
    input: expect.any(Object),
    abortSignal: undefined,
    webhookUrl: "https://www.woven.video/api/v1/media/webhooks/fal",
  });
});
```

Run: `./node_modules/.bin/vitest run tests/media/provider-adapters.test.ts`

Expected: FAIL because `webhookUrl` is not passed.

- [ ] **Step 4: Wire `webhookUrl` in the Fal adapter**

In `lib/media/providers/fal.ts`, import env:

```ts
import { getMediaEnv } from "@/lib/media/env";
```

Before `fal.queue.submit`, compute options:

```ts
    const env = getMediaEnv();
    const webhookUrl = env.falWebhookBaseUrl
      ? `${env.falWebhookBaseUrl}/api/v1/media/webhooks/fal`
      : undefined;

    const submitOptions = {
      input,
      abortSignal: signal,
      ...(webhookUrl ? { webhookUrl } : {}),
    };
```

Then call:

```ts
    const submission = await fal.queue.submit(endpoint, submitOptions);
```

- [ ] **Step 5: Add Fal verifier unit tests**

Create `tests/media/fal-webhooks.test.ts`:

```ts
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyFalWebhookSignature } from "@/lib/media/providers/fal-webhooks";

function jwkFromPublicKey(publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]) {
  return publicKey.export({ format: "jwk" });
}

describe("verifyFalWebhookSignature", () => {
  it("verifies a Fal Ed25519 signature over the documented message", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const body = Buffer.from(JSON.stringify({ request_id: "fal_req_1" }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      requestId: "fal_req_1",
      userId: "fal_user_1",
      timestamp,
      signature: "",
    };
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const message = Buffer.from(`${headers.requestId}\n${headers.userId}\n${headers.timestamp}\n${bodyHash}`);
    headers.signature = sign(null, message, privateKey).toString("hex");

    await expect(verifyFalWebhookSignature({
      headers,
      rawBody: body,
      jwks: { keys: [jwkFromPublicKey(publicKey)] },
      nowSeconds: Number(timestamp),
    })).resolves.toBe(true);
  });

  it("rejects stale timestamps before checking signatures", async () => {
    await expect(verifyFalWebhookSignature({
      headers: {
        requestId: "fal_req_1",
        userId: "fal_user_1",
        timestamp: "100",
        signature: "00",
      },
      rawBody: Buffer.from("{}"),
      jwks: { keys: [] },
      nowSeconds: 1000,
    })).resolves.toBe(false);
  });
});
```

Run: `./node_modules/.bin/vitest run tests/media/fal-webhooks.test.ts`

Expected: FAIL because the verifier file does not exist.

- [ ] **Step 6: Implement the Fal verifier**

Create `lib/media/providers/fal-webhooks.ts`:

```ts
import { createHash, createPublicKey, verify } from "node:crypto";

import { getMediaEnv } from "@/lib/media/env";

type FalWebhookHeaders = {
  requestId: string;
  userId: string;
  timestamp: string;
  signature: string;
};

type JsonWebKeySet = {
  keys: JsonWebKey[];
};

const FIVE_MINUTES_SECONDS = 5 * 60;

export function falWebhookHeaders(request: Request): FalWebhookHeaders | null {
  const headers = {
    requestId: request.headers.get("x-fal-webhook-request-id")?.trim() ?? "",
    userId: request.headers.get("x-fal-webhook-user-id")?.trim() ?? "",
    timestamp: request.headers.get("x-fal-webhook-timestamp")?.trim() ?? "",
    signature: request.headers.get("x-fal-webhook-signature")?.trim() ?? "",
  };

  return headers.requestId && headers.userId && headers.timestamp && headers.signature
    ? headers
    : null;
}

export async function verifyFalWebhookSignature({
  headers,
  rawBody,
  jwks,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  headers: FalWebhookHeaders;
  rawBody: Uint8Array;
  jwks?: JsonWebKeySet;
  nowSeconds?: number;
}): Promise<boolean> {
  const timestamp = Number(headers.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > FIVE_MINUTES_SECONDS) {
    return false;
  }

  if (!/^[0-9a-f]+$/i.test(headers.signature) || headers.signature.length % 2 !== 0) {
    return false;
  }

  const keySet = jwks ?? await fetchFalWebhookJwks();
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const message = Buffer.from(`${headers.requestId}\n${headers.userId}\n${headers.timestamp}\n${bodyHash}`);
  const signature = Buffer.from(headers.signature, "hex");

  for (const jwk of keySet.keys) {
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" });
      if (verify(null, message, key, signature)) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

async function fetchFalWebhookJwks(): Promise<JsonWebKeySet> {
  const jwksUrl = getMediaEnv().falWebhookJwksUrl;
  if (!jwksUrl) {
    throw new Error("Missing FAL_WEBHOOK_JWKS_URL.");
  }

  const response = await fetch(jwksUrl, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Unable to fetch Fal webhook JWKS.");
  }

  const body = await response.json();
  if (!isJwks(body)) {
    throw new Error("Fal webhook JWKS response is invalid.");
  }
  return body;
}

function isJwks(value: unknown): value is JsonWebKeySet {
  return typeof value === "object"
    && value !== null
    && Array.isArray((value as { keys?: unknown }).keys);
}
```

- [ ] **Step 7: Update webhook route tests**

In `tests/media/fal-webhook-route.test.ts`, mock the verifier module:

```ts
vi.mock("@/lib/media/providers/fal-webhooks", () => ({
  falWebhookHeaders: vi.fn(() => ({
    requestId: "fal_req_1",
    userId: "fal_user_1",
    timestamp: "1780000000",
    signature: "abcd",
  })),
  verifyFalWebhookSignature: vi.fn(() => Promise.resolve(true)),
}));
```

Add a test for invalid signatures:

```ts
it("rejects unsigned Fal webhooks", async () => {
  const webhooks = await import("@/lib/media/providers/fal-webhooks");
  vi.mocked(webhooks.falWebhookHeaders).mockReturnValueOnce(null);
  const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");

  const response = await POST(new Request("https://www.woven.video/api/v1/media/webhooks/fal", {
    method: "POST",
    body: JSON.stringify({ request_id: "fal_req_1" }),
  }));

  expect(response.status).toBe(401);
});
```

In the success test, expect the DB update to expire the waiting lease:

```ts
expect(updatePayload).toMatchObject({
  claim_expires_at: "1970-01-01T00:00:00.000Z",
});
```

Run: `./node_modules/.bin/vitest run tests/media/fal-webhook-route.test.ts`

Expected: FAIL until the route verifies signatures and updates `claim_expires_at`.

- [ ] **Step 8: Verify raw webhook bodies and release the waiting lease**

In `app/api/v1/media/webhooks/fal/route.ts`, import the verifier:

```ts
import {
  falWebhookHeaders,
  verifyFalWebhookSignature,
} from "@/lib/media/providers/fal-webhooks";
```

Replace JSON parsing at the start of `POST` with raw-body verification:

```ts
  const rawBody = Buffer.from(await request.arrayBuffer());
  const headers = falWebhookHeaders(request);
  let verified = false;
  try {
    verified = headers
      ? await verifyFalWebhookSignature({ headers, rawBody })
      : false;
  } catch (error) {
    console.error("Failed to verify Fal media webhook", error);
  }

  if (!verified) {
    return apiError("Unauthorized.", 401, "unauthorized");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    payload = null;
  }
```

Add `claim_expires_at` to the Supabase update:

```ts
      claim_expires_at: "1970-01-01T00:00:00.000Z",
```

- [ ] **Step 9: Run webhook tests**

Run:

```bash
./node_modules/.bin/vitest run tests/media/env.test.ts tests/media/provider-adapters.test.ts tests/media/fal-webhooks.test.ts tests/media/fal-webhook-route.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/media/env.ts lib/media/providers/fal.ts lib/media/providers/fal-webhooks.ts app/api/v1/media/webhooks/fal/route.ts tests/media/env.test.ts tests/media/provider-adapters.test.ts tests/media/fal-webhooks.test.ts tests/media/fal-webhook-route.test.ts .env.example
git commit -m "fix: verify and wire fal media webhooks"
```

---

### Task 4: Delete expired media objects from R2 after DB deletion claims

**Files:**
- Modify: `workers/media/index.ts`
- Modify: `workers/media/types.d.ts`
- Modify: `lib/media/cleanup.ts`
- Modify: `app/api/internal/media/cleanup/route.ts`
- Create: `vercel.json`
- Modify: `.env.example`
- Modify: `tests/media/cleanup.test.ts`
- Create: `tests/media/cleanup-route.test.ts`

- [ ] **Step 1: Write cleanup helper tests**

Replace the existing expectations in `tests/media/cleanup.test.ts` with RPC-oriented assertions:

```ts
it("claims expired media assets for deletion", async () => {
  const nowIso = "2026-07-02T12:00:00.000Z";
  vi.setSystemTime(new Date(nowIso));
  const admin = createCleanupAdmin({
    claimRows: [{ id: "asset_1", storage_key: "users/u1/tmp/a.mp4" }],
  });

  await expect(claimExpiredMediaForDeletion({ limit: 100 })).resolves.toEqual([
    { id: "asset_1", storage_key: "users/u1/tmp/a.mp4" },
  ]);

  expect(admin.rpc).toHaveBeenCalledWith("claim_expired_media_assets_for_deletion", {
    p_now: nowIso,
    p_limit: 100,
  });
});

it("completes media asset deletions", async () => {
  const nowIso = "2026-07-02T12:00:00.000Z";
  vi.setSystemTime(new Date(nowIso));
  const admin = createCleanupAdmin();

  await completeMediaAssetDeletions(["asset_1"]);

  expect(admin.rpc).toHaveBeenCalledWith("complete_media_asset_deletions", {
    p_asset_ids: ["asset_1"],
    p_now: nowIso,
  });
});

it("releases media asset deletion claims", async () => {
  const admin = createCleanupAdmin();

  await releaseMediaAssetDeletionClaims(["asset_1"]);

  expect(admin.rpc).toHaveBeenCalledWith("release_media_asset_deletion_claims", {
    p_asset_ids: ["asset_1"],
  });
});
```

Run: `./node_modules/.bin/vitest run tests/media/cleanup.test.ts`

Expected: FAIL because the helpers do not exist.

- [ ] **Step 2: Implement cleanup helpers**

Replace `lib/media/cleanup.ts` with focused RPC helpers:

```ts
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type MediaDeletionCandidate = {
  id: string;
  storage_key: string;
};

export async function claimExpiredMediaForDeletion({
  limit = 100,
  nowIso = new Date().toISOString(),
}: {
  limit?: number;
  nowIso?: string;
} = {}): Promise<MediaDeletionCandidate[]> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "claim_expired_media_assets_for_deletion",
    {
      p_now: nowIso,
      p_limit: limit,
    },
  );

  if (error) throw new Error(error.message);
  return (data ?? []) as MediaDeletionCandidate[];
}

export async function completeMediaAssetDeletions(
  assetIds: string[],
  nowIso = new Date().toISOString(),
): Promise<void> {
  if (assetIds.length === 0) return;
  const { error } = await createSupabaseAdminClient().rpc(
    "complete_media_asset_deletions",
    {
      p_asset_ids: assetIds,
      p_now: nowIso,
    },
  );
  if (error) throw new Error(error.message);
}

export async function releaseMediaAssetDeletionClaims(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;
  const { error } = await createSupabaseAdminClient().rpc(
    "release_media_asset_deletion_claims",
    {
      p_asset_ids: assetIds,
    },
  );
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 3: Add Worker internal-delete behavior**

In `workers/media/types.d.ts`, update the R2 type:

```ts
delete(key: string | string[]): Promise<void>;
```

In `workers/media/index.ts`, add routing before the public object download:

```ts
    if (request.method === "POST" && url.pathname === "/internal/delete") {
      return handleInternalDelete(request, env);
    }
```

Add the handler:

```ts
async function handleInternalDelete(request: Request, env: Env): Promise<Response> {
  const provided = request.headers.get("x-woven-media-worker-secret") ?? "";
  if (!timingSafeEqual(provided, env.MEDIA_WORKER_SHARED_SECRET)) {
    return textResponse("Unauthorized", 401);
  }

  const payload = await request.json().catch(() => null);
  if (!isDeletePayload(payload)) {
    return textResponse("Invalid delete payload", 400);
  }

  await env.MEDIA_BUCKET.delete(payload.keys);
  return jsonResponse({ deleted_count: payload.keys.length });
}

function isDeletePayload(value: unknown): value is { keys: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const keys = (value as { keys?: unknown }).keys;
  return Array.isArray(keys)
    && keys.length > 0
    && keys.length <= 1000
    && keys.every((key) => typeof key === "string" && key.startsWith("users/"));
}
```

- [ ] **Step 4: Write cleanup route tests**

Create `tests/media/cleanup-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimExpiredMediaForDeletion: vi.fn(),
  completeMediaAssetDeletions: vi.fn(),
  releaseMediaAssetDeletionClaims: vi.fn(),
}));

vi.mock("@/lib/media/cleanup", () => mocks);
vi.mock("@/lib/media/env", () => ({
  getMediaEnv: () => ({
    workerSharedSecret: "s".repeat(32),
    baseUrl: "https://media.woven.video",
  }),
}));

describe("POST /api/internal/media/cleanup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    global.fetch = vi.fn();
    vi.stubEnv("CRON_SECRET", "cron_secret_123456");
  });

  it("deletes claimed R2 keys and completes DB deletion", async () => {
    mocks.claimExpiredMediaForDeletion.mockResolvedValue([
      { id: "asset_1", storage_key: "users/u1/tmp/a.mp4" },
    ]);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ deleted_count: 1 }), { status: 200 }));
    const { POST } = await import("@/app/api/internal/media/cleanup/route");

    const response = await POST(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "s".repeat(32) },
    }));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith("https://media.woven.video/internal/delete", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ keys: ["users/u1/tmp/a.mp4"] }),
    }));
    expect(mocks.completeMediaAssetDeletions).toHaveBeenCalledWith(["asset_1"]);
  });

  it("releases DB deletion claims when Worker deletion fails", async () => {
    mocks.claimExpiredMediaForDeletion.mockResolvedValue([
      { id: "asset_1", storage_key: "users/u1/tmp/a.mp4" },
    ]);
    vi.mocked(fetch).mockResolvedValue(new Response("bad", { status: 502 }));
    const { POST } = await import("@/app/api/internal/media/cleanup/route");

    const response = await POST(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "s".repeat(32) },
    }));

    expect(response.status).toBe(500);
    expect(mocks.releaseMediaAssetDeletionClaims).toHaveBeenCalledWith(["asset_1"]);
  });

  it("allows Vercel Cron GET requests with CRON_SECRET", async () => {
    mocks.claimExpiredMediaForDeletion.mockResolvedValue([]);
    const { GET } = await import("@/app/api/internal/media/cleanup/route");

    const response = await GET(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "GET",
      headers: {
        authorization: "Bearer cron_secret_123456",
        "x-vercel-cron-schedule": "0 8 * * *",
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.claimExpiredMediaForDeletion).toHaveBeenCalled();
  });

  it("rejects Vercel Cron GET requests without CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/internal/media/cleanup/route");

    const response = await GET(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "GET",
    }));

    expect(response.status).toBe(401);
  });
});
```

Run: `./node_modules/.bin/vitest run tests/media/cleanup-route.test.ts`

Expected: FAIL until the route calls the Worker and finalize/release helpers.

- [ ] **Step 5: Update the cleanup route**

In `app/api/internal/media/cleanup/route.ts`, import the new helpers:

```ts
import {
  claimExpiredMediaForDeletion,
  completeMediaAssetDeletions,
  releaseMediaAssetDeletionClaims,
} from "@/lib/media/cleanup";
```

Add this `GET` handler for Vercel Cron:

```ts
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return apiError("Unauthorized.", 401, "unauthorized");
  }

  return runMediaCleanup();
}
```

Keep `POST` for internal/manual calls with `MEDIA_WORKER_SHARED_SECRET`, but replace its successful branch with:

```ts
  return runMediaCleanup();
```

Add the shared cleanup helper below the route handlers:

```ts
async function runMediaCleanup() {
  try {
    const env = getMediaEnv();
    const candidates = await claimExpiredMediaForDeletion();
    const assetIds = candidates.map((asset) => asset.id);
    const keys = candidates.map((asset) => asset.storage_key);

    if (keys.length > 0) {
      const deleteResponse = await fetch(`${env.baseUrl}/internal/delete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-woven-media-worker-secret": env.workerSharedSecret,
        },
        body: JSON.stringify({ keys }),
      });

      if (!deleteResponse.ok) {
        await releaseMediaAssetDeletionClaims(assetIds);
        return apiError("Unable to delete media objects.", 500, "media_cleanup_failed");
      }
    }

    await completeMediaAssetDeletions(assetIds);

    return Response.json(
      { deleted_count: assetIds.length, object_delete_count: keys.length },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to clean up media assets", error);
    return apiError("Unable to clean up media assets.", 500, "media_cleanup_failed");
  }
}
```

- [ ] **Step 6: Add the daily Vercel Cron config**

Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/internal/media/cleanup",
      "schedule": "0 8 * * *"
    }
  ]
}
```

The schedule is daily at 08:00 UTC. It is intentionally daily because 30-day output retention does not need tighter cleanup.

Append to `.env.example` if Task 2 did not already do so:

```dotenv
CRON_SECRET=
```

- [ ] **Step 7: Run cleanup tests**

Run:

```bash
./node_modules/.bin/vitest run tests/media/cleanup.test.ts tests/media/cleanup-route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add workers/media/index.ts workers/media/types.d.ts lib/media/cleanup.ts app/api/internal/media/cleanup/route.ts tests/media/cleanup.test.ts tests/media/cleanup-route.test.ts supabase/migrations/20260702160000_media_job_readiness_deadlines_cleanup.sql vercel.json .env.example
git commit -m "fix: automate expired media object cleanup"
```

---

### Task 5: Store sanitized provider failure diagnostics

**Files:**
- Modify: `lib/media/provider.ts`
- Modify: `lib/media/worker.ts`
- Test: `tests/media/worker.test.ts`

- [ ] **Step 1: Write provider diagnostics tests**

Add to `tests/media/worker.test.ts`:

```ts
it("stores sanitized provider failure diagnostics", async () => {
  const secretMessage = "Provider failed with api_key=secret and request id req_123";
  const adapter = {
    run: vi.fn(async () => {
      const error = new Error(secretMessage);
      Object.assign(error, { requestId: "req_123", status: 429 });
      throw error;
    }),
  };

  await drainOneMediaJob({ adapters: { fal: adapter } });

  expect(admin.rpc).toHaveBeenCalledWith("release_claimed_media_job", expect.objectContaining({
    p_error: "provider_failed",
    p_metadata: expect.objectContaining({
      reason: "provider_failed",
      provider_error_name: "Error",
      provider_request_id: "req_123",
      provider_status: 429,
    }),
  }));
  expect(JSON.stringify(admin.rpc.mock.calls)).not.toContain("api_key=secret");
});
```

Run: `./node_modules/.bin/vitest run tests/media/worker.test.ts`

Expected: FAIL because adapter exceptions currently return only `provider_failed`.

- [ ] **Step 2: Allow provider failure metadata in the provider type**

In `lib/media/provider.ts`, add this union member to `ProviderRunResult`:

```ts
  | {
      status: "provider_failed";
      metadata?: Record<string, unknown>;
    }
```

- [ ] **Step 3: Add sanitization and metadata propagation**

In `lib/media/worker.ts`, change provider failure handling:

```ts
  if (result.status === "provider_failed") {
    const status = await releaseJob(admin, job, "provider_failed", safeMetadata(result.metadata));
    return { claimed: true, jobId: job.id, status };
  }
```

Change `releaseJob` signature:

```ts
async function releaseJob(
  admin: SupabaseAdminClient,
  job: { id: string; claimToken: string | null },
  reason:
    | "media_input_unavailable"
    | "media_output_materialization_failed"
    | "model_not_enabled"
    | "provider_failed"
    | "provider_not_configured",
  metadata: Record<string, unknown> = {},
) {
```

Add these keys to `SAFE_PROVIDER_METADATA_KEYS` so the sanitized diagnostics survive the existing metadata filter:

```ts
  "provider_error_message",
  "provider_error_name",
  "provider_status",
```

Change RPC metadata:

```ts
    p_metadata: { reason, ...metadata },
```

In `runProviderAdapter`, return sanitized provider failure metadata:

```ts
    return {
      status: "provider_failed" as const,
      metadata: providerFailureMetadata(error),
    };
```

Add helpers:

```ts
function providerFailureMetadata(error: unknown): Record<string, unknown> {
  const record = isRecord(error) ? error : {};
  const metadata: Record<string, unknown> = {};
  const name = error instanceof Error ? error.name : stringValue(record.name);
  const message = error instanceof Error ? error.message : stringValue(record.message);

  if (name) metadata.provider_error_name = name;
  if (message && !SECRET_METADATA_VALUE.test(message)) {
    metadata.provider_error_message = truncate(message, 500);
  }

  const requestId = stringValue(record.requestId) ?? stringValue(record.request_id);
  const status = typeof record.status === "number" ? record.status : undefined;
  if (requestId) metadata.provider_request_id = requestId;
  if (status) metadata.provider_status = status;

  return metadata;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
```

- [ ] **Step 4: Run diagnostics tests**

Run: `./node_modules/.bin/vitest run tests/media/worker.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/media/provider.ts lib/media/worker.ts tests/media/worker.test.ts
git commit -m "fix: store media provider failure diagnostics"
```

---

### Task 6: Add job deadlines and lease heartbeats

**Files:**
- Modify: `lib/media/env.ts`
- Modify: `lib/media/jobs.ts`
- Modify: `lib/media/worker.ts`
- Test: `tests/media/env.test.ts`
- Test: `tests/media/jobs.test.ts`
- Test: `tests/media/worker.test.ts`

- [ ] **Step 1: Write worker deadline test**

In `tests/media/jobs.test.ts`, update the successful insert assertion to include a one-hour default deadline:

```ts
vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));

expect(admin.inserts[0]).toMatchObject({
  expires_at: "2026-07-02T13:00:00.000Z",
});
```

In `tests/media/worker.test.ts`, add a claimed job fixture whose `expires_at` is in the past and assert no adapter call:

```ts
it("releases expired media jobs before calling the provider", async () => {
  const adapter = { run: vi.fn() };
  claimJobs([
    mediaJobRow({
      expires_at: "2026-07-02T11:59:00.000Z",
      claim_token: "11111111-1111-4111-8111-111111111111",
    }),
  ]);
  vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));

  await drainOneMediaJob({ adapters: { fal: adapter } });

  expect(adapter.run).not.toHaveBeenCalled();
  expect(admin.rpc).toHaveBeenCalledWith("release_claimed_media_job", expect.objectContaining({
    p_error: "media_job_timed_out",
  }));
});
```

Run: `./node_modules/.bin/vitest run tests/media/worker.test.ts`

Expected: FAIL because job creation does not write `expires_at` and the worker ignores it.

- [ ] **Step 2: Write job deadlines and include `expires_at` in claimed job normalization**

In `lib/media/jobs.ts`, import `getMediaEnv` if it is not already imported:

```ts
import { getMediaEnv } from "@/lib/media/env";
```

In the initial `generation_jobs` insert payload, add:

```ts
      expires_at: new Date(Date.now() + getMediaEnv().jobTimeoutSeconds * 1000).toISOString(),
```

In `lib/media/worker.ts`, add to `ClaimedMediaJobRow`:

```ts
  expires_at?: unknown;
```

Add to `normalizeClaimedJob` return:

```ts
    expiresAt: stringValue(job.expires_at),
```

Before model lookup in `drainOneMediaJob`, add:

```ts
  if (isExpiredJob(job.expiresAt)) {
    const status = await releaseJob(admin, job, "media_job_timed_out");
    return { claimed: true, jobId: job.id, status };
  }
```

Extend the `releaseJob` reason union with `"media_job_timed_out"`.

Add helper:

```ts
function isExpiredJob(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}
```

- [ ] **Step 3: Write heartbeat test**

Add to `tests/media/worker.test.ts`:

```ts
import type { ProviderRunResult } from "@/lib/media/provider";

it("extends the claim lease while a provider call is in flight", async () => {
  vi.useFakeTimers();
  const adapterPromise = new Promise<ProviderRunResult>((resolve) => {
    setTimeout(() => resolve({
      status: "succeeded",
      rawCostUsd: 0.01,
      outputs: [{ type: "json", contentType: "application/json", data: new TextEncoder().encode("{}") }],
    }), 130_000);
  });
  const adapter = { run: vi.fn(() => adapterPromise) };

  const drain = drainOneMediaJob({ adapters: { fal: adapter } });
  await vi.advanceTimersByTimeAsync(121_000);
  await vi.advanceTimersByTimeAsync(10_000);
  await drain;

  expect(admin.rpc).toHaveBeenCalledWith("extend_claimed_media_job_lease", expect.objectContaining({
    p_lease_seconds: 300,
  }));
  vi.useRealTimers();
});
```

Run: `./node_modules/.bin/vitest run tests/media/worker.test.ts`

Expected: FAIL because no heartbeat RPC is called.

- [ ] **Step 4: Add heartbeat wrapper**

In `lib/media/worker.ts`, change:

```ts
  const result = await runProviderAdapter({
```

to:

```ts
  const result = await withLeaseHeartbeat(admin, job, () => runProviderAdapter({
```

and close the call with:

```ts
  }));
```

Add:

```ts
async function withLeaseHeartbeat<T>(
  admin: SupabaseAdminClient,
  job: { id: string; claimToken: string | null },
  action: () => Promise<T>,
): Promise<T> {
  if (!job.claimToken) return action();

  const interval = setInterval(() => {
    void admin.rpc("extend_claimed_media_job_lease", {
      p_job_id: job.id,
      p_claim_token: job.claimToken,
      p_lease_seconds: 300,
    }).then(({ error }) => {
      if (error && !isStaleClaimError(error)) {
        console.error("Failed to extend media job lease", error);
      }
    });
  }, 120_000);

  try {
    return await action();
  } finally {
    clearInterval(interval);
  }
}
```

- [ ] **Step 5: Run deadline and heartbeat tests**

Run:

```bash
./node_modules/.bin/vitest run tests/media/env.test.ts tests/media/jobs.test.ts tests/media/worker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/media/env.ts lib/media/jobs.ts lib/media/worker.ts tests/media/env.test.ts tests/media/jobs.test.ts tests/media/worker.test.ts supabase/migrations/20260702160000_media_job_readiness_deadlines_cleanup.sql
git commit -m "fix: add media job deadline and lease heartbeat"
```

---

### Task 7: Add opt-in real Supabase RPC tests

**Files:**
- Create: `tests/media/db-rpcs.integration.test.ts`
- Modify: `package.json`
- Modify: `docs/media-worker-deploy.md`

- [ ] **Step 1: Create the integration test scaffold**

Create `tests/media/db-rpcs.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const runDbTests = process.env.RUN_SUPABASE_DB_TESTS === "1";
const describeDb = runDbTests ? describe : describe.skip;

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

describeDb("media SQL RPC integration", () => {
  it("does not claim creating or unreserved queued jobs", async () => {
    const { userId, accountId } = await createUserAndAccount();
    await insertMediaJob({ userId, accountId, status: "creating", reserved: 0 });
    await insertMediaJob({ userId, accountId, status: "queued", reserved: 0 });

    const { data, error } = await admin.rpc("claim_media_jobs", {
      p_limit: 10,
      p_lease_seconds: 300,
    });

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("claims a reserved queued job only once under concurrent claims", async () => {
    const { userId, accountId } = await createUserAndAccount();
    const jobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });

    const [first, second] = await Promise.all([
      admin.rpc("claim_media_jobs", { p_limit: 1, p_lease_seconds: 300 }),
      admin.rpc("claim_media_jobs", { p_limit: 1, p_lease_seconds: 300 }),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const claimedIds = [...(first.data ?? []), ...(second.data ?? [])].map((job) => job.id);
    expect(claimedIds).toEqual([jobId]);
  });

  it("rejects settlement with a stale claim token", async () => {
    const { userId, accountId } = await createUserAndAccount();
    const jobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });
    const { data: claimed } = await admin.rpc("claim_media_jobs", { p_limit: 1, p_lease_seconds: 300 });
    const staleToken = randomUUID();

    const { error } = await admin.rpc("release_claimed_media_job", {
      p_job_id: jobId,
      p_claim_token: staleToken,
      p_status: "failed",
      p_error: "provider_failed",
      p_metadata: { reason: "provider_failed" },
    });

    expect(claimed?.[0]?.id).toBe(jobId);
    expect(error?.message).toBe("media_job_stale_claim");
  });

  it("cancels only queued jobs owned by the user", async () => {
    const { userId, accountId } = await createUserAndAccount();
    const jobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });

    const { data, error } = await admin.rpc("cancel_queued_media_job", {
      p_user_id: userId,
      p_job_id: jobId,
    });

    expect(error).toBeNull();
    expect(data.status).toBe("cancelled");
  });
});

async function createUserAndAccount() {
  const email = `media-${randomUUID()}@example.test`;
  const { data: userResult, error: userError } = await admin.auth.admin.createUser({
    email,
    password: `A1-${randomUUID()}`,
    email_confirm: true,
  });
  if (userError) throw userError;
  const userId = userResult.user.id;

  const { data: account, error: accountError } = await admin
    .from("billing_accounts")
    .insert({ user_id: userId, currency: "usd" })
    .select("id")
    .single();
  if (accountError) throw accountError;

  return { userId, accountId: account.id as string };
}

async function insertMediaJob({
  userId,
  accountId,
  status,
  reserved,
}: {
  userId: string;
  accountId: string;
  status: string;
  reserved: number;
}) {
  const { data, error } = await admin
    .from("generation_jobs")
    .insert({
      user_id: userId,
      account_id: accountId,
      type: "media_job",
      provider: "fal",
      model: "fal-ai/frontier-video",
      status,
      estimated_cost_usd_micros: 100000,
      reserved_amount_usd_micros: reserved,
      input: {
        media_model_id: "frontier-video",
        parameters: { prompt: "test" },
        input_asset_ids: [],
      },
      progress: {},
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}
```

- [ ] **Step 2: Confirm package script exists**

If Task 2 did not already add it, add this to `package.json`:

```json
"test:media-db": "RUN_SUPABASE_DB_TESTS=1 vitest run tests/media/db-rpcs.integration.test.ts"
```

- [ ] **Step 3: Document the integration test command**

In `docs/media-worker-deploy.md`, add:

````md
## Local SQL RPC Tests

Run these before shipping schema changes:

```bash
supabase start
supabase db reset
RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key> npm run test:media-db
```
````

- [ ] **Step 4: Run the skipped integration test in normal mode**

Run: `./node_modules/.bin/vitest run tests/media/db-rpcs.integration.test.ts`

Expected: PASS with the suite skipped because `RUN_SUPABASE_DB_TESTS` is not set.

- [ ] **Step 5: Run the local DB test if Supabase is already running**

Run only if `supabase start` and `supabase db reset` are acceptable in the current environment:

```bash
RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key> ./node_modules/.bin/vitest run tests/media/db-rpcs.integration.test.ts
```

Expected: PASS. If local Supabase is unavailable, leave a note in the final verification section.

- [ ] **Step 6: Commit**

```bash
git add tests/media/db-rpcs.integration.test.ts package.json docs/media-worker-deploy.md
git commit -m "test: add media rpc integration coverage"
```

---

### Task 8: Final verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-02-media-important-fixes.md`

- [ ] **Step 1: Run focused media tests**

Run:

```bash
./node_modules/.bin/vitest run tests/media
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint
```

Expected: PASS. If eslint still reports the two pre-existing warnings from the critical-fix run, record them as pre-existing warnings rather than new failures.

- [ ] **Step 3: Check git diff**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors; branch is ahead by the new task commits.

- [ ] **Step 4: Update this plan's checklist**

Mark each completed checkbox in `docs/superpowers/plans/2026-07-02-media-important-fixes.md`.

- [ ] **Step 5: Commit checklist update**

```bash
git add docs/superpowers/plans/2026-07-02-media-important-fixes.md
git commit -m "docs: mark media important fixes complete"
```

---

## Self-Review Notes

- Critical #1 and #2 are not reimplemented here; they are status-checked and referenced because the existing critical-fixes plan already shipped them.
- Important #3 is covered by Task 1.
- Important #4 is covered by Task 2.
- Important #5 is covered by Task 3.
- Important #6 is covered by Task 4.
- Important #7 is covered by Task 5.
- Important #8 is covered by Task 6.
- Important #9 is covered by Task 7.
- The plan does not hard-code a Fal JWKS URL because the current docs digest confirms the JWKS verification mechanism but does not pin a stable URL. `FAL_WEBHOOK_JWKS_URL` is required for production verification.
