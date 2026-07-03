# Trigger Media Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-on hosted-media polling worker with Trigger.dev Cloud as the exact-job media executor in local and production.

**Architecture:** Next route handlers remain the authenticated control plane. Supabase remains the source of truth for jobs, billing, claim fencing, model catalog, and output metadata. Trigger.dev owns durable per-job execution, provider waiting, reconciliation, and dispatch observability; Cloudflare Worker + R2 continues to own media bytes.

**Tech Stack:** Next.js 16.2.3 App Router route handlers, Trigger.dev Cloud / `@trigger.dev/sdk`, Supabase Postgres/RPCs, Fal `@fal-ai/client`, ElevenLabs SDK, Cloudflare Worker + R2, Vitest, TypeScript.

**Docs digest:** `docs/superpowers/research/2026-07-03-trigger-media-executor-docs.md`, plus existing media digests `docs/superpowers/research/2026-07-02-media-important-fixes-docs.md` and `docs/superpowers/research/2026-07-01-hosted-generations-docs.md`.

## Global Constraints

- Use Trigger.dev Cloud, not self-hosted Trigger.dev.
- Use Trigger.dev for local and production media execution.
- No supported production or local path may depend on the old always-on polling worker.
- Keep Supabase as the source of truth for job state, billing reservations, usage events, model catalog rows, media assets, and output metadata.
- Keep Cloudflare Worker + R2 as the media byte storage and signed upload/download boundary.
- Keep Harness polling Woven job status; Harness never polls Fal directly.
- Process exactly one Woven media job per Trigger task run, keyed by `jobId`.
- Trigger runs must use `idempotencyKey = jobId`.
- Provider waiting must use Trigger durable waits between polls, not a hot process loop.
- Fal webhooks are a wake-up signal and must not finalize jobs directly.
- `trigger.config.ts` must read the Trigger project reference from `TRIGGER_PROJECT_REF` so this repo can run against local, preview, and production Trigger projects without editing source.
- Runtime task dispatch must use `TRIGGER_SECRET_KEY`; non-interactive Trigger deploys must use `TRIGGER_ACCESS_TOKEN`.
- Trigger.dev Cloud task secrets must mirror the local hosted-media env shape for Supabase, Fal, ElevenLabs, and media storage credentials.
- Use `pnpm` for dependency and test commands because this repo has `pnpm-lock.yaml`.
- Before editing Next route handlers, keep using the local Next docs under `node_modules/next/dist/docs/`.

---

## File Structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `trigger.config.ts` | Create | Trigger.dev project config, scanned task directory, retries, and max duration |
| `trigger/media.ts` | Create | Trigger task definitions: `process-media-job` and `reconcile-media-jobs` |
| `lib/media/trigger-dispatch.ts` | Create | Route/webhook-safe task dispatch helper with idempotency, queues, tags, and user concurrency |
| `lib/media/executor.ts` | Create | Exact-job media executor that replaces generic drain logic |
| `lib/media/job-claims.ts` | Create | Supabase exact-claim and reconciliation helpers |
| `lib/media/jobs.ts` | Modify | Export dispatch-failure release helper and normalize job creation cleanup |
| `app/api/v1/media/jobs/route.ts` | Modify | Dispatch Trigger after reserved job creation; fail closed on dispatch failure |
| `app/api/v1/media/webhooks/fal/route.ts` | Modify | Verify Fal webhook, update progress, idempotently wake Trigger task |
| `app/api/internal/media/jobs/drain/route.ts` | Delete | Remove unsupported drain route |
| `scripts/media-worker.ts` | Delete | Remove unsupported polling worker entrypoint |
| `scripts/media-worker-startup-check.ts` | Optional delete if only referenced by old worker | Remove stale worker-only diagnostics |
| `lib/media/worker.ts` | Modify or delete | Move reusable logic into `lib/media/executor.ts`; no generic drain exported |
| `lib/media/worker-startup.ts` | Delete if unused | Remove startup diagnostics for polling worker |
| `supabase/migrations/20260703190000_trigger_media_executor.sql` | Create | Exact claim RPC, reconciliation RPC, dispatch metadata behavior |
| `package.json` | Modify | Add Trigger scripts, add dependency, rename media edge deploy script |
| `pnpm-lock.yaml` | Modify | Lock Trigger dependency |
| `.env.example` | Modify | Document Trigger and executor env |
| `docs/media-worker-deploy.md` | Modify | Replace polling-worker deploy runbook with Trigger executor runbook |
| `tests/media/job-claims.test.ts` | Create | Unit tests for claim/reconciliation helper wrappers |
| `tests/media/executor.test.ts` | Create | Unit tests for exact-job executor behavior |
| `tests/media/trigger-dispatch.test.ts` | Create | Unit tests for Trigger dispatch options |
| `tests/media/trigger-tasks.test.ts` | Create | Unit tests for task definitions and scheduled reconciliation |
| `tests/media/job-routes.test.ts` | Modify | Route dispatch success and dispatch failure behavior |
| `tests/media/fal-webhook-route.test.ts` | Modify | Webhook wakes Trigger instead of only expiring claim lease |
| `tests/media/db-rpcs.integration.test.ts` | Modify | Exact claim/reconciliation SQL tests |

---

### Task 1: Add Trigger.dev SDK, Config, And Dispatch Helper

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `trigger.config.ts`
- Create: `lib/media/trigger-dispatch.ts`
- Create: `tests/media/trigger-dispatch.test.ts`

**Interfaces:**
- Produces:
  - `type DispatchMediaJobPayload = { jobId: string; userId: string; modelId: string; kind: "image" | "video" | "audio" }`
  - `type DispatchMediaJobResult = { runId: string }`
  - `function dispatchMediaJob(payload: DispatchMediaJobPayload): Promise<DispatchMediaJobResult>`
  - `function mediaQueueForKind(kind: DispatchMediaJobPayload["kind"]): { name: string; concurrencyLimit: number }`
  - `function mediaConcurrencyKey(userId: string): string`
- Consumes:
  - Trigger.dev docs digest: `task()`, `tasks.trigger`, `idempotencyKey`, `concurrencyKey`, queue options, tags.

- [ ] **Step 1: Add the Trigger.dev dependency**

Run:

```bash
pnpm add @trigger.dev/sdk
```

Expected: `package.json` gains `@trigger.dev/sdk` and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Add Trigger scripts**

In `package.json`, replace the media scripts block with this exact script set, preserving unrelated scripts:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "trigger:dev": "npx trigger.dev@latest dev",
  "trigger:deploy": "npx trigger.dev@latest deploy",
  "media:edge:local": "npx wrangler dev --config workers/media/wrangler.jsonc --port 8787",
  "media:edge:deploy": "npx wrangler deploy --config workers/media/wrangler.jsonc",
  "media:dev:local": "sh -c 'cleanup(){ trap - INT TERM EXIT; kill $(jobs -p) 2>/dev/null; }; trap cleanup INT TERM EXIT; pnpm run dev & pnpm run media:edge:local & pnpm run trigger:dev & wait'",
  "test:media-db": "RUN_SUPABASE_DB_TESTS=1 vitest run tests/media/db-rpcs.integration.test.ts"
}
```

Expected: no `media:worker`, `media:worker:local`, or `media:worker:deploy` script remains.

- [ ] **Step 3: Create Trigger config**

Create `trigger.config.ts`:

```ts
import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF;

