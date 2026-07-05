# Media Reconciliation Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make media reconciliation finalize expired jobs directly, preserve timeout errors, and stop local test fixtures from producing misleading Trigger.dev video runs.

**Architecture:** Supabase remains the source of truth for timeout and billing release. Trigger.dev continues to execute only useful, non-expired media jobs; reconciliation first finalizes expired active rows, then dispatches stale runnable rows with explicit dispatch-source observability. Next.js route handlers remain the API/webhook control plane and use the same dispatch helper.

**Tech Stack:** Next.js 16.2.3 App Router route handlers, Trigger.dev SDK 4.5.0, Supabase Postgres/RPCs, Supabase JS, Vitest 4.1.9, TypeScript 5.9.3, pnpm.

**Docs digest:** `docs/superpowers/research/2026-07-05-media-reconciliation-trigger-docs.md`; local Next route-handler docs read from `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.

## Global Constraints

- Keep Trigger.dev as the media executor.
- Keep Supabase as the source of truth for job state, timeout, billing reservations, and public job errors.
- Reconciliation must finalize expired jobs first, then dispatch only non-expired stale jobs.
- Include `creating` jobs in timeout finalization.
- Do not dispatch expired jobs to Trigger just to discover timeout.
- Add dispatch-source observability for `create`, `reconcile`, and `webhook`.
- Stop silently deriving unknown media operations as `video`.
- Existing polluted rows need local-only cleanup. No production backfill/cleanup is needed because this branch has not shipped.
- No `woven-harness` code changes in this repo.
- No provider adapter, provider pricing formula, or model parameter schema changes.
- Use `pnpm` for package/test commands.
- Before editing Next route handlers, keep following local Next route handler docs: route files export HTTP method functions, use Web `Request`/`Response`, and set `dynamic = "force-dynamic"` / `runtime = "nodejs"` for these API routes.
- `generation_jobs` has no `metadata` column; dispatch metadata must be stored under existing `generation_jobs.input.trigger_dispatch`.

---

## File Structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `supabase/migrations/20260705120000_media_reconciliation_timeouts.sql` | Create | Timeout-finalization RPC, dispatch-metadata RPC, and safer reconciliation finder |
| `tests/media/db-rpcs.integration.test.ts` | Modify | SQL regression coverage and cleanup of test-created users/jobs/assets |
| `lib/media/job-claims.ts` | Modify | TypeScript wrappers for timeout finalization, dispatch metadata, and reconciliation rows |
| `lib/media/trigger-dispatch.ts` | Modify | Required dispatch source, improved tags, and best-effort metadata persistence |
| `tests/media/trigger-dispatch.test.ts` | Modify | Trigger option/tag/source/metadata-write tests |
| `lib/media/kind.ts` | Create | Explicit operation-to-kind mapping with no video fallback |
| `tests/media/kind.test.ts` | Create | Unit coverage for operation kind mapping |
| `trigger/media.ts` | Modify | Reconciliation calls timeout finalizer before dispatch and uses `source: "reconcile"` |
| `tests/media/trigger-tasks.test.ts` | Modify | Scheduled reconciliation finalization and dispatch-source tests |
| `app/api/v1/media/jobs/route.ts` | Modify | Job creation dispatches with `source: "create"` |
| `app/api/v1/media/webhooks/fal/route.ts` | Modify | Webhook uses explicit kind mapping and dispatches with `source: "webhook"` only when triggerable |
| `app/api/v1/media/jobs/[jobId]/route.ts` | Modify | Public status preserves `media_job_timed_out` |
| `tests/media/job-routes.test.ts` | Modify | Route source and public timeout error tests |
| `tests/media/fal-webhook-route.test.ts` | Modify | Webhook source and unknown-kind no-dispatch tests |
| `docs/media-worker-deploy.md` | Modify | Local-only stale-job cleanup runbook |

---

### Task 1: Add SQL Timeout Finalization And Clean DB Test Fixtures

**Files:**
- Create: `supabase/migrations/20260705120000_media_reconciliation_timeouts.sql`
- Modify: `tests/media/db-rpcs.integration.test.ts`

**Interfaces:**
- Produces RPC: `finalize_expired_media_jobs_for_reconciliation(p_now timestamptz default now(), p_limit integer default 100) returns table(id uuid, user_id uuid, previous_status text, status text, error text, reserved_amount_usd_micros bigint)`
- Produces RPC: `record_media_job_trigger_dispatch(p_job_id uuid, p_run_id text, p_dispatch_source text, p_idempotency_key text, p_dispatched_at timestamptz default now()) returns public.generation_jobs`
- Updates RPC: `find_media_jobs_for_trigger_reconciliation(p_limit integer default 25, p_now timestamptz default now())` skips expired jobs and skips unknown media operations instead of returning `video`.
- Consumed by later tasks: `lib/media/job-claims.ts` wrappers.

- [ ] **Step 1: Add integration-test cleanup tracking before adding more DB cases**

In `tests/media/db-rpcs.integration.test.ts`, change the Vitest import:

```ts
import { afterEach, describe, expect, it } from "vitest";
```

Inside `describeDb("media SQL RPC integration", () => {`, add this cleanup set before the first `it(...)`:

```ts
  const createdUserIds = new Set<string>();

  afterEach(async () => {
    if (createdUserIds.size === 0) return;
    const admin = getAdminClient();
    const userIds = [...createdUserIds];
    createdUserIds.clear();

    await Promise.all(userIds.map(async (userId) => {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    }));
  });
```

In `createUserAndAccount()`, after `const userId = userResult.user.id;`, add:

```ts
  createdUserIds.add(userId);
```

- [ ] **Step 2: Write failing SQL tests for timeout finalization and safer reconciliation**

In `tests/media/db-rpcs.integration.test.ts`, after the existing `"finds stale media jobs for Trigger reconciliation"` test, add:

```ts
  it("finalizes expired active media jobs without dispatching them for reconciliation", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const expiredAt = "2026-07-01T11:00:00.000Z";
    const now = "2026-07-01T12:00:00.000Z";
    const creatingJobId = await insertMediaJob({ userId, accountId, status: "creating", reserved: 0, expiresAt: expiredAt });
    const queuedJobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000, expiresAt: expiredAt });
    const runningJobId = await insertMediaJob({ userId, accountId, status: "running", reserved: 100000, expiresAt: expiredAt });
    const waitingJobId = await insertMediaJob({ userId, accountId, status: "waiting_provider", reserved: 100000, expiresAt: expiredAt });

    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_expired_media_jobs_for_reconciliation", {
      p_limit: 25,
      p_now: now,
    });
    expect(finalizeError).toBeNull();
    expect(new Set((finalized ?? []).map((row: { id: string }) => row.id))).toEqual(new Set([
      creatingJobId,
      queuedJobId,
      runningJobId,
      waitingJobId,
    ]));

    const { data: jobs, error: jobsError } = await admin
      .from("generation_jobs")
      .select("id, status, error, final_cost_usd_micros, completed_at")
      .in("id", [creatingJobId, queuedJobId, runningJobId, waitingJobId]);
    expect(jobsError).toBeNull();
    for (const job of jobs ?? []) {
      expect(job).toMatchObject({
        status: "failed",
        error: "media_job_timed_out",
        final_cost_usd_micros: 0,
      });
      expect(job.completed_at).toBeTruthy();
    }

    const { data: reconciliationRows, error: reconciliationError } = await admin.rpc("find_media_jobs_for_trigger_reconciliation", {
      p_limit: 25,
      p_now: now,
    });
    expect(reconciliationError).toBeNull();
    const reconciliationIds = new Set((reconciliationRows ?? []).map((row: ReconciliationRpcRow) => row.id));
    expect(reconciliationIds.has(creatingJobId)).toBe(false);
    expect(reconciliationIds.has(queuedJobId)).toBe(false);
    expect(reconciliationIds.has(runningJobId)).toBe(false);
    expect(reconciliationIds.has(waitingJobId)).toBe(false);
  });

  it("does not derive unknown media operations as video during reconciliation", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const jobId = await insertMediaJob({
      userId,
      accountId,
      status: "queued",
      reserved: 100000,
      operation: "unknown_generation",
    });
    const staleQueuedCreatedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    await admin.from("generation_jobs").update({ created_at: staleQueuedCreatedAt }).eq("id", jobId);

    const { data, error } = await admin.rpc("find_media_jobs_for_trigger_reconciliation", {
      p_limit: 25,
      p_now: new Date().toISOString(),
    });

    expect(error).toBeNull();
    expect((data ?? []).some((row: ReconciliationRpcRow) => row.id === jobId)).toBe(false);
  });

  it("records Trigger dispatch metadata under generation job input", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const jobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });

    const { data, error } = await admin.rpc("record_media_job_trigger_dispatch", {
      p_job_id: jobId,
      p_run_id: "run_123",
      p_dispatch_source: "reconcile",
      p_idempotency_key: jobId,
      p_dispatched_at: "2026-07-01T12:00:00.000Z",
    });

    expect(error).toBeNull();
    expect(data?.input?.trigger_dispatch).toEqual({
      run_id: "run_123",
      dispatch_source: "reconcile",
      idempotency_key: jobId,
      dispatched_at: "2026-07-01T12:00:00+00:00",
    });
  });
