# Hosted Media Jobs Design

**Date:** 2026-07-01
**Status:** Approved design - pending written-spec review
**Repo scope:** `woven-video` backend/API, Supabase schema/RPCs, and Woven media Worker contract. `woven-harness` is a downstream consumer and is not implemented here.
**Docs digest:** `docs/superpowers/research/2026-07-01-hosted-generations-docs.md`

---

## Purpose

Add Woven-credit hosted media job support for curated image, video, and ElevenLabs audio models so users can run selected frontier media models without connecting their own provider keys.

The backend should expose a stable media job contract that `woven-harness` can consume later:

- discover Woven-credit media models,
- upload binary inputs when required,
- create jobs with credits reserved up front,
- poll job status,
- download final outputs from Woven media URLs.

This is not a generic proxy for arbitrary provider models. Woven will curate and register every enabled model before it appears in the catalog.

## Decisions Locked

- Use a worker queue style architecture. Next API routes are control-plane endpoints; long provider execution runs in a separate worker.
- API domain is `media`, with public endpoints:
  - `GET /api/v1/media/models`
  - `POST /api/v1/media/uploads`
  - `POST /api/v1/media/jobs`
  - `GET /api/v1/media/jobs/:jobId`
- Use `jobs`, not `generations`, `gens`, or `queue`, in the public contract.
- Keep Supabase for auth, rows, job state, billing, and RPCs.
- Store all media bytes in Cloudflare R2. Do not store media in Supabase Storage.
- Put private R2 behind `media.woven.video` so agents and harness see Woven URLs, not raw R2 S3 endpoints.
- Use Woven credits by default for media job access, with per-job override available later when BYOK exists for the same capability.
- Charge provider cost plus `20%` markup for hosted media models unless a model-specific pricing row says otherwise.
- Update auto-caption pricing to `$0.10/min` with a `$0.10` minimum.
- Reserve credits before any provider call.
- Use curated model registry entries. Each enabled model must define validation, provider mapping, output extraction, and pricing behavior.

## Architecture

The design has four pieces:

1. **Next API routes** authenticate users, validate requests, create upload slots, create jobs, reserve credits, return status, and receive provider callbacks.
2. **Supabase Postgres** stores billing accounts, pricing rows, media asset metadata, jobs, usage events, and ledger entries.
3. **Cloudflare R2 + `media.woven.video` Worker** stores and serves media bytes. The Worker validates short-lived Woven upload/download tokens and streams bytes into or out of R2.
4. **Media worker process** claims queued jobs, calls Fal or ElevenLabs with server-owned provider keys, copies outputs to R2, settles billing, and cleans up temp inputs.

Next.js route handlers remain short-lived request/response code. The docs digest confirms that long-running provider execution should not depend on a route staying alive, and that Node runtime route handlers are appropriate for auth, validation, status reads, webhook callbacks, and token creation.

## Storage Design

Supabase stores metadata only. R2 stores all binary media:

- uploaded image/video/audio inputs,
- provider outputs,
- transient files used by captions or provider adapters.

`media.woven.video` is the only public media face. Standard R2 presigned URLs should not be returned in normal harness responses because Cloudflare's R2 docs say they use the S3 API account endpoint, do not support custom domains, and are bearer tokens. The account ID is not a secret, but the signed URL is a temporary capability and would be visible to agents.

### Upload Flow

1. Harness requests an upload slot:

```http
POST /api/v1/media/uploads
```

```json
{
  "filename": "input.mov",
  "content_type": "video/quicktime",
  "size_bytes": 48219322,
  "purpose": "media_input"
}
```

2. Backend creates a pending media asset row and returns a short-lived Woven upload URL:

```json
{
  "upload_id": "upl_123",
  "asset_id": "asset_123",
  "method": "PUT",
  "upload_url": "https://media.woven.video/uploads/upl_123?token=...",
  "expires_at": "2026-07-01T12:15:00Z"
}
```

3. Harness uploads the file bytes with `PUT`.
4. The Cloudflare Worker validates the token, method, expiry, content type, content length, and size cap.
5. The Worker streams `request.body` into R2 and marks the asset uploaded.

The upload-through-Worker path does not double-store media and should not add R2 egress bandwidth charges. It adds a Worker request and normal R2 write operation. V1 should set an upload cap based on the active Cloudflare plan's Worker request body limit.

### Object Keys

Inputs are created before a job exists, so temp input keys are asset scoped:

```txt
users/{user_id}/media/tmp/{asset_id}/{safe_filename}
```

Outputs are job scoped:

```txt
users/{user_id}/media/outputs/{job_id}/{output_id}.{ext}
```

Storage keys stay internal. API responses expose IDs and short-lived `media.woven.video` URLs only.

### Retention