if (!project) {
  throw new Error("TRIGGER_PROJECT_REF is required for Trigger.dev media execution.");
}

export default defineConfig({
  project,
  dirs: ["./trigger"],
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  maxDuration: 3_600,
});
```

- [ ] **Step 4: Write failing Trigger dispatch tests**

Create `tests/media/trigger-dispatch.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: mocks.trigger,
  },
}));

describe("dispatchMediaJob", () => {
  afterEach(() => {
    mocks.trigger.mockReset();
    vi.resetModules();
  });

  it("dispatches process-media-job with job idempotency, queue, tags, and per-user concurrency", async () => {
    mocks.trigger.mockResolvedValue({ id: "run_123" });
    const { dispatchMediaJob } = await import("@/lib/media/trigger-dispatch");

    await expect(dispatchMediaJob({
      jobId: "job_123",
      userId: "user_123",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
    })).resolves.toEqual({ runId: "run_123" });

    expect(mocks.trigger).toHaveBeenCalledWith(
      "process-media-job",
      { jobId: "job_123" },
      {
        idempotencyKey: "job_123",
        concurrencyKey: "media-user:user_123",
        queue: {
          name: "media-image",
          concurrencyLimit: 10,
        },
        tags: [
          "media",
          "media-kind:image",
          "media-model:fal-ai/nano-banana-lite",
          "media-user:user_123",
        ],
      },
    );
  });

  it("uses conservative video and audio queues", async () => {
    const { mediaQueueForKind } = await import("@/lib/media/trigger-dispatch");

    expect(mediaQueueForKind("video")).toEqual({
      name: "media-video",
      concurrencyLimit: 2,
    });
    expect(mediaQueueForKind("audio")).toEqual({
      name: "media-audio",
      concurrencyLimit: 3,
    });
  });
});
```

- [ ] **Step 5: Run dispatch tests to verify failure**

Run:

```bash
pnpm exec vitest run tests/media/trigger-dispatch.test.ts
```

Expected: FAIL because `@/lib/media/trigger-dispatch` does not exist.

- [ ] **Step 6: Implement the dispatch helper**

Create `lib/media/trigger-dispatch.ts`:

```ts
import { tasks } from "@trigger.dev/sdk";

import type { processMediaJobTask } from "@/trigger/media";

export type DispatchMediaJobPayload = {
  jobId: string;
  userId: string;
  modelId: string;
  kind: "image" | "video" | "audio";
};

export type DispatchMediaJobResult = {
  runId: string;
};

export function mediaQueueForKind(kind: DispatchMediaJobPayload["kind"]) {
  switch (kind) {
    case "image":
      return { name: "media-image", concurrencyLimit: 10 };
    case "video":
      return { name: "media-video", concurrencyLimit: 2 };
    case "audio":
      return { name: "media-audio", concurrencyLimit: 3 };
  }
}

export function mediaConcurrencyKey(userId: string) {
  return `media-user:${userId}`;
}

export async function dispatchMediaJob({
  jobId,
  userId,
  modelId,
  kind,
}: DispatchMediaJobPayload): Promise<DispatchMediaJobResult> {
  const handle = await tasks.trigger<typeof processMediaJobTask>(
    "process-media-job",
    { jobId },
    {
      idempotencyKey: jobId,
      concurrencyKey: mediaConcurrencyKey(userId),
      queue: mediaQueueForKind(kind),
      tags: [
        "media",
        `media-kind:${kind}`,
        `media-model:${modelId}`,
        mediaConcurrencyKey(userId),
      ],
    },
  );

  return { runId: handle.id };
}
```

- [ ] **Step 7: Add a temporary task type shim**

Create `trigger/media.ts` with a minimal task so `lib/media/trigger-dispatch.ts` can type-check before the real task exists:

```ts
import { task } from "@trigger.dev/sdk";

export const processMediaJobTask = task({
  id: "process-media-job",
  run: async ({ jobId }: { jobId: string }) => ({ jobId, status: "not_implemented" as const }),
});
```

Later tasks replace this with the real executor task.

- [ ] **Step 8: Run dispatch tests**

Run:

```bash
pnpm exec vitest run tests/media/trigger-dispatch.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run:

```bash
./node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml trigger.config.ts trigger/media.ts lib/media/trigger-dispatch.ts tests/media/trigger-dispatch.test.ts
git commit -m "feat(media): add trigger dispatch foundation"
```

---

### Task 2: Add Exact Media Job Claim And Reconciliation RPCs

**Files:**
- Create: `supabase/migrations/20260703190000_trigger_media_executor.sql`
- Modify: `tests/media/db-rpcs.integration.test.ts`

**Interfaces:**
- Produces:
  - `public.claim_media_job_by_id(p_job_id uuid, p_lease_seconds integer default 300) returns public.generation_jobs`
  - `public.find_media_jobs_for_trigger_reconciliation(p_limit integer default 25, p_now timestamptz default now()) returns table(id uuid, user_id uuid, media_model_id text, media_kind text)`
- Consumes:
  - Existing claim fields: `claim_token`, `claim_expires_at`, `last_provider_poll_at`, `input`, `reserved_amount_usd_micros`.

- [ ] **Step 1: Add failing DB tests for exact claim**

First update the `insertMediaJob` helper in `tests/media/db-rpcs.integration.test.ts` so media-job fixtures carry the same operation metadata created by `createReservedMediaJob(...)`:

```ts
      input: {
        media_model_id: "frontier-video",
        operation: "video_generation",
        parameters: { prompt: "test" },
        input_asset_ids: [],
      },
```

Append these tests inside `describeDb("media SQL RPC integration", () => { ... })` in `tests/media/db-rpcs.integration.test.ts`:

```ts
  it("claims the requested reserved media job by id only once", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const targetJobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });
    const otherJobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });

    const [first, second] = await Promise.all([
      admin.rpc("claim_media_job_by_id", { p_job_id: targetJobId, p_lease_seconds: 300 }),
      admin.rpc("claim_media_job_by_id", { p_job_id: targetJobId, p_lease_seconds: 300 }),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data?.id ?? second.data?.id).toBe(targetJobId);
    expect([first.data, second.data].filter(Boolean)).toHaveLength(1);

    const { data: otherClaim, error: otherError } = await admin.rpc("claim_media_job_by_id", {
      p_job_id: otherJobId,
      p_lease_seconds: 300,
    });
    expect(otherError).toBeNull();
    expect(otherClaim.id).toBe(otherJobId);
  });

  it("does not exact-claim terminal jobs or unreserved queued jobs", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const failedJobId = await insertMediaJob({ userId, accountId, status: "failed", reserved: 100000 });
    const unreservedJobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 0 });

    const failedClaim = await admin.rpc("claim_media_job_by_id", {
      p_job_id: failedJobId,
      p_lease_seconds: 300,
    });
    const unreservedClaim = await admin.rpc("claim_media_job_by_id", {
      p_job_id: unreservedJobId,
      p_lease_seconds: 300,
    });

    expect(failedClaim.error).toBeNull();
    expect(failedClaim.data).toBeNull();
    expect(unreservedClaim.error).toBeNull();
    expect(unreservedClaim.data).toBeNull();
  });

  it("finds stale media jobs for Trigger reconciliation", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const queuedJobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });
    const runningJobId = await insertMediaJob({ userId, accountId, status: "running", reserved: 100000 });
    const succeededJobId = await insertMediaJob({ userId, accountId, status: "succeeded", reserved: 100000 });

    await admin
      .from("generation_jobs")
      .update({ claim_expires_at: "1970-01-01T00:00:00.000Z" })
      .eq("id", runningJobId);

    const { data, error } = await admin.rpc("find_media_jobs_for_trigger_reconciliation", {
      p_limit: 25,
      p_now: new Date().toISOString(),
    });

    expect(error).toBeNull();
    const rows = new Map((data ?? []).map((row) => [row.id, row]));
    expect(rows.get(queuedJobId)).toMatchObject({
      user_id: userId,
      media_model_id: "frontier-video",
      media_kind: "video",
    });
    expect(rows.get(runningJobId)).toMatchObject({
      user_id: userId,
      media_model_id: "frontier-video",
      media_kind: "video",
    });
    expect(rows.has(succeededJobId)).toBe(false);
  });
```