```

Update `insertMediaJob` to accept `expiresAt` and `operation`:

```ts
async function insertMediaJob({
  userId,
  accountId,
  status,
  reserved,
  inputAssetIds = [],
  expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  operation = "video_generation",
}: {
  userId: string;
  accountId: string;
  status: string;
  reserved: number;
  inputAssetIds?: string[];
  expiresAt?: string;
  operation?: string;
}) {
```

Inside the inserted row, change:

```ts
        operation: "video_generation",
```

to:

```ts
        operation,
```

and change:

```ts
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
```

to:

```ts
      expires_at: expiresAt,
```

- [ ] **Step 3: Run DB tests to verify failure**

Run with the local Supabase service role key:

```bash
eval "$(supabase status -o env | awk -F= '/^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=/{print "export " $0}')"
pnpm run test:media-db
```

Expected: FAIL because `finalize_expired_media_jobs_for_reconciliation` and `record_media_job_trigger_dispatch` do not exist yet, and unknown operations still fall through to `video`.

- [ ] **Step 4: Add the SQL migration**

Create `supabase/migrations/20260705120000_media_reconciliation_timeouts.sql`:

```sql
create or replace function public.finalize_expired_media_jobs_for_reconciliation(
  p_now timestamptz default now(),
  p_limit integer default 100
)
returns table(
  id uuid,
  user_id uuid,
  previous_status text,
  status text,
  error text,
  reserved_amount_usd_micros bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_released public.generation_jobs%rowtype;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'media_timeout_finalization_limit_out_of_range';
  end if;

  for v_job in
    select *
    from public.generation_jobs jobs
    where jobs.type = 'media_job'
      and jobs.status in ('creating', 'queued', 'running', 'waiting_provider')
      and jobs.expires_at is not null
      and jobs.expires_at <= p_now
    order by jobs.created_at asc
    for update skip locked
    limit p_limit
  loop
    if v_job.account_id is not null and coalesce(v_job.reserved_amount_usd_micros, 0) > 0 then
      select *
      into v_released
      from public.release_balance_reservation(
        v_job.id,
        'failed',
        'media_job_timed_out',
        jsonb_build_object(
          'reason', 'media_job_timed_out',
          'timed_out_at', p_now,
          'previous_status', v_job.status
        )
      );
    else
      update public.generation_jobs jobs
      set status = 'failed',
          final_cost_usd_micros = 0,
          error = 'media_job_timed_out',
          completed_at = coalesce(jobs.completed_at, p_now),
          progress = coalesce(jobs.progress, '{}'::jsonb) || jsonb_build_object(
            'stage', 'failed',
            'percent', null,
            'message', 'Media job timed out'
          )
      where jobs.id = v_job.id
      returning * into v_released;
    end if;

    id := v_released.id;
    user_id := v_released.user_id;
    previous_status := v_job.status;
    status := v_released.status;
    error := v_released.error;
    reserved_amount_usd_micros := v_released.reserved_amount_usd_micros;
    return next;
  end loop;
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
  with candidates as (
    select
      jobs.id,
      jobs.user_id,
      coalesce(nullif(jobs.input->>'media_model_id', ''), jobs.model) as media_model_id,
      case
        when jobs.input->>'operation' = 'image_generation' then 'image'
        when jobs.input->>'operation' = 'video_generation' then 'video'
        when jobs.input->>'operation' in ('text_to_speech', 'sound_effects', 'music_generation') then 'audio'
        else null
      end as media_kind,
      jobs.created_at
    from public.generation_jobs jobs
    where jobs.type = 'media_job'
      and jobs.status in ('queued', 'running', 'waiting_provider')
      and coalesce(jobs.reserved_amount_usd_micros, 0) > 0
      and jobs.expires_at is not null
      and jobs.expires_at > p_now
      and (
        (
          jobs.status = 'queued'
          and jobs.created_at < p_now - interval '2 minutes'
        )
        or (
          jobs.status in ('running', 'waiting_provider')
          and (
            jobs.claim_expires_at is null
            or jobs.claim_expires_at < p_now
            or jobs.last_provider_poll_at is null
            or jobs.last_provider_poll_at < p_now - interval '2 minutes'
          )
        )
      )
  )
  select
    candidates.id,
    candidates.user_id,
    candidates.media_model_id,
    candidates.media_kind
  from candidates
  where candidates.media_kind is not null
  order by candidates.created_at asc
  limit p_limit;
end;
$$;

create or replace function public.record_media_job_trigger_dispatch(
  p_job_id uuid,
  p_run_id text,
  p_dispatch_source text,
  p_idempotency_key text,
  p_dispatched_at timestamptz default now()
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

  if p_run_id is null or btrim(p_run_id) = '' then
    raise exception 'trigger_run_id_required';
  end if;

  if p_dispatch_source not in ('create', 'reconcile', 'webhook') then
    raise exception 'trigger_dispatch_source_invalid';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'trigger_idempotency_key_required';
  end if;

  update public.generation_jobs jobs
  set input = coalesce(jobs.input, '{}'::jsonb) || jsonb_build_object(
        'trigger_dispatch',
        jsonb_build_object(
          'run_id', p_run_id,
          'dispatch_source', p_dispatch_source,
          'idempotency_key', p_idempotency_key,
          'dispatched_at', p_dispatched_at
        )
      )
  where jobs.id = p_job_id
    and jobs.type = 'media_job'
  returning * into v_job;

  if v_job.id is null then
    raise exception 'media_job_not_found';
  end if;

  return v_job;
end;
$$;

revoke all on function public.finalize_expired_media_jobs_for_reconciliation(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.finalize_expired_media_jobs_for_reconciliation(timestamptz, integer) to service_role;

revoke all on function public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz) to service_role;

revoke all on function public.record_media_job_trigger_dispatch(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_media_job_trigger_dispatch(uuid, text, text, text, timestamptz) to service_role;
```

- [ ] **Step 5: Reset local DB and run integration tests**

Run:

```bash
supabase db reset
eval "$(supabase status -o env | awk -F= '/^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=/{print "export " $0}')"
pnpm run test:media-db
```

Expected: PASS for `tests/media/db-rpcs.integration.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260705120000_media_reconciliation_timeouts.sql tests/media/db-rpcs.integration.test.ts
git commit -m "fix(media): finalize expired media jobs in reconciliation"
```

---

### Task 2: Add Dispatch Source, Trigger Tags, And Metadata Persistence

**Files:**
- Modify: `lib/media/job-claims.ts`
- Modify: `lib/media/trigger-dispatch.ts`
- Modify: `tests/media/trigger-dispatch.test.ts`

**Interfaces:**
- Consumes RPC from Task 1: `record_media_job_trigger_dispatch(...)`
- Updates type: `DispatchMediaJobPayload = { jobId: string; userId: string; modelId: string; kind: "image" | "video" | "audio"; source: "create" | "reconcile" | "webhook" }`
- Produces helper: `recordMediaJobTriggerDispatch(input: RecordMediaJobTriggerDispatchInput): Promise<void>`

- [ ] **Step 1: Write failing dispatch tests**

In `tests/media/trigger-dispatch.test.ts`, add `createSupabaseAdminClient` to the hoisted mocks:

```ts
const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));
```

Add the Supabase mock:

```ts
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));
```

In `afterEach`, add:

```ts
    mocks.createSupabaseAdminClient.mockReset();
    vi.restoreAllMocks();