- Temp inputs are deleted after the job reaches a terminal state.
- Cleanup should also run as a retry/sweeper so temp inputs do not survive if a worker crashes.
- Final outputs are kept in R2 for 30 days, then deleted by lifecycle/sweeper policy.
- Harness should import outputs into the local project; R2 is a transfer/cache layer, not the long-term user project source of truth.

## Model Catalog And Registry

`GET /api/v1/media/models` returns only curated Woven-credit models. It does not expose arbitrary Fal or ElevenLabs endpoints.

The public catalog should expose a generic meta-contract:

```json
{
  "models": [
    {
      "id": "fal:frontier-video-1",
      "provider": "fal",
      "kind": "video",
      "display_name": "Frontier Video 1",
      "enabled": true,
      "supports_uploaded_inputs": true,
      "supported_input_types": ["image"],
      "output_types": ["video"],
      "estimated_price": {
        "unit": "job",
        "minimum_usd": "0.50",
        "markup_bps": 2000
      },
      "default_parameters": {},
      "parameter_schema": {}
    }
  ]
}
```

The backend registry owns provider-specific details. Each enabled model must define:

- public Woven model ID,
- provider and provider endpoint or operation,
- operation kind, such as `image_generation`, `video_generation`, `text_to_speech`, `sound_effects`, `music_generation`, or `reel_captions`,
- accepted uploaded input slots, media types, counts, and size limits,
- parameter schema for request validation and harness UI,
- pricing/reservation rule,
- provider input mapper,
- provider output extractor and output type expectations.

Harness should not depend on Fal queue IDs, ElevenLabs request IDs, R2 keys, or provider-specific billing fields. For Fal, many curated models can use mostly pass-through `input` objects, but every model still needs schema validation and output extraction. For ElevenLabs, use explicit operation adapters rather than generic pass-through.

## Job API

Text-only jobs such as text-to-image, text-to-video, TTS, music, and sound effects can skip `/media/uploads` and create a job directly. Jobs with binary inputs use uploaded `asset_id` values.

```http
POST /api/v1/media/jobs
```

```json
{
  "model": "fal:frontier-video-1",
  "input_asset_ids": ["asset_123"],
  "parameters": {
    "prompt": "..."
  }
}
```

Create-job route behavior:

1. Authenticate the bearer token.
2. Validate the model is curated and enabled.
3. Validate parameters against the model registry schema.
4. Validate uploaded inputs belong to the user, are complete, unexpired, and match the model's accepted input slots.
5. Estimate the maximum reservation amount from `model_pricing_rules` and registry metadata.
6. Insert a `generation_jobs` row with a media job type and status `queued`.
7. Call the existing reservation RPC before any provider work can happen.
8. Return the job immediately.

Create response:

```json
{
  "id": "job_123",
  "status": "queued",
  "model": "fal:frontier-video-1",
  "estimated_cost_usd": "0.42",
  "reserved_credits_usd": "0.50",
  "created_at": "2026-07-01T12:00:00Z",
  "expires_at": null
}
```

Status response while running:

```json
{
  "id": "job_123",
  "status": "waiting_provider",
  "progress": {
    "stage": "provider_wait",
    "percent": null,
    "message": "Waiting on provider"
  },
  "estimated_cost_usd": "0.42",
  "reserved_credits_usd": "0.50",
  "final_cost_usd": null,
  "outputs": []
}
```

Success response:

```json
{
  "id": "job_123",
  "status": "succeeded",
  "estimated_cost_usd": "0.42",
  "reserved_credits_usd": "0.50",
  "final_cost_usd": "0.39",
  "outputs": [
    {
      "id": "out_123",
      "type": "video",
      "content_type": "video/mp4",
      "url": "https://media.woven.video/outputs/out_123?token=...",
      "expires_at": "2026-07-01T12:30:00Z"
    }
  ]
}
```

Failure response:

```json
{
  "id": "job_123",
  "status": "failed",
  "reserved_credits_usd": "0.50",
  "final_cost_usd": "0.00",
  "error": {
    "code": "provider_failed",
    "message": "Generation failed"
  }
}
```

## Worker Lifecycle

The worker claims queued/runnable jobs atomically and owns provider execution:

```txt
queued
  -> claimed
  -> running
  -> waiting_provider
  -> downloading_outputs
  -> succeeded
```

Failure path:

```txt
queued/running/waiting_provider
  -> failed
  -> release reservation or settle partial provider cost if billed
  -> delete temp inputs
  -> store provider error summary
```

Cancellation in V1:

- queued jobs are cancellable and release the reservation,
- running jobs are best-effort cancellable if the provider supports cancellation,
- succeeded jobs are not cancellable.

### Fal

Fal jobs use Fal's queue API from the backend worker:

1. Worker maps Woven job parameters/assets into the curated Fal model input.
2. Worker calls Fal queue submit with optional webhook URL.
3. Worker stores Fal `request_id` as internal provider metadata.
4. Webhooks update provider state when delivered.
5. Polling fallback reads status/result so missed webhooks do not strand jobs.
6. Worker copies provider output media into R2 outputs.

### ElevenLabs

ElevenLabs jobs use explicit operation adapters:

- text-to-speech,
- text-to-speech with timestamps when needed,
- sound effects,
- music,
- speech-to-text / captions.

The worker streams or downloads ElevenLabs output bytes and writes them to R2. For Scribe/captions, use R2-backed input URLs rather than Supabase Storage. If an ElevenLabs endpoint supports webhooks, the webhook can accelerate completion, but the worker should still have a fallback path.

## Billing

Use the existing billing primitives:

- `billing_accounts` for prepaid USD balances,
- `model_pricing_rules` for curated pricing,
- `generation_jobs` for job state and reservation source IDs,
- `ledger_entries` for balance changes,
- `usage_events` for provider cost and Woven charge audit.

Billing invariants:

- No provider call happens unless credits are reserved first.
- Failed before provider billing means the reservation is released.
- Failed after provider billing may settle actual provider cost if it can be proven; otherwise release.
- Success settles actual cost and releases unused reservation.
- Usage event and ledger settlement must succeed together or be retried idempotently.

Default hosted media markup is `markup_bps = 2000` (`20%`). Exact provider cost basis lives in pricing rule metadata because ElevenLabs public pricing is credit-based and exact USD economics depend on Woven's plan/top-up economics.

Auto-caption pricing should be updated from the existing low price to:

```txt
charge_usd_micros = max(100_000, ceil(duration_seconds * 100_000 / 60))
```

That is `$0.10/min` with a `$0.10` minimum.

Insufficient balance at job creation returns `402` with `insufficient_balance`.

## Errors

Core public error codes:

```txt
insufficient_balance
model_not_enabled
invalid_media_input
upload_not_complete
upload_expired
upload_too_large
provider_not_configured
provider_failed
job_not_found
job_not_ready
rate_limited
```

Provider-specific details should be reduced to safe summaries in public responses. Full provider payloads and request IDs can be stored internally for support/debugging.

## Data Model Expectations

Implementation should extend the existing billing/job model rather than introduce a parallel accounting system.

Expected additions or extensions:

- `media_assets` table for upload/output metadata, ownership, content type, size, status, storage key, expiry, and lifecycle timestamps.
- `generation_jobs` extensions for media job types, provider request IDs, progress, reservation amount, final cost, and normalized output refs if missing.
- `model_pricing_rules` seed rows for curated Fal, ElevenLabs, and updated auto-caption operations.
- Service-role RPC or SQL function for atomic worker job claiming.
- Idempotent webhook/update helpers keyed by job ID and provider request ID.

RLS should allow users to read their own jobs/assets and should prevent direct writes to billing or terminal job state. Service role performs worker mutations.

## Harness Contract

Harness should follow these rules:

- Use `/api/v1/media/models` to discover Woven-credit media capabilities.
- Use `/api/v1/media/uploads` only when the selected model requires binary input.
- Create jobs with `/api/v1/media/jobs`.
- Poll `/api/v1/media/jobs/:jobId`.
- Download outputs from short-lived Woven media URLs.
- Treat Woven-credit media job access separately from chat model access.
- Do not persist provider request IDs, R2 keys, or raw storage URLs as public project data.

The backend can later add per-job source selection, such as Woven credits vs BYOK, without changing the core job shape.

## Rollout And Testing

Seed curated model rows disabled by default, then enable specific frontier models one by one after manual verification.

Required tests:

- pricing tests for `20%` markup and fixed/unit pricing,
- auto-caption pricing test for `$0.10/min` with `$0.10` minimum,
- reservation, settlement, release, and insufficient-balance tests,
- upload validation tests for auth, content type, size, expiry, and ownership,
- route tests for catalog, upload creation, job creation, status reads, and `402`,
- worker tests with fake Fal, fake ElevenLabs, and fake R2,
- atomic claim/idempotency tests so duplicate workers cannot run the same job twice,
- cleanup tests for temp input deletion after terminal states.

Manual E2E checks:

- one curated Fal image job,
- one curated Fal video job,
- one ElevenLabs audio job,
- one auto-caption flow using R2-backed input and updated pricing.

## Out Of Scope

- Implementing `woven-harness` UI or sidecar changes in this repo.
- Supporting arbitrary user-provided Fal model IDs.
- Long-term permanent cloud storage for user projects.
- Large-file upload paths above the Cloudflare Worker request body limit.
- Replacing the existing chat model API.

## Implementation Input

No product decisions remain open for the backend design. The implementation plan still needs exact environment names and deployment details for the `media.woven.video` Worker, the active Cloudflare Worker request body limit, and the first curated model IDs/pricing rows to seed.