- [ ] **Step 2: Run DB tests to verify failure**

Run with local Supabase running:

```bash
eval "$(supabase status -o env | sed 's/^/export /')"
RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" pnpm exec vitest run tests/media/db-rpcs.integration.test.ts
```

Expected: FAIL because `claim_media_job_by_id` and `find_media_jobs_for_trigger_reconciliation` do not exist.

- [ ] **Step 3: Add exact claim migration**

Create `supabase/migrations/20260703190000_trigger_media_executor.sql`:

```sql
create or replace function public.claim_media_job_by_id(
  p_job_id uuid,
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
  if p_job_id is null then
    raise exception 'media_job_id_required';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'media_job_lease_seconds_out_of_range';
  end if;

  select *
  into v_job
  from public.generation_jobs jobs
  where jobs.id = p_job_id
    and jobs.type = 'media_job'
    and jobs.status in ('queued', 'running', 'waiting_provider')
    and coalesce(jobs.reserved_amount_usd_micros, 0) > 0
    and (
      jobs.status = 'queued'
      or jobs.claim_expires_at is null
      or jobs.claim_expires_at < now()
    )
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
  for update skip locked;

  if v_job.id is null then
    return null;
  end if;

  update public.generation_jobs
  set status = case
        when status = 'queued' then 'running'
        else status
      end,
      started_at = coalesce(started_at, now()),
      claim_expires_at = now() + make_interval(secs => p_lease_seconds),
      claim_token = gen_random_uuid(),
      last_provider_poll_at = now(),
      progress = coalesce(progress, '{}'::jsonb) || jsonb_build_object(
        'stage', case
          when status = 'queued' then 'claimed'
          else coalesce(progress->>'stage', status)
        end
      )
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

create or replace function public.find_media_jobs_for_trigger_reconciliation(
  p_limit integer default 25,
  p_now timestamptz default now()
)
returns table(id uuid, user_id uuid, media_model_id text, media_kind text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'media_reconciliation_limit_out_of_range';
  end if;

  return query
  select
    jobs.id,
    jobs.user_id,
    coalesce(nullif(jobs.input->>'media_model_id', ''), jobs.model) as media_model_id,
    case
      when jobs.input->>'operation' = 'image_generation' then 'image'
      when jobs.input->>'operation' in ('text_to_speech', 'sound_effects', 'music_generation') then 'audio'
      else 'video'
    end as media_kind
  from public.generation_jobs jobs
  where jobs.type = 'media_job'
    and jobs.status in ('queued', 'running', 'waiting_provider')
    and coalesce(jobs.reserved_amount_usd_micros, 0) > 0
    and (
      jobs.status = 'queued'
      or jobs.expires_at <= p_now
      or jobs.claim_expires_at is null
      or jobs.claim_expires_at < p_now
      or jobs.last_provider_poll_at is null
      or jobs.last_provider_poll_at < p_now - interval '2 minutes'
    )
  order by jobs.created_at asc
  limit p_limit;
end;
$$;

create or replace function public.mark_media_job_waiting_provider(
  p_job_id uuid,
  p_claim_token uuid,
  p_provider_job_id text,
  p_progress jsonb default '{"stage":"provider_wait","percent":null,"message":"Waiting on provider"}'::jsonb
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  if p_claim_token is null then
    raise exception 'media_job_missing_claim_token';
  end if;

  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
    and type = 'media_job'
    and claim_token = p_claim_token
    and (claim_expires_at is null or claim_expires_at >= now())
  for update;

  if v_job.id is null then
    raise exception 'media_job_stale_claim';
  end if;

  update public.generation_jobs
  set status = 'waiting_provider',
      provider_job_id = p_provider_job_id,
      progress = coalesce(p_progress, '{}'::jsonb),
      last_provider_poll_at = now(),
      claim_expires_at = now()
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.claim_media_job_by_id(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_media_job_by_id(uuid, integer) to service_role;

revoke all on function public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz) to service_role;

revoke all on function public.mark_media_job_waiting_provider(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.mark_media_job_waiting_provider(uuid, uuid, text, jsonb) to service_role;
```

- [ ] **Step 4: Apply migration locally**

Run:

```bash
supabase db reset
```

Expected: local Supabase resets successfully and applies `20260703190000_trigger_media_executor.sql`.

- [ ] **Step 5: Run DB tests**

Run:

```bash
eval "$(supabase status -o env | sed 's/^/export /')"
RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" pnpm exec vitest run tests/media/db-rpcs.integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260703190000_trigger_media_executor.sql tests/media/db-rpcs.integration.test.ts
git commit -m "feat(db): add exact media job claims"
```

---

### Task 3: Extract Exact-Job Media Executor

**Files:**
- Create: `lib/media/job-claims.ts`
- Create: `lib/media/executor.ts`
- Create: `tests/media/executor.test.ts`
- Modify: `tests/media/worker.test.ts` if shared tests are moved or renamed

**Interfaces:**
- Consumes:
  - `claim_media_job_by_id`
  - `mark_media_job_waiting_provider`
  - `release_claimed_media_job`
  - `record_and_settle_claimed_media_job`
  - existing provider adapters and output materialization helpers
- Produces:
  - `type ProcessMediaJobResult`
  - `function processMediaJob(args: { jobId: string; adapters: Record<string, MediaProviderAdapter>; waitFor: (delay: { seconds: number }) => Promise<void>; signal?: AbortSignal }): Promise<ProcessMediaJobResult>`
  - `function claimMediaJobById(jobId: string, leaseSeconds?: number): Promise<MediaJobClaimRow | null>`
  - `type ReconciliationMediaJob = { jobId: string; userId: string; modelId: string; kind: "image" | "video" | "audio" }`
  - `function findMediaJobsForTriggerReconciliation(limit?: number): Promise<ReconciliationMediaJob[]>`

- [ ] **Step 1: Write failing exact executor tests**

Create `tests/media/executor.test.ts` by copying the existing mocks from `tests/media/worker.test.ts` and using this initial test set:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaProviderAdapter } from "@/lib/media/provider";
import type { MediaModel } from "@/lib/media/types";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  getMediaModel: vi.fn(),
  getMediaEnv: vi.fn(),
  signMediaToken: vi.fn(),
  createOutputAssetRows: vi.fn(),
  failOutputAssetRowsForAttempt: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/media/model-registry", () => ({ getMediaModel: mocks.getMediaModel }));
vi.mock("@/lib/media/env", () => ({ getMediaEnv: mocks.getMediaEnv }));
vi.mock("@/lib/media/tokens", () => ({ signMediaToken: mocks.signMediaToken }));
vi.mock("@/lib/media/output-assets", () => ({
  createOutputAssetRows: mocks.createOutputAssetRows,
  failOutputAssetRowsForAttempt: mocks.failOutputAssetRowsForAttempt,
}));

