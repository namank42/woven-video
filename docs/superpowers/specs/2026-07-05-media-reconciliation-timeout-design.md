# Media Reconciliation Timeout Design

**Date:** 2026-07-05
**Status:** Approved design - pending written-spec review
**Repo scope:** `woven-video` backend/API, Supabase media-job RPCs, Trigger.dev task definitions, reconciliation tests, and local cleanup docs. `woven-harness` remains a downstream consumer and is not implemented here.
**Docs digest:** `docs/superpowers/research/2026-07-05-media-reconciliation-trigger-docs.md`

---

## Purpose

Fix hosted-media reconciliation so expired media jobs become terminal in Supabase without producing
misleading Trigger.dev execution noise.

The observed local issue was that `process-media-job` Trigger runs appeared for stale
`frontier-video` jobs even though the user only ran image generation from Harness. The root cause was
not Harness. Local Supabase contained durable integration-test fixture media jobs. The scheduled media
reconciler rediscovered those expired rows and dispatched them to Trigger so the executor could fail
them later.

Expired jobs should be finalized at the reconciliation boundary. Trigger should only receive media
jobs that can still do useful provider work.

## Decisions Locked

- Keep Trigger.dev as the media executor.
- Keep Supabase as the source of truth for job state, timeout, billing reservations, and public job
  errors.
- Add direct backend timeout finalization for expired active media jobs.
- Reconciliation must finalize expired jobs first, then dispatch only non-expired stale jobs.
- Include `creating` jobs in timeout finalization. They are not claimable by the executor and can
  otherwise sit forever.
- Do not dispatch expired jobs to Trigger just to discover timeout.
- Add dispatch-source observability for `create`, `reconcile`, and `webhook`.
- Stop silently deriving unknown media operations as `video`.
- Fix local integration-test pollution so fixture rows do not remain eligible for local Trigger
  reconciliation.
- Existing polluted rows need local-only cleanup. No production backfill/cleanup is needed because
  this branch has not shipped.

## Non-Goals

- No `woven-harness` code changes in this repo.
- No change to provider adapters, provider pricing formulas, or model parameter schemas.
- No new executor platform.
- No production data cleanup or production one-off script.
- No attempt to make Harness responsible for backend job timeout truth.

## Target Architecture

```text
create job
  -> reserve credits
  -> dispatch process-media-job with source=create

process-media-job
  -> claim exact job id
  -> call provider / poll provider / settle outputs
  -> if claimed job is already expired, fail it as media_job_timed_out

reconcile-media-jobs schedule
  -> finalize expired active media jobs directly in DB
  -> find only non-expired stale runnable jobs
  -> dispatch those with source=reconcile

Fal webhook
  -> verify webhook
  -> mark provider callback received
  -> dispatch same job id with source=webhook
```

The changed boundary is reconciliation. Expired jobs become terminal in the database first, with
reservations released there. Trigger only receives jobs that still have a chance of doing useful
provider work.

For existing polluted local rows, use the same new expiry-finalization RPC as a local cleanup command.
This keeps cleanup aligned with production code instead of adding a one-off local mutation path.

## Database State Machine

Add this service-role RPC for timeout finalization:

```sql
finalize_expired_media_jobs_for_reconciliation(
  p_now timestamptz default now(),
  p_limit integer default 100
)
```

The RPC should find rows where:

- `type = 'media_job'`
- `status in ('creating', 'queued', 'running', 'waiting_provider')`
- `expires_at <= p_now`

Each matching job should become:

```text
status = failed
error = media_job_timed_out
final_cost_usd_micros = 0
completed_at = now
```

Reservation handling must reuse the existing billing-safe release path, not hand-update only the job
row. If `reserved_amount_usd_micros > 0`, the held credits must be released consistently. If no
reservation remains, the operation should still make the job terminal.

Update `find_media_jobs_for_trigger_reconciliation` so it does not return expired rows. It should
only return non-expired stale work, such as:

- queued jobs older than the stale threshold with `expires_at > p_now`
- running or waiting-provider jobs with expired claims or missed polling and `expires_at > p_now`

`creating` is included in timeout finalization but not in dispatch eligibility. A stuck `creating` job
means creation did not finish cleanly, so reconciliation may fail it after expiry but should not
dispatch it.