```

Replace the first test body with:

```ts
    const rpc = vi.fn(async () => ({ data: { id: "job_123" }, error: null }));
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.trigger.mockResolvedValue({ id: "run_123" });
    const { dispatchMediaJob } = await import("@/lib/media/trigger-dispatch");

    await expect(dispatchMediaJob({
      jobId: "job_123",
      userId: "user_123",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
      source: "create",
    })).resolves.toEqual({ runId: "run_123" });

    expect(mocks.trigger).toHaveBeenCalledWith(
      "process-media-job",
      { jobId: "job_123" },
      {
        idempotencyKey: "job_123",
        concurrencyKey: "media-user:user_123",
        queue: "media-image",
        tags: [
          "media",
          "media-job:job_123",
          "media-kind:image",
          "media-queue:media-image",
          "media-model:fal-ai/nano-banana-lite",
          "media-dispatch-source:create",
          "media-user:user_123",
        ],
      },
    );
    expect(rpc).toHaveBeenCalledWith("record_media_job_trigger_dispatch", {
      p_job_id: "job_123",
      p_run_id: "run_123",
      p_dispatch_source: "create",
      p_idempotency_key: "job_123",
      p_dispatched_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
```

Add this test:

```ts
  it("does not fail dispatch when metadata persistence fails after Trigger accepts the run", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "database unavailable" } }));
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.trigger.mockResolvedValue({ id: "run_123" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { dispatchMediaJob } = await import("@/lib/media/trigger-dispatch");

    await expect(dispatchMediaJob({
      jobId: "job_123",
      userId: "user_123",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
      source: "webhook",
    })).resolves.toEqual({ runId: "run_123" });

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to record media Trigger dispatch metadata",
      expect.any(Error),
    );
  });