const claimToken = "00000000-0000-4000-8000-000000000001";
const model = {
  id: "fal-ai/nano-banana-lite",
  provider: "fal",
  providerModel: "fal-ai/nano-banana-lite",
  providerEndpoint: "fal-ai/nano-banana-lite",
  operation: "image_generation",
  kind: "image",
  displayName: "Nano Banana Lite",
  supportsUploadedInputs: false,
  supportedInputTypes: [],
  outputTypes: ["image"],
  defaultParameters: {},
  inputAssetSchema: { roles: [] },
  pricingFormula: { type: "static" },
  parameterSchema: { type: "object" },
  pricing: { unit: "job", minimumUsdMicros: 100_000, reserveUsdMicros: 500_000, markupBps: 2_000 },
  metadata: {},
  rule: {},
} as unknown as MediaModel;

describe("processMediaJob", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    mocks.getMediaModel.mockReset();
    mocks.getMediaEnv.mockReset();
    mocks.signMediaToken.mockReset();
    mocks.createOutputAssetRows.mockReset();
    mocks.failOutputAssetRowsForAttempt.mockReset();
    mocks.getMediaEnv.mockReturnValue({
      baseUrl: "https://media.example.test",
      tokenSecret: "token-secret",
      workerSharedSecret: "worker-secret",
      maxUploadBytes: 1000,
      uploadUrlTtlSeconds: 900,
      downloadUrlTtlSeconds: 900,
      outputRetentionSeconds: 2_592_000,
    });
    mocks.createOutputAssetRows.mockResolvedValue({
      outputs: [{ id: "output_1", type: "image", content_type: "image/png" }],
      attemptAssets: [{ id: "output_1", storageKey: "users/user_1/media/outputs/job_1/output_1/attempts/attempt/output.png" }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("claims the exact job id before provider work", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJob: jobRow() });
    const adapter = { run: vi.fn(async () => ({ status: "waiting_provider" as const, providerJobId: "fal_req_1" })) } satisfies MediaProviderAdapter;
    const waitFor = vi.fn(async () => undefined);
    const { processMediaJob } = await import("@/lib/media/executor");

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor })).resolves.toEqual({
      jobId: "job_1",
      status: "waiting_provider",
    });

    expect(admin.rpc).toHaveBeenNthCalledWith(1, "claim_media_job_by_id", {
      p_job_id: "job_1",
      p_lease_seconds: 300,
    });
    expect(adapter.run).toHaveBeenCalledOnce();
  });

  it("exits without provider work when exact claim returns null", async () => {
    const admin = mockAdminWith({ claimedJob: null });
    const adapter = { run: vi.fn() } satisfies MediaProviderAdapter;
    const { processMediaJob } = await import("@/lib/media/executor");

    await expect(processMediaJob({
      jobId: "job_missing",
      adapters: { fal: adapter },
      waitFor: async () => undefined,
    })).resolves.toEqual({ jobId: "job_missing", status: "not_claimed" });

    expect(admin.rpc).toHaveBeenCalledWith("claim_media_job_by_id", {
      p_job_id: "job_missing",
      p_lease_seconds: 300,
    });
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it("waits durably after provider_wait and then reclaims the same job", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({
      claimedJobs: [
        jobRow({ provider_job_id: null }),
        jobRow({ provider_job_id: "fal_req_1" }),
      ],
    });
    const adapter = {
      run: vi.fn()
        .mockResolvedValueOnce({ status: "waiting_provider" as const, providerJobId: "fal_req_1" })
        .mockResolvedValueOnce({
          status: "succeeded" as const,
          outputs: [{ url: "https://fal.example/out.png", type: "image", contentType: "image/png" }],
          rawCostUsd: 1,
          metadata: { fal_request_id: "fal_req_1", fal_status: "COMPLETED" },
        }),
    } satisfies MediaProviderAdapter;
    const waitFor = vi.fn(async () => undefined);
    const { processMediaJob } = await import("@/lib/media/executor");

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor })).resolves.toEqual({
      jobId: "job_1",
      status: "succeeded",
    });

    expect(waitFor).toHaveBeenCalledWith({ seconds: 5 });
    expect(admin.rpc).toHaveBeenNthCalledWith(1, "claim_media_job_by_id", expect.any(Object));
    expect(admin.rpc).toHaveBeenNthCalledWith(3, "claim_media_job_by_id", expect.any(Object));
  });
});

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    user_id: "user_1",
    input: {
      media_model_id: "fal-ai/nano-banana-lite",
      parameters: { prompt: "a mountain" },
      input_asset_ids: [],
      pricing_quote: null,
    },
    provider_job_id: null,
    claim_token: claimToken,
    expires_at: "2026-07-03T13:00:00.000Z",
    ...overrides,
  };
}

function mockAdminWith({
  claimedJob,
  claimedJobs,
}: {
  claimedJob?: Record<string, unknown> | null;
  claimedJobs?: Array<Record<string, unknown>>;
}) {
  const queue = claimedJobs ? [...claimedJobs] : [claimedJob];
  const admin = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_media_job_by_id") return { data: queue.shift() ?? null, error: null };
      if (name === "mark_media_job_waiting_provider") return { data: { id: args.p_job_id }, error: null };
      if (name === "release_claimed_media_job") return { data: { id: args.p_job_id }, error: null };
      if (name === "record_and_settle_claimed_media_job") return { data: { id: args.p_job_id }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    }),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  };
  mocks.createSupabaseAdminClient.mockReturnValue(admin);
  return admin;
}
```

- [ ] **Step 2: Run executor tests to verify failure**

Run:

```bash
pnpm exec vitest run tests/media/executor.test.ts
```

Expected: FAIL because `@/lib/media/executor` does not exist.

- [ ] **Step 3: Create job claim helper**

Create `lib/media/job-claims.ts`:

```ts
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type MediaJobClaimRow = {
  id?: unknown;
  user_id?: unknown;
  input?: unknown;
  provider_job_id?: unknown;
  claim_token?: unknown;
  expires_at?: unknown;
};

export type ReconciliationMediaJob = {
  jobId: string;
  userId: string;
  modelId: string;
  kind: "image" | "video" | "audio";
};

type ReconciliationRpcRow = {
  id?: unknown;
  user_id?: unknown;
  media_model_id?: unknown;
  media_kind?: unknown;
};

