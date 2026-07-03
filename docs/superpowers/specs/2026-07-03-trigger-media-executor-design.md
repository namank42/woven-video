# Trigger Media Executor Design

**Date:** 2026-07-03
**Status:** Approved design - pending written-spec review
**Repo scope:** `woven-video` backend/API, Supabase media-job RPCs, Trigger.dev task definitions, media executor docs, and tests. `woven-harness` remains a downstream consumer and is not implemented here.
**Docs digest:** `docs/superpowers/research/2026-07-03-trigger-media-executor-docs.md`

---

## Purpose

Replace the always-on hosted-media polling worker with Trigger.dev Cloud as the media job executor in
both local development and production.

Hosted media jobs are paid user-facing work. The executor needs durable runs, retries, queue
concurrency, per-user throttling, logs, replay, and a local dev path that matches production. A
separate VPS-style polling process would work, but it would make Woven own process supervision,
scaling, alerting, deploy drift, and stale-worker failure modes.

## Decisions Locked

- Use Trigger.dev Cloud, not self-hosted Trigger.dev.
- Use Trigger.dev for local and production execution. Local development should not rely on the old
  polling worker as the normal path.
- Replace the production executor completely. No always-on polling worker or internal drain-route
  fallback is required because hosted media has not shipped yet.
- Keep Supabase as the source of truth for job state, billing reservations, usage events, model
  catalog rows, media assets, and output metadata.
- Keep Cloudflare Worker + R2 as the media byte storage and signed upload/download boundary.
- Keep the Woven API as the client-facing control plane. Harness continues polling Woven job status;
  it never polls Fal directly.
- Process exactly one Woven media job per Trigger task run, keyed by `jobId`.
- Trigger runs must use `idempotencyKey = jobId`.
- Provider waiting should use Trigger durable waits between polls, not a hot process loop.
- Fal webhooks remain useful as a wake-up signal, but they do not replace the Woven status API or
  Supabase job state.

## Non-Goals

- No `woven-harness` code changes in this repo.
- No change to the media catalog model list, pricing formulas, or provider parameter schemas.
- No provider BYOK support.
- No direct-to-user provider output URLs in production.
- No Trigger.dev self-hosting.
- No long-running media executor on Vercel.
- No long-running media executor on a raw Cloudflare Worker.
- No compatibility guarantee for `scripts/media-worker.ts` or
  `app/api/internal/media/jobs/drain/route.ts`; both may be removed as part of the migration.

## Target Architecture

```text
Harness
  -> Woven API on Vercel
  -> Supabase job row + credit reservation
  -> Trigger.dev Cloud task
  -> Fal / ElevenLabs
  -> Cloudflare media Worker + R2
  -> Supabase final status + billing settlement
  -> Harness polls Woven API for status/download URLs
```

The app, database, provider adapter, and storage boundaries stay the same. The changed layer is the
executor:

```text
Before:
  scripts/media-worker.ts polls Supabase forever and drains any claimable job.

After:
  Trigger.dev runs process-media-job({ jobId }) for one exact job.
```

Local development should mirror production:

```text
local Next API
  -> Trigger.dev dev runner
  -> local Supabase
  -> local Cloudflare Worker with real R2 binding
  -> real Fal / ElevenLabs
```

## Job Lifecycle

### Create Job

`POST /api/v1/media/jobs` remains the only client job-creation endpoint.

The route should:

1. Authenticate the bearer token.
2. Enforce license and hosted-credit requirements.
3. Load the enabled media model from Supabase.
4. Validate parameters and uploaded input asset roles.
5. Create the reserved `generation_jobs` row.
6. Trigger `process-media-job` in Trigger.dev with:
   - payload `{ jobId }`
   - `idempotencyKey = jobId`
   - tags containing useful diagnostics such as user ID, model ID, and media kind
   - queue/concurrency options for the model class
7. Store Trigger run metadata on the job when dispatch succeeds.
8. Return the job response immediately.

If Trigger dispatch fails after the reserved job is created, the API must fail closed:

- release the credit reservation,
- mark the job `failed` with error `media_executor_unavailable` and dispatch-failure metadata,
- return `503 media_executor_unavailable`,
- do not leave the job as claimable `queued`.

Reconciliation is a safety net, not the primary success path for newly-created jobs.

### Process Job

The main task is:

```text
process-media-job({ jobId })
```

It should:

1. Claim that exact job in Supabase.
2. Exit successfully if the job is already terminal.
3. Load the media model and provider adapter.
4. Sign Woven input asset download URLs and map roles to provider fields.
5. Submit to Fal/ElevenLabs if the job has no `provider_job_id`.
6. Store `provider_job_id` and mark the job `waiting_provider`.
7. Poll provider status after durable waits.
8. Fetch provider result when complete.
9. Download provider output bytes.
10. Upload output bytes to R2 through the Cloudflare media Worker.
11. Mark output asset rows ready.
12. Calculate final cost from the stored quote/provider cost.
13. Record usage and settle the reservation.
14. Mark the job `succeeded`.

On failure, it should release or settle the job with the same public error contract the API already
uses, including `provider_failed`, `model_not_enabled`, `media_input_unavailable`,
`media_output_materialization_failed`, and `provider_not_configured`.

The task should not hold a Supabase claim lease across long Trigger waits. It should claim the job for
bounded mutation windows, such as provider submission, provider status checks, output
materialization, and settlement. When the provider is still running, it should persist
`waiting_provider` state, perform a durable Trigger wait, and reclaim the same job ID before the next
poll or finalization step.

### Exact Claiming

The generic `claim_media_jobs(p_limit, p_lease_seconds)` RPC is the wrong primary primitive for
Trigger because it claims any eligible job. Trigger tasks need deterministic ownership of the job ID
they were created to process.

Add an exact-claim RPC such as:

```text
claim_media_job_by_id(p_job_id uuid, p_lease_seconds integer)
```

It should:

- claim only the requested media job,
- respect existing terminal states,
- use claim tokens and claim leases,
- allow reclaiming stale `running` or `waiting_provider` jobs,
- reject jobs that are not ready because required input uploads are incomplete,
- return enough row data for the executor to continue.

Existing claim-fenced finalization RPCs should remain in use so retries, replays, webhooks, and
scheduled reconciliation cannot double-settle a job.

## Trigger Tasks

### `process-media-job`

The task owns one media job from dispatch to terminal state. It should use Trigger.dev retry settings
for transient executor/provider/storage failures, while preserving Supabase claim fencing for
correctness.

Use Trigger queues for global provider capacity. Initial conservative limits:

```text
image queue concurrency: 10
video queue concurrency: 2
audio queue concurrency: 3
```

Use per-user `concurrencyKey` where practical. Initial target:

```text
per-user active media jobs: 1 or 2
```

The exact values should be configuration-driven so production can tune them without changing executor
logic.

Provider waiting should use `wait.for(...)` between status checks. Trigger.dev Cloud docs say waits
longer than 5 seconds checkpoint the task and do not count toward compute duration, which makes this
fit Fal's queued provider model.

### `reconcile-media-jobs`

Add a scheduled Trigger task that periodically finds stale jobs and retriggers `process-media-job`
idempotently.

It should cover:

- jobs left `queued` by an API crash or deploy interruption before Trigger dispatch metadata is
  written,
- jobs in `running` with expired claim leases,
- jobs in `waiting_provider` whose provider webhook was missed,
- jobs past `expires_at`, which should fail with `media_job_timed_out`.

Retriggers must use the same `idempotencyKey = jobId` rule so reconciliation cannot create duplicate
active executor runs for the same job.

## Fal Webhooks

Fal webhook verification stays in the Woven API.

After this migration, the webhook should be treated as a wake-up signal:

1. Verify the Fal signature.
2. Locate the matching `generation_jobs` row by `provider_job_id`.
3. Update progress metadata such as `provider_webhook_received`.
4. Trigger or retrigger `process-media-job({ jobId })` idempotently.

The webhook should not finalize jobs directly. Finalization remains in the Trigger executor so output
materialization, billing settlement, retries, and logs all stay on one execution path.

## Storage And Output Contract

Trigger downloads provider output bytes and uploads them to R2 through the existing Cloudflare media
Worker signed upload path. Supabase stores asset metadata and output descriptors, not media bytes.

This keeps the existing production contract:

- clients receive Woven-domain download URLs,
- download URLs are short-lived and re-signed on status reads,
- output retention is controlled by Woven,
- cleanup can delete R2 keys by Woven storage path,
- provider URL shapes do not leak into client contracts.

The extra download/upload step is intentional. Images should be fast; video finalization can take
noticeable seconds, so status responses should make `finalizing` or equivalent progress clear when
generation is complete but R2 copy is still underway.

## Deployment And Local Development

### Production

Production deployment has four moving parts:

1. Supabase migrations for exact-claim and dispatch state.
2. Cloudflare media Worker for `media.woven.video/uploads/*`, `/objects/*`, and `/internal/*`.
3. Vercel app for Woven API routes.
4. Trigger.dev Cloud tasks for media execution and reconciliation.

The deploy docs should distinguish the Cloudflare media edge Worker from the Trigger media executor.
The current `media:worker:deploy` script name is misleading because it deploys the Cloudflare R2
gateway, not the media executor. Rename or document it as the media edge deploy path.

### Local

Local development should run:

```bash
npm run dev
npm run media:edge:local
npx trigger.dev@latest dev
```

or a combined script that starts those three processes.

Local acceptance must prove the real execution path:

```text
local API -> Trigger.dev dev runner -> local Supabase -> local Cloudflare Worker -> real R2 -> real Fal
```

The old `npm run media:worker:local` flow should be removed from the supported runbook once the
Trigger path works.

### Environment

Document Trigger.dev environment requirements alongside the existing media env:

```text
Trigger.dev project reference in trigger.config.ts
Trigger.dev CLI/cloud access token for deploy environments
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
FAL_KEY
ELEVENLABS_API_KEY
MEDIA_BASE_URL
MEDIA_TOKEN_SECRET
MEDIA_WORKER_SHARED_SECRET
MEDIA_OUTPUT_RETENTION_SECONDS
MEDIA_JOB_TIMEOUT_SECONDS
MEDIA_FAL_WEBHOOK_BASE_URL
FAL_WEBHOOK_JWKS_URL
```

Secrets used by Trigger tasks must be configured in Trigger.dev Cloud and in local dev in the same
shape so local tests cover real executor behavior.

## Testing

### Unit Tests

- Job creation triggers `process-media-job` with `idempotencyKey = jobId`.
- Trigger dispatch failure releases the reservation and does not leave a claimable queued job.
- `processMediaJob(jobId)` claims only that job.
- Terminal jobs are no-ops on retry/replay.
- Provider waiting uses durable wait/poll behavior.
- Provider success copies outputs to R2 and settles billing.
- Provider failure releases the reservation with the stable public error.
- Reconciliation retriggers stale jobs idempotently.
- Fal webhook verification triggers/retriggers the same per-job task instead of finalizing inline.

### Supabase Integration Tests

- Exact claim claims only the requested media job.
- Concurrent exact claims return one winner.
- Terminal jobs cannot be reclaimed.
- Jobs with incomplete uploads are not claimable.
- Stale waiting jobs are eligible for reconciliation.
- Dispatch-failed jobs do not remain claimable unless explicitly reset.

### Smoke Tests

Local smoke:

- local Next API,
- Trigger.dev dev runner,
- local Supabase,
- local Cloudflare Worker using real R2,
- real Fal Nano Banana Lite generation,
- signed Woven download URL returns the generated file.

Production smoke:

- deployed Vercel API,
- deployed Trigger.dev Cloud task,
- deployed Cloudflare media Worker/R2,
- production Supabase,
- real Fal generation,
- successful status read and signed download.

## Rollout

Because hosted media is not shipped yet, this can be a direct replacement:

1. Add Trigger.dev dependency, config, tasks, and docs digest.
2. Add exact-claim Supabase RPC and dispatch failure handling.
3. Refactor executor logic around `processMediaJob(jobId)`.
4. Update job creation to dispatch Trigger.dev.
5. Update Fal webhook to wake the Trigger task idempotently.
6. Add scheduled reconciliation task.
7. Remove or stop documenting the old polling worker and drain route.
8. Rename/document Cloudflare edge Worker scripts clearly.
9. Run unit tests, Supabase integration tests, and local real-Fal smoke.
10. Deploy Supabase, Cloudflare edge Worker, Vercel app, and Trigger.dev tasks.
11. Run production smoke before enabling hosted media broadly.

## Acceptance Criteria

- Creating a media job dispatches a Trigger.dev task and returns immediately.
- The executor processes exactly the requested `jobId`.
- No supported production path depends on an always-on polling worker.
- No supported local path depends on an always-on polling worker.
- Trigger dispatch failures fail closed and release reserved credits.
- Fal waiting uses durable waits and does not rely on a hot loop.
- Outputs are copied into Woven R2 before clients receive download URLs.
- Reconciliation can recover stale jobs without double-submission or double-settlement.
- Local and production smoke tests exercise Trigger.dev, real Fal, and R2-backed signed downloads.