```

- [ ] **Step 2: Run dispatch tests to verify failure**

```bash
pnpm exec vitest run tests/media/trigger-dispatch.test.ts
```

Expected: FAIL because `source` is not accepted, `media-job` / `media-dispatch-source` tags are missing, and metadata persistence is not called.

- [ ] **Step 3: Implement the job-claims wrapper**

In `lib/media/job-claims.ts`, add:

```ts
export type MediaDispatchSource = "create" | "reconcile" | "webhook";

export type RecordMediaJobTriggerDispatchInput = {
  jobId: string;
  runId: string;
  source: MediaDispatchSource;
  idempotencyKey: string;
  dispatchedAt?: string;
};

export async function recordMediaJobTriggerDispatch({
  jobId,
  runId,
  source,
  idempotencyKey,
  dispatchedAt = new Date().toISOString(),
}: RecordMediaJobTriggerDispatchInput): Promise<void> {
  const { error } = await createSupabaseAdminClient().rpc("record_media_job_trigger_dispatch", {
    p_job_id: jobId,
    p_run_id: runId,
    p_dispatch_source: source,
    p_idempotency_key: idempotencyKey,
    p_dispatched_at: dispatchedAt,
  });

  if (error) {
    throw new Error(error.message);
  }
}
```

- [ ] **Step 4: Implement dispatch source, tags, and metadata write**

In `lib/media/trigger-dispatch.ts`, import the new type/helper:

```ts
import {
  recordMediaJobTriggerDispatch,
  type MediaDispatchSource,
} from "@/lib/media/job-claims";
```

Update `DispatchMediaJobPayload`:

```ts
export type DispatchMediaJobPayload = {
  jobId: string;
  userId: string;
  modelId: string;
  kind: "image" | "video" | "audio";
  source: MediaDispatchSource;
};
```

Add `source` to the destructuring and replace the `tags` array:

```ts
      tags: [
        "media",
        `media-job:${jobId}`,
        `media-kind:${kind}`,
        `media-queue:${queue.name}`,
        `media-model:${modelId}`,
        `media-dispatch-source:${source}`,
        mediaConcurrencyKey(userId),
      ],