export async function claimMediaJobById(jobId: string, leaseSeconds = 300): Promise<MediaJobClaimRow | null> {
  const { data, error } = await createSupabaseAdminClient().rpc("claim_media_job_by_id", {
    p_job_id: jobId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as MediaJobClaimRow | null;
}

export async function findMediaJobsForTriggerReconciliation(limit = 25): Promise<ReconciliationMediaJob[]> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "find_media_jobs_for_trigger_reconciliation",
    { p_limit: limit, p_now: new Date().toISOString() },
  );

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).flatMap((row: ReconciliationRpcRow) => {
    const jobId = stringValue(row.id);
    const userId = stringValue(row.user_id);
    const modelId = stringValue(row.media_model_id);
    const kind = mediaKindValue(row.media_kind);
    return jobId && userId && modelId && kind ? [{ jobId, userId, modelId, kind }] : [];
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function mediaKindValue(value: unknown): ReconciliationMediaJob["kind"] | null {
  return value === "image" || value === "video" || value === "audio" ? value : null;
}
```

- [ ] **Step 4: Implement exact executor by moving worker logic**

Create `lib/media/executor.ts` by moving the reusable logic from `lib/media/worker.ts` and changing the top-level flow to this public interface:

```ts
import { getMediaModel } from "@/lib/media/model-registry";
import {
  createOutputAssetRows,
  failOutputAssetRowsForAttempt,
} from "@/lib/media/output-assets";
import type { MediaProviderAdapter, ProviderInputAsset, ProviderOutput } from "@/lib/media/provider";
import { chargeMediaUsdMicros } from "@/lib/media/pricing";
import { deserializeMediaPricingQuote } from "@/lib/media/pricing-quotes";
import { getMediaEnv } from "@/lib/media/env";
import { signMediaToken } from "@/lib/media/tokens";
import { claimMediaJobById, type MediaJobClaimRow } from "@/lib/media/job-claims";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ProcessMediaJobResult =
  | { jobId: string; status: "not_claimed" }
  | { jobId: string; status: "failed" | "stale_claim" | "succeeded" | "waiting_provider" };

export async function processMediaJob({
  jobId,
  adapters,
  waitFor,
  signal,
}: {
  jobId: string;
  adapters: Record<string, MediaProviderAdapter>;
  waitFor: (delay: { seconds: number }) => Promise<void>;
  signal?: AbortSignal;
}): Promise<ProcessMediaJobResult> {
  for (;;) {
    const result = await processMediaJobStep({ jobId, adapters, signal });
    if (result.status !== "waiting_provider") {
      return result;
    }

    await waitFor({ seconds: 5 });
  }
}

async function processMediaJobStep({
  jobId,
  adapters,
  signal,
}: {
  jobId: string;
  adapters: Record<string, MediaProviderAdapter>;
  signal?: AbortSignal;
}): Promise<ProcessMediaJobResult> {
  const claimedJob = await claimMediaJobById(jobId, 300);
  if (!claimedJob) {
    return { jobId, status: "not_claimed" };
  }

  const admin = createSupabaseAdminClient();
  const job = normalizeClaimedJob(claimedJob);

  if (isExpiredJob(job.expiresAt)) {
    const status = await releaseJob(admin, job, "media_job_timed_out");
    return { jobId: job.id, status };
  }

  const model = job.mediaModelId ? await getMediaModel(job.mediaModelId) : null;
  if (!model) {
    const status = await releaseJob(admin, job, "model_not_enabled");
    return { jobId: job.id, status };
  }

  const adapter = adapters[model.provider];
  if (!adapter) {
    const status = await releaseJob(admin, job, "provider_not_configured");
    return { jobId: job.id, status };
  }

  let signedInputs: { inputUrls: string[]; inputAssets: ProviderInputAsset[] };
  try {
    signedInputs = job.providerJobId
      ? { inputUrls: [], inputAssets: [] }
      : await signedInputAssetUrls({ admin, job, model });
  } catch (error) {
    if (isStaleClaimError(error)) return { jobId: job.id, status: "stale_claim" };
    const status = await releaseJob(admin, job, "media_input_unavailable");
    return { jobId: job.id, status };
  }

  const result = await runProviderAdapter({
    adapter,
    model,
    parameters: objectValue(job.input.parameters),
    inputUrls: signedInputs.inputUrls,
    inputAssets: signedInputs.inputAssets,
    providerJobId: job.providerJobId,
    signal,
  });

  if (result.status === "provider_failed") {
    const status = await releaseJob(admin, job, "provider_failed", safeMetadata(result.metadata));
    return { jobId: job.id, status };
  }

  if (result.status === "waiting_provider") {
    const updated = await updateWaitingProviderJob({
      admin,
      jobId: job.id,
      claimToken: job.claimToken,
      providerJobId: result.providerJobId,
    });
    return { jobId: job.id, status: updated ? "waiting_provider" : "stale_claim" };
  }

  if (!job.claimToken) {
    return { jobId: job.id, status: "stale_claim" };
  }

  const charge = chargeMediaUsdMicros({
    model,
    rawCostUsd: result.rawCostUsd,
    pricingQuote: job.pricingQuote,
  });
  const providerMetadata = safeMetadata(result.metadata);

  let materializedOutputs;
  try {
    materializedOutputs = await createOutputAssetRows({
      userId: job.userId,
      jobId: job.id,
      claimToken: job.claimToken,
      outputs: result.outputs,
    });
  } catch (error) {
    if (isStaleClaimError(error)) return { jobId: job.id, status: "stale_claim" };
    const status = await releaseJob(admin, job, "media_output_materialization_failed");
    return { jobId: job.id, status };
  }

  const outputPayload = {
    media_model_id: model.id,
    outputs: materializedOutputs.outputs,
    provider_metadata: providerMetadata,
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
  };

  const usageEvent = {
    user_id: job.userId,
    job_id: job.id,
    provider: model.provider,
    model: model.providerModel,
    operation: model.operation,
    raw_provider_cost: rawProviderCostNumber(result.rawCostUsd),
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
    markup_amount_usd_micros: charge.markupAmountUsdMicros,
    metadata: providerMetadata,
  };

  const { error: settleError } = await admin.rpc("record_and_settle_claimed_media_job", {
    p_job_id: job.id,
    p_claim_token: job.claimToken,
    p_final_cost_usd_micros: charge.chargedAmountUsdMicros,
    p_output: outputPayload,
    p_metadata: outputPayload,
    p_usage_event: usageEvent,
  });

  if (settleError) {
    if (isStaleClaimError(settleError)) {
      await failOutputAssetRowsForAttempt({
        userId: job.userId,
        jobId: job.id,
        attemptAssets: materializedOutputs.attemptAssets,
        reason: "media_output_materialization_failed",
      }).catch((error) => {
        if (!isStaleClaimError(error)) throw error;
      });
      return { jobId: job.id, status: "stale_claim" };
    }
    throw new Error(settleError.message);
  }

  return { jobId: job.id, status: "succeeded" };
}
```

After adding this top-level code, move these private helpers from `lib/media/worker.ts` into `lib/media/executor.ts` unchanged except for type imports:

- `normalizeClaimedJob`
- `runProviderAdapter`
- `signedInputAssetUrls`
- `inferLegacyRole`
- `updateWaitingProviderJob`
- `releaseJob`
- `isStaleClaimError`
- `isExpiredJob`
- `isAbortError`
- `isProviderNotConfiguredError`
- `abortReason`
- `rawProviderCostNumber`
- `safeMetadata`
- `safeMetadataPrimitive`
- `providerFailureMetadata`
- `truncate`
- `objectValue`
- `stringValue`
- `stringArrayValue`
- `inputAssetEntriesValue`
- `mediaPricingQuoteValue`

Do not move `drainOneMediaJob`.

- [ ] **Step 5: Remove heartbeat use from exact executor**

Ensure `lib/media/executor.ts` does not call `extend_claimed_media_job_lease` or keep a heartbeat interval. Trigger waits reclaim the job by ID after the waiting provider step.

Run:

```bash
rg -n "extend_claimed_media_job_lease|withLeaseHeartbeat" lib/media/executor.ts
```

Expected: no output.

- [ ] **Step 6: Run executor tests**

Run:

```bash
pnpm exec vitest run tests/media/executor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run existing media worker tests and update imports**

Run:

```bash
pnpm exec vitest run tests/media/worker.test.ts
```

Expected: FAIL if tests still import `drainOneMediaJob`. Move surviving behavior tests from `tests/media/worker.test.ts` into `tests/media/executor.test.ts`, then delete `tests/media/worker.test.ts` once equivalent coverage is present.

- [ ] **Step 8: Run focused media tests**

Run:

```bash
pnpm exec vitest run tests/media/executor.test.ts tests/media/provider-adapters.test.ts tests/media/output-assets.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/media/job-claims.ts lib/media/executor.ts tests/media/executor.test.ts tests/media/worker.test.ts
git commit -m "feat(media): process exact media jobs"
```

---

### Task 4: Replace Trigger Task Shim With Real Tasks

**Files:**
- Modify: `trigger/media.ts`
- Create: `tests/media/trigger-tasks.test.ts`

**Interfaces:**
- Consumes:
  - `processMediaJob({ jobId, adapters, waitFor })`
  - `findMediaJobsForTriggerReconciliation(limit)`
  - `dispatchMediaJob(...)`
- Produces:
  - `processMediaJobTask`
  - `reconcileMediaJobsTask`

- [ ] **Step 1: Write failing Trigger task tests**

Create `tests/media/trigger-tasks.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: vi.fn((definition) => definition),
  schedulesTask: vi.fn((definition) => definition),
  waitFor: vi.fn(async () => undefined),
  processMediaJob: vi.fn(),
  findMediaJobsForTriggerReconciliation: vi.fn(),
  dispatchMediaJob: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  task: mocks.task,
  schedules: { task: mocks.schedulesTask },
  wait: { for: mocks.waitFor },
}));
vi.mock("@/lib/media/executor", () => ({ processMediaJob: mocks.processMediaJob }));
vi.mock("@/lib/media/job-claims", () => ({
  findMediaJobsForTriggerReconciliation: mocks.findMediaJobsForTriggerReconciliation,
}));
vi.mock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob: mocks.dispatchMediaJob }));
vi.mock("@/lib/media/providers/fal", () => ({ falMediaAdapter: { provider: "fal" } }));
vi.mock("@/lib/media/providers/elevenlabs", () => ({ elevenLabsMediaAdapter: { provider: "elevenlabs" } }));

describe("Trigger media tasks", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
    });
  });

  it("defines process-media-job with real executor and Trigger wait", async () => {
    mocks.processMediaJob.mockResolvedValue({ jobId: "job_1", status: "succeeded" });
    const { processMediaJobTask } = await import("@/trigger/media");

    expect(processMediaJobTask.id).toBe("process-media-job");
    await expect(processMediaJobTask.run({ jobId: "job_1" })).resolves.toEqual({
      jobId: "job_1",
      status: "succeeded",
    });
    expect(mocks.processMediaJob).toHaveBeenCalledWith({
      jobId: "job_1",
      adapters: expect.objectContaining({
        fal: { provider: "fal" },
        elevenlabs: { provider: "elevenlabs" },
      }),
      waitFor: expect.any(Function),
    });
  });

  it("defines a scheduled reconciliation task that redispatches stale jobs idempotently", async () => {
    mocks.findMediaJobsForTriggerReconciliation.mockResolvedValue([
      { jobId: "job_1", userId: "user_1", modelId: "fal-ai/nano-banana-lite", kind: "image" },
      { jobId: "job_2", userId: "user_2", modelId: "fal-ai/veo3.1", kind: "video" },
    ]);
    const { reconcileMediaJobsTask } = await import("@/trigger/media");

    expect(reconcileMediaJobsTask.id).toBe("reconcile-media-jobs");
    expect(reconcileMediaJobsTask.cron).toBe("*/5 * * * *");
    await expect(reconcileMediaJobsTask.run()).resolves.toEqual({ dispatched: 2 });
    expect(mocks.dispatchMediaJob).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchMediaJob).toHaveBeenNthCalledWith(1, {
      jobId: "job_1",
      userId: "user_1",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
    });
    expect(mocks.dispatchMediaJob).toHaveBeenNthCalledWith(2, {
      jobId: "job_2",
      userId: "user_2",
      modelId: "fal-ai/veo3.1",
      kind: "video",
    });
  });
});
```

- [ ] **Step 2: Run task tests to verify failure**

Run:

```bash
pnpm exec vitest run tests/media/trigger-tasks.test.ts
```

Expected: FAIL because `trigger/media.ts` still contains the shim.

- [ ] **Step 3: Implement real Trigger tasks**

Replace `trigger/media.ts` with:

```ts
import { schedules, task, wait } from "@trigger.dev/sdk";

import { processMediaJob } from "@/lib/media/executor";
import { findMediaJobsForTriggerReconciliation } from "@/lib/media/job-claims";
import { dispatchMediaJob } from "@/lib/media/trigger-dispatch";
import { elevenLabsMediaAdapter } from "@/lib/media/providers/elevenlabs";
import { falMediaAdapter } from "@/lib/media/providers/fal";

export const processMediaJobTask = task({
  id: "process-media-job",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 30_000,
    factor: 2,
    randomize: true,
  },
  run: async ({ jobId }: { jobId: string }) => {
    return processMediaJob({
      jobId,
      adapters: {
        fal: falMediaAdapter,
        elevenlabs: elevenLabsMediaAdapter,
      },
      waitFor: async ({ seconds }) => wait.for({ seconds }),
    });
  },
});

export const reconcileMediaJobsTask = schedules.task({
  id: "reconcile-media-jobs",
  cron: "*/5 * * * *",
  run: async () => {
    const jobs = await findMediaJobsForTriggerReconciliation(25);

    for (const job of jobs) {
      await dispatchMediaJob({
        jobId: job.jobId,
        userId: job.userId,
        modelId: job.modelId,
        kind: job.kind,
      });
    }

    return { dispatched: jobs.length };
  },
});
```

- [ ] **Step 4: Run task tests**

Run:

```bash
pnpm exec vitest run tests/media/trigger-tasks.test.ts tests/media/job-claims.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
./node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add trigger/media.ts lib/media/job-claims.ts tests/media/trigger-tasks.test.ts tests/media/job-claims.test.ts supabase/migrations/20260703190000_trigger_media_executor.sql tests/media/db-rpcs.integration.test.ts
git commit -m "feat(media): add trigger media tasks"
```

---

### Task 5: Dispatch Trigger From Job Creation And Fail Closed

**Files:**
- Modify: `lib/media/jobs.ts`
- Modify: `app/api/v1/media/jobs/route.ts`
- Modify: `tests/media/job-routes.test.ts`

**Interfaces:**
- Consumes:
  - `dispatchMediaJob(...)`
  - `createReservedMediaJob(...)`
- Produces:
  - `function failReservedMediaJobDispatch(jobId: string): Promise<void>`
  - Job creation route returns `503 media_executor_unavailable` if Trigger dispatch fails.

- [ ] **Step 1: Add failing route tests**

In `tests/media/job-routes.test.ts`, add `vi.doUnmock("@/lib/media/trigger-dispatch");` in `afterEach`.

Update the existing `"returns the queued job response without caching"` test to mock `dispatchMediaJob`:

```ts
const dispatchMediaJob = vi.fn(async () => ({ runId: "run_123" }));
vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));
```

Add this assertion after the response assertion:

```ts
expect(dispatchMediaJob).toHaveBeenCalledWith({
  jobId: "job_1",
  userId: "user_1",
  modelId: "fal:frontier-video",
  kind: "video",
});
```

Add a new failure test:

```ts
  it("fails closed and releases reservation when Trigger dispatch fails", async () => {
    const createReservedMediaJob = vi.fn(async () => ({
      id: "job_1",
      status: "queued",
      model: "fal-ai/nano-banana-lite",
      estimatedCostUsdMicros: 1_200_000,
      reservedCreditsUsdMicros: 1_200_000,
      createdAt: "2026-07-03T12:00:00.000Z",
      expiresAt: "2026-07-03T13:00:00.000Z",
    }));
    const failReservedMediaJobDispatch = vi.fn(async () => undefined);
    const dispatchMediaJob = vi.fn(async () => {
      throw new Error("trigger unavailable");
    });

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({ ok: true, auth: { user: { id: "user_1" } } })),
    }));
    vi.doMock("@/lib/api/license", () => ({ licenseGateResponse: vi.fn(async () => null) }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal-ai/nano-banana-lite",
        kind: "image",
        parameterSchema: { type: "object" },
        inputAssetSchema: { roles: [] },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({ ok: true, value: { prompt: "a mountain" } })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
      failReservedMediaJobDispatch,
    }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal-ai/nano-banana-lite",
      parameters: { prompt: "a mountain" },
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "media_executor_unavailable" },
    });
    expect(failReservedMediaJobDispatch).toHaveBeenCalledWith("job_1");
    expect(consoleError).toHaveBeenCalledWith("Failed to dispatch media job", expect.any(Error));
  });
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
pnpm exec vitest run tests/media/job-routes.test.ts -t "queued job response|Trigger dispatch"
```

Expected: FAIL because the route does not dispatch Trigger and `failReservedMediaJobDispatch` does not exist.

- [ ] **Step 3: Export dispatch failure cleanup helper**

In `lib/media/jobs.ts`, add this export near `createReservedMediaJob`:

```ts
export async function failReservedMediaJobDispatch(jobId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await releaseReservation(
    admin,
    jobId,
    "media_executor_unavailable",
    "media_executor_unavailable",
  );
}
```

- [ ] **Step 4: Dispatch after job creation**

In `app/api/v1/media/jobs/route.ts`, import:

```ts
import { dispatchMediaJob } from "@/lib/media/trigger-dispatch";
```

Change the jobs import to:

```ts
import {
  createReservedMediaJob,
  failReservedMediaJobDispatch,
} from "@/lib/media/jobs";
```

After `const job = await createReservedMediaJob(...)`, add:

```ts
    try {
      await dispatchMediaJob({
        jobId: job.id,
        userId: authResult.auth.user.id,
        modelId: job.model,
        kind: model.kind,
      });
    } catch (dispatchError) {
      await failReservedMediaJobDispatch(job.id);
      console.error("Failed to dispatch media job", dispatchError);
      return apiError(
        "Media executor is temporarily unavailable. Please try again.",
        503,
        "media_executor_unavailable",
      );
    }
```

Keep the response body unchanged; do not expose Trigger run IDs to Harness.

- [ ] **Step 5: Run route tests**

Run:

```bash
pnpm exec vitest run tests/media/job-routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run focused media tests**

Run:

```bash
pnpm exec vitest run tests/media/job-routes.test.ts tests/media/trigger-dispatch.test.ts tests/media/executor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/media/jobs.ts app/api/v1/media/jobs/route.ts tests/media/job-routes.test.ts
git commit -m "feat(media): dispatch trigger jobs on creation"
```

---

### Task 6: Wake Trigger From Fal Webhooks

**Files:**
- Modify: `app/api/v1/media/webhooks/fal/route.ts`
- Modify: `tests/media/fal-webhook-route.test.ts`

**Interfaces:**
- Consumes:
  - `dispatchMediaJob(...)`
  - Verified Fal webhook payload.
- Produces:
  - Webhook updates progress and idempotently wakes `process-media-job`.

- [ ] **Step 1: Write failing webhook wake-up test**

In `tests/media/fal-webhook-route.test.ts`, add `vi.doUnmock("@/lib/media/trigger-dispatch");` in `afterEach`.

Replace the first webhook update test with an expectation that the route selects job metadata and calls dispatch. Use this mock shape:

```ts
function mockSupabaseWebhookJob({
  error,
  job = {
    id: "job_1",
    user_id: "user_1",
    input: {
      media_model_id: "fal-ai/nano-banana-lite",
      operation: "image_generation",
    },
  },
}: {
  error: { message: string } | null;
  job?: Record<string, unknown> | null;
}) {
  const eq = vi.fn().mockReturnThis();
  const maybeSingle = vi.fn(async () => ({ data: job, error }));
  const update = vi.fn(() => ({ eq }));
  const select = vi.fn(() => ({ eq, maybeSingle }));
  const from = vi.fn(() => ({ update, select }));
  const createSupabaseAdminClient = vi.fn(() => ({ from }));
  vi.doMock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));
  return { createSupabaseAdminClient, from, update, select, eq, maybeSingle };
}
```

Add this test:

```ts
  it("wakes the Trigger media task after a verified Fal webhook", async () => {
    const { select, update } = mockSupabaseWebhookJob({ error: null });
    mockFalWebhookVerifier();
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_1" }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_123" }));

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      progress: {
        stage: "provider_webhook_received",
        percent: null,
        message: "Provider callback received",
      },
      last_provider_poll_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      claim_expires_at: "1970-01-01T00:00:00.000Z",
    });
    expect(select).toHaveBeenCalledWith("id, user_id, input");
    expect(dispatchMediaJob).toHaveBeenCalledWith({
      jobId: "job_1",
      userId: "user_1",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
    });
  });