## Dispatch And Observability

Keep `dispatchMediaJob` as the only wrapper around Trigger.dev `tasks.trigger`, and add a required
dispatch source:

```ts
source: "create" | "reconcile" | "webhook"
```

Callers should pass:

- job creation route: `source: "create"`
- scheduled reconciliation task: `source: "reconcile"`
- Fal webhook route: `source: "webhook"`

Trigger.dev run tags should remain under the documented 10-tag limit. Use:

```text
media
media-job:<jobId>
media-kind:<kind>
media-queue:<queueName>
media-model:<modelId>
media-dispatch-source:<source>
media-user:<userId>
```

Drop the current `media-queue-limit:<n>` tag. It is less useful for filtering than job ID and dispatch
source.

After every successful Trigger dispatch, attempt to persist dispatch metadata onto the job:

```json
{
  "trigger": {
    "run_id": "...",
    "dispatch_source": "create|reconcile|webhook",
    "idempotency_key": "<jobId>",
    "dispatched_at": "..."
  }
}
```

This metadata write must not create a second hard failure mode after Trigger has accepted the run.
Job creation still fails closed if Trigger dispatch itself fails. If the post-dispatch metadata write
fails, log the failure and let future reconciliation recover from Supabase job state and Trigger's
idempotency key.

## Media Kind Derivation

Remove the silent fallback where unknown operations become `video`.

Use explicit derivation:

- Prefer catalog/model metadata where the model can be resolved.
- Otherwise use a closed operation mapping:
  - `image_generation` -> `image`
  - `text_to_speech`, `sound_effects`, `music_generation` -> `audio`
  - known video-generation operations -> `video`
- Unknown operations do not default to `video`.

For reconciliation, unknown or invalid kind rows should not be dispatched. The scheduled task should
log or report skipped rows with enough context to diagnose the bad job. If a bad row is expired, the
timeout finalizer runs first and prevents it from being skipped forever.

For the Fal webhook route, if a matching job cannot be mapped to a supported Trigger media kind, the
route should still record webhook progress metadata but should not dispatch a Trigger run. Reconciliation
can later dispatch the job if it becomes resolvable or time it out if it expires.

## Tests

Add or update SQL integration tests for:

- expired `creating`, `queued`, `running`, and `waiting_provider` media jobs become
  `failed / media_job_timed_out`
- reservations are released for expired reserved jobs
- expired jobs are not returned by `find_media_jobs_for_trigger_reconciliation`
- non-expired stale jobs are still returned
- unknown operations do not silently become `video`

Add or update Trigger/reconciliation tests for:

- scheduled reconciliation finalizes expired jobs before dispatching stale jobs
- scheduled reconciliation dispatches only non-expired stale jobs
- reconciliation dispatch uses `source: "reconcile"`
- Trigger tags include `media-job:<jobId>` and `media-dispatch-source:<source>`

Add or update route/webhook tests for:

- job creation dispatches with `source: "create"`
- Fal webhook dispatches with `source: "webhook"`
- unknown kind in webhook does not dispatch as video

Fix integration-test hygiene in `tests/media/db-rpcs.integration.test.ts`:

- track inserted user, job, and asset IDs
- clean them up in `afterEach` or `afterAll`
- delete fixture jobs explicitly or mark them terminal before test completion
- keep local dev Trigger from rediscovering test fixture rows after DB tests run

## Local Cleanup

After the migration is applied locally, run the new finalization RPC against local Supabase only.

Verification should confirm:

- no expired non-terminal media jobs remain locally
- stale `frontier-video` fixture rows are terminal
- reserved fixture rows have released reservations
- subsequent `media:dev:local` does not dispatch those stale rows to Trigger

No equivalent production cleanup is required for this branch.

## Acceptance Criteria

- Expired active media jobs are finalized as `failed / media_job_timed_out` without requiring a
  Trigger `process-media-job` run.
- Expired `creating` media jobs no longer sit forever.
- Reconciliation dispatches only non-expired stale jobs.
- Trigger runs carry job ID and dispatch-source tags.
- Unknown media operations are not silently labeled as video.
- `db-rpcs.integration.test.ts` no longer leaves durable media fixture jobs eligible for local
  reconciliation.
- Local cleanup removes the current stale fixture-job noise from the user's local Supabase.