```

After `tasks.trigger(...)` resolves, add:

```ts
  try {
    await recordMediaJobTriggerDispatch({
      jobId,
      runId: handle.id,
      source,
      idempotencyKey: jobId,
    });
  } catch (error) {
    console.error("Failed to record media Trigger dispatch metadata", error);
  }
```

- [ ] **Step 5: Run dispatch tests**

```bash
pnpm exec vitest run tests/media/trigger-dispatch.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/media/job-claims.ts lib/media/trigger-dispatch.ts tests/media/trigger-dispatch.test.ts
git commit -m "fix(media): tag trigger dispatch sources"
```

---

### Task 3: Add Explicit Media Operation Kind Mapping

**Files:**
- Create: `lib/media/kind.ts`
- Create: `tests/media/kind.test.ts`

**Interfaces:**
- Produces: `mediaKindForOperation(operation: string): MediaKind | null`
- Produces: `triggerMediaKindForOperation(operation: string): "image" | "video" | "audio" | null`
- Later tasks consume this helper in the Fal webhook route.

- [ ] **Step 1: Write failing kind-mapping tests**

Create `tests/media/kind.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mediaKindForOperation, triggerMediaKindForOperation } from "@/lib/media/kind";

describe("media operation kind mapping", () => {
  it("maps known media operations explicitly", () => {
    expect(mediaKindForOperation("image_generation")).toBe("image");
    expect(mediaKindForOperation("video_generation")).toBe("video");
    expect(mediaKindForOperation("text_to_speech")).toBe("audio");
    expect(mediaKindForOperation("sound_effects")).toBe("audio");
    expect(mediaKindForOperation("music_generation")).toBe("audio");
    expect(mediaKindForOperation("reel_captions")).toBe("captions");
  });

  it("does not map unknown operations to video", () => {
    expect(mediaKindForOperation("unknown_generation")).toBeNull();
    expect(triggerMediaKindForOperation("unknown_generation")).toBeNull();
  });

  it("returns only Trigger-supported media kinds from triggerMediaKindForOperation", () => {
    expect(triggerMediaKindForOperation("image_generation")).toBe("image");
    expect(triggerMediaKindForOperation("video_generation")).toBe("video");
    expect(triggerMediaKindForOperation("music_generation")).toBe("audio");
    expect(triggerMediaKindForOperation("reel_captions")).toBeNull();
  });
});
```

- [ ] **Step 2: Run kind tests to verify failure**

```bash
pnpm exec vitest run tests/media/kind.test.ts
```

Expected: FAIL because `lib/media/kind.ts` does not exist.

- [ ] **Step 3: Implement the kind helper**

Create `lib/media/kind.ts`:

```ts
import type { MediaKind, MediaOperation } from "@/lib/media/types";

const OPERATION_KIND = {
  image_generation: "image",
  video_generation: "video",
  text_to_speech: "audio",
  sound_effects: "audio",
  music_generation: "audio",
  reel_captions: "captions",
} satisfies Record<MediaOperation, MediaKind>;

export type TriggerableMediaKind = "image" | "video" | "audio";

export function mediaKindForOperation(operation: string): MediaKind | null {
  return Object.prototype.hasOwnProperty.call(OPERATION_KIND, operation)
    ? OPERATION_KIND[operation as MediaOperation]
    : null;
}