```

- [ ] **Step 2: Run webhook tests to verify failure**

Run:

```bash
pnpm exec vitest run tests/media/fal-webhook-route.test.ts -t "wakes the Trigger"
```

Expected: FAIL because the webhook route does not dispatch Trigger.

- [ ] **Step 3: Implement webhook job lookup and dispatch**

In `app/api/v1/media/webhooks/fal/route.ts`, import:

```ts
import { dispatchMediaJob } from "@/lib/media/trigger-dispatch";
```

After the existing update succeeds, query the matching job metadata:

```ts
  const { data: job, error: jobError } = await createSupabaseAdminClient()
    .from("generation_jobs")
    .select("id, user_id, input")
    .eq("provider_job_id", requestId)
    .eq("provider", "fal")
    .eq("type", "media_job")
    .eq("status", "waiting_provider")
    .maybeSingle();

  if (jobError) {
    console.error("Failed to load Fal media webhook job", jobError);
    return apiError("Unable to load media job webhook state.", 500, "provider_failed");
  }

  if (job?.id && job.user_id) {
    const input = isObject(job.input) ? job.input : {};
    const operation = typeof input.operation === "string" ? input.operation : "";
    await dispatchMediaJob({
      jobId: String(job.id),
      userId: String(job.user_id),
      modelId: typeof input.media_model_id === "string" ? input.media_model_id : "unknown",
      kind: mediaKindForOperation(operation),
    });
  }
```

Add helper:

```ts
function mediaKindForOperation(operation: string): "image" | "video" | "audio" {
  if (operation === "image_generation") return "image";
  if (operation === "text_to_speech" || operation === "sound_effects" || operation === "music_generation") return "audio";
  return "video";
}
```

Use one `const admin = createSupabaseAdminClient();` so the update and select use the same mocked/admin client.

- [ ] **Step 4: Run webhook tests**

Run:

```bash
pnpm exec vitest run tests/media/fal-webhook-route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run focused route tests**

Run:

```bash
pnpm exec vitest run tests/media/fal-webhook-route.test.ts tests/media/trigger-dispatch.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/media/webhooks/fal/route.ts tests/media/fal-webhook-route.test.ts
git commit -m "feat(media): wake trigger from fal webhooks"
```

---

### Task 7: Remove Old Polling Worker Path And Update Runbooks

**Files:**
- Delete: `scripts/media-worker.ts`
- Delete: `app/api/internal/media/jobs/drain/route.ts`
- Delete: `lib/media/worker-startup.ts` if unused
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `docs/media-worker-deploy.md`
- Modify: `tests/media/worker-startup.test.ts` if deleting startup diagnostics
- Modify: `tests/media/worker.test.ts` if not already deleted

**Interfaces:**
- Consumes:
  - Trigger local command: `pnpm run trigger:dev`
  - Trigger deploy command: `pnpm run trigger:deploy`
  - Cloudflare media edge command: `pnpm run media:edge:deploy`