export function triggerMediaKindForOperation(operation: string): TriggerableMediaKind | null {
  const kind = mediaKindForOperation(operation);
  return kind === "image" || kind === "video" || kind === "audio" ? kind : null;
}
```

- [ ] **Step 4: Run kind tests**

```bash
pnpm exec vitest run tests/media/kind.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/media/kind.ts tests/media/kind.test.ts
git commit -m "fix(media): make media kind derivation explicit"
```

---

### Task 4: Make Scheduled Reconciliation Finalize Expired Jobs First

**Files:**
- Modify: `lib/media/job-claims.ts`
- Modify: `trigger/media.ts`
- Modify: `tests/media/trigger-tasks.test.ts`

**Interfaces:**
- Consumes RPC from Task 1: `finalize_expired_media_jobs_for_reconciliation`
- Consumes dispatch payload from Task 2: `source: "reconcile"`
- Produces: `finalizeExpiredMediaJobsForReconciliation(limit?: number): Promise<ExpiredMediaJobFinalization[]>`
- Updates scheduled task return shape to `{ finalized: number; dispatched: number }`.

- [ ] **Step 1: Write failing reconciliation task tests**

In `tests/media/trigger-tasks.test.ts`, update `ReconcileMediaJobsTaskShape`:

```ts
type ReconcileMediaJobsTaskShape = {
  id: string;
  cron: string;
  run: () => Promise<{ finalized: number; dispatched: number }>;
};
```

Add `finalizeExpiredMediaJobsForReconciliation` to hoisted mocks:

```ts
  finalizeExpiredMediaJobsForReconciliation: vi.fn(),
```

Expose it from the `@/lib/media/job-claims` mock:

```ts
  finalizeExpiredMediaJobsForReconciliation: mocks.finalizeExpiredMediaJobsForReconciliation,
```

Replace the reconciliation test setup and expectations:

```ts
    mocks.finalizeExpiredMediaJobsForReconciliation.mockResolvedValue([
      { jobId: "expired_1" },
      { jobId: "expired_2" },
    ]);
    mocks.findMediaJobsForTriggerReconciliation.mockResolvedValue([
      { jobId: "job_1", userId: "user_1", modelId: "fal-ai/nano-banana-lite", kind: "image" },
      { jobId: "job_2", userId: "user_2", modelId: "fal-ai/veo3.1", kind: "video" },
    ]);
```

Replace the response expectation:

```ts
    await expect(reconcileTask.run()).resolves.toEqual({ finalized: 2, dispatched: 2 });
    expect(mocks.finalizeExpiredMediaJobsForReconciliation).toHaveBeenCalledWith(100);
    expect(mocks.findMediaJobsForTriggerReconciliation).toHaveBeenCalledWith(25);
```

Update dispatch expectations to include source:

```ts
      source: "reconcile",
```

Add a new test:

```ts
  it("still dispatches stale jobs when no expired jobs were finalized", async () => {
    mocks.finalizeExpiredMediaJobsForReconciliation.mockResolvedValue([]);
    mocks.findMediaJobsForTriggerReconciliation.mockResolvedValue([
      { jobId: "job_1", userId: "user_1", modelId: "fal-ai/nano-banana-lite", kind: "image" },
    ]);

    const { reconcileMediaJobsTask } = await import("@/trigger/media");
    const reconcileTask = reconcileMediaJobsTask as unknown as ReconcileMediaJobsTaskShape;

    await expect(reconcileTask.run()).resolves.toEqual({ finalized: 0, dispatched: 1 });
    expect(mocks.dispatchMediaJob).toHaveBeenCalledWith({
      jobId: "job_1",
      userId: "user_1",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
      source: "reconcile",
    });
  });
```

- [ ] **Step 2: Run trigger task tests to verify failure**

```bash
pnpm exec vitest run tests/media/trigger-tasks.test.ts
```

Expected: FAIL because the finalization wrapper and `source` are not wired.

- [ ] **Step 3: Add finalization wrapper**

In `lib/media/job-claims.ts`, add:

```ts
export type ExpiredMediaJobFinalization = {
  jobId: string;
  userId: string;
  previousStatus: string;
  status: string;
  error: string;
};

type ExpiredMediaJobFinalizationRpcRow = {
  id?: unknown;
  user_id?: unknown;
  previous_status?: unknown;
  status?: unknown;
  error?: unknown;
};

export async function finalizeExpiredMediaJobsForReconciliation(limit = 100): Promise<ExpiredMediaJobFinalization[]> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "finalize_expired_media_jobs_for_reconciliation",
    { p_limit: limit, p_now: new Date().toISOString() },
  );

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).flatMap((row: ExpiredMediaJobFinalizationRpcRow) => {
    const jobId = stringValue(row.id);
    const userId = stringValue(row.user_id);
    const previousStatus = stringValue(row.previous_status);
    const status = stringValue(row.status);
    const jobError = stringValue(row.error);
    return jobId && userId && previousStatus && status && jobError
      ? [{ jobId, userId, previousStatus, status, error: jobError }]
      : [];
  });
}
```

- [ ] **Step 4: Update scheduled reconciliation**

In `trigger/media.ts`, change the import:

```ts
import {
  finalizeExpiredMediaJobsForReconciliation,
  findMediaJobsForTriggerReconciliation,
} from "@/lib/media/job-claims";
```

Replace the reconciliation `run` body with:

```ts
  run: async () => {
    const finalized = await finalizeExpiredMediaJobsForReconciliation(100);
    const jobs = await findMediaJobsForTriggerReconciliation(25);

    for (const job of jobs) {
      await dispatchMediaJob({
        jobId: job.jobId,
        userId: job.userId,
        modelId: job.modelId,
        kind: job.kind,
        source: "reconcile",
      });
    }

    return { finalized: finalized.length, dispatched: jobs.length };
  },
```

- [ ] **Step 5: Run trigger task tests**

```bash
pnpm exec vitest run tests/media/trigger-tasks.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/media/job-claims.ts trigger/media.ts tests/media/trigger-tasks.test.ts
git commit -m "fix(media): reconcile expired jobs before trigger dispatch"
```

---

### Task 5: Update Routes And Public Timeout Errors

**Files:**
- Modify: `app/api/v1/media/jobs/route.ts`
- Modify: `app/api/v1/media/webhooks/fal/route.ts`
- Modify: `app/api/v1/media/jobs/[jobId]/route.ts`
- Modify: `tests/media/job-routes.test.ts`
- Modify: `tests/media/fal-webhook-route.test.ts`

**Interfaces:**
- Consumes Task 2 dispatch payload with `source`.
- Consumes Task 3 `triggerMediaKindForOperation`.
- Public status error mapping adds `{ code: "media_job_timed_out", message: "Media job timed out." }`.

- [ ] **Step 1: Update job creation route tests for source and timeout public error**

In `tests/media/job-routes.test.ts`, every `expect(dispatchMediaJob).toHaveBeenCalledWith({ ... })` for job creation should include:

```ts
      source: "create",
```

After the `"preserves model_not_enabled as the public failure code on status reads"` test, add:

```ts
  it("preserves media_job_timed_out as the public failure code on status reads", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));

    const maybeSingle = vi.fn(async () => ({
      data: {
        id: "job_1",
        status: "failed",
        estimated_cost_usd_micros: 1_200_000,
        reserved_amount_usd_micros: 1_200_000,
        final_cost_usd_micros: 0,
        progress: { stage: "failed", percent: null },
        input: { media_model_id: "fal-ai/nano-banana-lite" },
        output: null,
        error: "media_job_timed_out",
        created_at: "2026-07-01T12:00:00.000Z",
        expires_at: "2026-07-01T13:00:00.000Z",
        started_at: "2026-07-01T12:01:00.000Z",
        completed_at: "2026-07-01T13:00:00.000Z",
      },
      error: null,
    }));
    const chain = {
      eq: vi.fn(() => chain),
      maybeSingle,
    };
    const select = vi.fn(() => chain);
    const from = vi.fn(() => ({ select }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createSupabaseAdminClient: vi.fn(() => ({ from })),
    }));
    vi.doMock("@/lib/media/output-urls", () => ({
      presentJobOutputs: vi.fn(async () => []),
    }));

    const { GET } = await import("@/app/api/v1/media/jobs/[jobId]/route");
    const response = await GET(
      new Request("https://example.test/api/v1/media/jobs/job_1"),
      { params: Promise.resolve({ jobId: "job_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "media_job_timed_out",
        message: "Media job timed out.",
      },
    });
  });
```

- [ ] **Step 2: Update Fal webhook tests for source and unknown operation no-dispatch**

In `tests/media/fal-webhook-route.test.ts`, update the existing dispatch assertion to include:

```ts
      source: "webhook",
```

Add this test after the existing wake-up test:

```ts
  it("does not dispatch a Trigger run when webhook job operation is unknown", async () => {
    mockSupabaseWebhookJob({
      error: null,
      input: {
        media_model_id: "legacy-model",
        operation: "unknown_generation",
      },
    });
    mockFalWebhookVerifier();
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_1" }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_123" }));

    expect(response.status).toBe(200);
    expect(dispatchMediaJob).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith("Skipping Fal webhook Trigger dispatch for unsupported media operation", {
      jobId: "job_1",
      operation: "unknown_generation",
    });
  });