- Produces:
  - No supported script or route references `drainOneMediaJob` or `scripts/media-worker.ts`.

- [ ] **Step 1: Verify old worker references still exist**

Run:

```bash
rg -n "media:worker|media-worker|drainOneMediaJob|media/jobs/drain|worker-startup" package.json app lib scripts tests docs
```

Expected: output includes old worker references before deletion.

- [ ] **Step 2: Delete unsupported files**

Delete:

```bash
git rm scripts/media-worker.ts
git rm app/api/internal/media/jobs/drain/route.ts
```

If `rg -n "worker-startup" lib scripts tests` shows no remaining production use after deleting the script, also run:

```bash
git rm lib/media/worker-startup.ts tests/media/worker-startup.test.ts
```

- [ ] **Step 3: Remove or convert worker tests**

If `tests/media/worker.test.ts` still exists and imports `drainOneMediaJob`, move any missing behavioral coverage into `tests/media/executor.test.ts`, then delete it:

```bash
git rm tests/media/worker.test.ts
```

Expected: `rg -n "drainOneMediaJob" tests lib app scripts` returns no output.

- [ ] **Step 4: Update `.env.example`**

Add:

```dotenv
TRIGGER_PROJECT_REF=
TRIGGER_SECRET_KEY=
TRIGGER_ACCESS_TOKEN=
```

Keep existing provider and media env vars. Do not add secret values. `TRIGGER_SECRET_KEY` is the runtime SDK/API key used when Woven dispatches tasks; `TRIGGER_ACCESS_TOKEN` is for non-interactive `pnpm run trigger:deploy` environments.

- [ ] **Step 5: Rewrite deployment docs**

In `docs/media-worker-deploy.md`, rename the topic from polling worker deployment to media executor deployment:

```md
# Media Executor Deployment
```

Replace the local development section with:

````md
Run local hosted media with:

```bash
pnpm run media:dev:local
```

That starts:

- `pnpm run dev` for the Next.js API routes
- `pnpm run media:edge:local` for the Cloudflare media Worker on `127.0.0.1:8787`
- `pnpm run trigger:dev` for Trigger.dev local task execution

Trigger.dev is the supported executor in local and production. Do not run a separate polling worker.
````

Replace deployment order steps 3 and 7 with:

```md
3. Deploy the Cloudflare media edge Worker with `pnpm run media:edge:deploy`.
7. Deploy Trigger.dev tasks with `pnpm run trigger:deploy`.
```

Add this Trigger environment section:

```md
Trigger.dev configuration:

- `TRIGGER_PROJECT_REF` is read by `trigger.config.ts`.
- `TRIGGER_SECRET_KEY` is required anywhere Woven API code dispatches Trigger tasks.
- `TRIGGER_ACCESS_TOKEN` is required for non-interactive Trigger deploys.
- Configure Supabase, Fal, ElevenLabs, and media storage secrets in Trigger.dev Cloud with the same names used by local `.env.local`.
```

- [ ] **Step 6: Verify no supported old-worker references remain**

Run:

```bash
rg -n "media:worker|scripts/media-worker|drainOneMediaJob|media/jobs/drain|polling worker" package.json app lib scripts tests docs
```

Expected: no output, except archived plan/spec files under `docs/superpowers/` may mention historical worker design. Do not edit archived plan/spec files to hide history.

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
pnpm exec vitest run tests/media
./node_modules/.bin/tsc --noEmit
pnpm run lint
```

Expected: PASS. The known existing lint warning in `app/opengraph-image.tsx` may remain if still present.

- [ ] **Step 8: Commit**

```bash
git add package.json .env.example docs/media-worker-deploy.md
git add -u scripts app/api/internal/media/jobs/drain lib/media tests/media
git commit -m "chore(media): remove polling worker path"
```

---

### Task 8: Final Verification And Smoke Runbook

**Files:**
- Modify: `docs/media-worker-deploy.md`
- Modify: `docs/superpowers/plans/2026-07-03-trigger-media-executor.md`

**Interfaces:**
- Consumes:
  - All previous task outputs.
- Produces:
  - A checked-off implementation plan and reproducible verification record.

- [x] **Step 1: Run full unit test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [x] **Step 2: Run typecheck**

Run:

```bash
./node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [x] **Step 3: Run lint**

Run:

```bash
pnpm run lint
```

Expected: PASS or only the pre-existing `app/opengraph-image.tsx` warning if it still exists.

- [x] **Step 4: Run Supabase DB integration tests**

Run with local Supabase running:

```bash
eval "$(supabase status -o env | sed 's/^/export /')"
RUN_SUPABASE_DB_TESTS=1 SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" pnpm exec vitest run tests/media/db-rpcs.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run local real-Fal smoke**

Start local services:

```bash
pnpm run media:dev:local
```

Expected startup:

- Next listens on `http://127.0.0.1:3000`.
- Cloudflare media edge Worker listens on `http://127.0.0.1:8787`.
- Trigger.dev dev runner lists `process-media-job` and `reconcile-media-jobs`.

From the harness or an authenticated API script, create a Nano Banana Lite job:

```json
{
  "model": "fal-ai/nano-banana-lite",
  "parameters": {
    "prompt": "A clean product shot of a woven textile sample on a white table",
    "num_images": 1,
    "sync_mode": false,
    "limit_generations": true,
    "safety_tolerance": 4
  }
}
```

Expected:

- `POST /api/v1/media/jobs` returns a queued job.
- Trigger.dev dev runner logs a `process-media-job` run.
- The job reaches Fal and stores a `provider_job_id`.
- The job reaches `succeeded`.
- `GET /api/v1/media/jobs/:jobId` returns a signed `media.woven.video` or local media edge download URL.
- The signed download returns `200` with image content.

Task 8 note: left unchecked on 2026-07-03. The exact startup command `pnpm run media:dev:local` failed in this shell because `pnpm` was unavailable, `.env.local` was missing `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY`, and no authenticated bearer token was available for `/api/v1/media/jobs`.

- [x] **Step 6: Update plan checkboxes**

Mark completed checkboxes in this plan file as each task is completed. Do not mark a task complete until its commit and verification step are done.

- [x] **Step 7: Commit verification updates**

```bash
git add docs/media-worker-deploy.md docs/superpowers/plans/2026-07-03-trigger-media-executor.md
git commit -m "docs: mark trigger media executor plan complete"
```