```

Update `mockSupabaseWebhookJob` so it accepts an `input` override. Its default should remain:

```ts
input: {
  media_model_id: "fal-ai/nano-banana-lite",
  operation: "image_generation",
}
```

- [ ] **Step 3: Run route tests to verify failure**

```bash
pnpm exec vitest run tests/media/job-routes.test.ts tests/media/fal-webhook-route.test.ts
```

Expected: FAIL because callers do not pass `source`, webhook still defaults unknown operations to video, and timeout errors still collapse to provider_failed.

- [ ] **Step 4: Update job creation dispatch**

In `app/api/v1/media/jobs/route.ts`, update the `dispatchMediaJob` call:

```ts
      await dispatchMediaJob({
        jobId: job.id,
        userId: authResult.auth.user.id,
        modelId: job.model,
        kind: model.kind,
        source: "create",
      });
```

- [ ] **Step 5: Update Fal webhook kind derivation and dispatch source**

In `app/api/v1/media/webhooks/fal/route.ts`, replace the local `mediaKindForOperation` function with:

```ts
import { triggerMediaKindForOperation } from "@/lib/media/kind";
```

In the dispatch block, replace the direct dispatch with:

```ts
    const kind = triggerMediaKindForOperation(operation);
    if (!kind) {
      console.warn("Skipping Fal webhook Trigger dispatch for unsupported media operation", {
        jobId: String(job.id),
        operation,
      });
    } else {
      await dispatchMediaJob({
        jobId: String(job.id),
        userId: String(job.user_id),
        modelId: typeof input.media_model_id === "string" ? input.media_model_id : "unknown",
        kind,
        source: "webhook",
      });
    }
```

- [ ] **Step 6: Preserve public timeout errors**

In `app/api/v1/media/jobs/[jobId]/route.ts`, add this branch to `publicJobError` after `model_not_enabled`:

```ts
  if (error === "media_job_timed_out") {
    return {
      code: "media_job_timed_out",
      message: "Media job timed out.",
    };
  }
```

- [ ] **Step 7: Run route tests**

```bash
pnpm exec vitest run tests/media/job-routes.test.ts tests/media/fal-webhook-route.test.ts tests/media/kind.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/v1/media/jobs/route.ts app/api/v1/media/webhooks/fal/route.ts 'app/api/v1/media/jobs/[jobId]/route.ts' tests/media/job-routes.test.ts tests/media/fal-webhook-route.test.ts
git commit -m "fix(media): preserve trigger dispatch source in routes"
```

---

### Task 6: Document And Run Local-Only Stale Job Cleanup

**Files:**
- Modify: `docs/media-worker-deploy.md`

**Interfaces:**
- Consumes Task 1 RPC: `finalize_expired_media_jobs_for_reconciliation`
- Produces local runbook for stale local fixture cleanup.

- [ ] **Step 1: Add local cleanup docs**

In `docs/media-worker-deploy.md`, after the `## Local SQL RPC Tests` section, add:

````md
## Local Expired Media Job Cleanup

This branch had local-only Trigger noise from stale integration-test fixture rows. The fix is the
same RPC used by scheduled reconciliation, not a production backfill.

Run this only against local Supabase:

```bash
eval "$(supabase status -o env | awk -F= '/^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=/{print "export " $0}')"
pnpm exec tsx -e 'import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await admin.rpc("finalize_expired_media_jobs_for_reconciliation", { p_limit: 1000, p_now: new Date().toISOString() });
if (error) throw error;
console.log(JSON.stringify({ finalized: data?.length ?? 0, jobs: data }, null, 2));'
```

Verify no expired active media jobs remain:

```bash
eval "$(supabase status -o env | awk -F= '/^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=/{print "export " $0}')"
pnpm exec tsx -e 'import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await admin.from("generation_jobs").select("id,status,error,model,expires_at").eq("type", "media_job").in("status", ["creating", "queued", "running", "waiting_provider"]).lte("expires_at", new Date().toISOString());
if (error) throw error;
console.log(JSON.stringify({ remaining: data?.length ?? 0, jobs: data }, null, 2));'
```

Expected: `remaining` is `0`.
````

- [ ] **Step 2: Run doc diff check**

```bash
git diff --check -- docs/media-worker-deploy.md
```

Expected: no output.

- [ ] **Step 3: Apply migrations locally and run cleanup**

Run:

```bash
supabase db reset
eval "$(supabase status -o env | awk -F= '/^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=/{print "export " $0}')"
pnpm run test:media-db
```

Expected: PASS.

To preserve the current local DB instead of resetting, apply the migration and run the cleanup command from the new docs against the current local Supabase.

- [ ] **Step 4: Run focused unit tests**

```bash
pnpm exec vitest run tests/media/trigger-dispatch.test.ts tests/media/trigger-tasks.test.ts tests/media/kind.test.ts tests/media/job-routes.test.ts tests/media/fal-webhook-route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run broader verification**

```bash
pnpm test
pnpm run build
git diff --check
```

Expected: PASS. If sandbox-only filesystem or network errors occur, rerun the same command outside the sandbox and record the exact reason.

- [ ] **Step 6: Commit**

```bash
git add docs/media-worker-deploy.md
git commit -m "docs(media): add local expired job cleanup"
```
