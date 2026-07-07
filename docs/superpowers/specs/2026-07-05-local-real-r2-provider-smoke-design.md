# Local Real R2 Provider Smoke Design

**Date:** 2026-07-05
**Status:** Approved design - pending written-spec review
**Repo scope:** `woven-video` media upload/download configuration, Cloudflare media Worker deployment config, local media dev scripts/docs, and focused backend tests. `woven-harness` remains a downstream consumer, but may need to call a local-smoke upload completion contract returned by this backend.
**Docs digest:** `docs/superpowers/research/2026-07-05-local-real-r2-smoke-docs.md`

---

## Purpose

Make local hosted-media smoke tests use real Cloudflare R2 and real public Woven media URLs so cloud
providers such as Fal can fetch uploaded inputs.

The current local path signs uploaded input URLs with `MEDIA_BASE_URL=http://127.0.0.1:8787`. That is
fine for Worker route development, but it fails real provider jobs because Fal runs in the cloud and
cannot fetch a developer machine's localhost URL. Text-only jobs can still work because no provider
input URL needs to be downloaded.

The local smoke path should keep local Supabase, local Next, local Harness, and Trigger.dev dev, but
store actual media bytes in a dedicated dev R2 bucket behind a public dev media Worker domain.

## Decisions Locked

- Use real Cloudflare R2 for local provider smoke media bytes.
- Use a separate dev R2 bucket: `woven-media-dev`.
- Use a separate public dev Worker domain: `https://media-dev.woven.video`.
- Keep production storage isolated on `media.woven.video` and `woven-media`.
- Keep automated tests off real R2/Fal by default.
- Keep `media:edge:local` for Worker route development, not for real provider smoke tests involving
  uploaded inputs.
- Do not use a public tunnel as the normal local provider-smoke path.
- Do not reuse the production Worker/bucket for local smoke tests.
- Do not give Harness the Worker shared secret.

## Non-Goals

- No change to provider model schemas, pricing, or catalog rows.
- No change to Trigger.dev as the media executor.
- No production migration of existing media objects.
- No public R2 bucket access or raw R2 presigned URLs.
- No requirement that all local automated tests run against Cloudflare.
- No attempt to make production use client-owned upload completion.

## Target Architecture

```text
Local Harness
  -> local Woven Video API
  -> local Supabase
  -> Trigger.dev dev runner
  -> Fal
  -> https://media-dev.woven.video
  -> woven-media-dev R2 bucket
  -> local Woven Video API status reads
```

Production remains:

```text
Woven app / Harness
  -> production Woven Video API
  -> production Supabase
  -> Trigger.dev Cloud
  -> Fal
  -> https://media.woven.video
  -> woven-media R2 bucket
```

The same media Worker implementation can serve both environments. The environment decides which
domain, bucket, and upload-completion mode it uses.

## Components

### Dev Media Worker Deployment

Add a Cloudflare dev deployment target for the existing media Worker.

Expected resources:

- Worker deployment for the dev environment.
- Routes for:
  - `media-dev.woven.video/uploads/*`
  - `media-dev.woven.video/objects/*`
  - `media-dev.woven.video/internal/*`
- R2 binding `MEDIA_BUCKET` pointing at `woven-media-dev`.
- Worker secrets for the dev deployment:
  - `MEDIA_TOKEN_SECRET`
  - `MEDIA_WORKER_SHARED_SECRET`
- Worker vars:
  - `MEDIA_MAX_UPLOAD_BYTES`
  - `UPLOAD_COMPLETION_MODE=manual`
  - `WOVEN_API_BASE_URL` can be set but must not be used in manual completion mode.

The production Worker should remain configured with:

- `MEDIA_BUCKET=woven-media`
- `UPLOAD_COMPLETION_MODE=callback`
- `WOVEN_API_BASE_URL=https://www.woven.video`

### Local Provider-Smoke Profile

Add a local profile for real provider smoke testing. It should run local Next and Trigger.dev dev, but
should not start the local Cloudflare Worker.

The profile uses:

```text
MEDIA_BASE_URL=https://media-dev.woven.video
MEDIA_TOKEN_SECRET=<same secret as dev Worker>
MEDIA_WORKER_SHARED_SECRET=<same secret as dev Worker for local delete/internal calls>
SUPABASE_URL=http://127.0.0.1:54321
Trigger.dev dev
real Fal credentials
```

The normal local Worker script remains available for developing the Worker itself:

```text
MEDIA_BASE_URL=http://127.0.0.1:8787
pnpm run media:edge:local
```

That localhost profile is not the supported path for real Fal jobs that include uploaded inputs.

### Manual Upload Completion

Production upload completion stays Worker-owned. After a successful input upload, the production
Worker calls the deployed app's internal upload completion endpoint.

Local smoke cannot use that same callback without a tunnel, because Cloudflare cannot call a local
Next server on `localhost`. Instead, local smoke mode should expose an explicit local completion
contract after a successful PUT to the dev Worker.

When manual mode is active, the upload-URL response should include a local completion instruction,
such as an authenticated app endpoint and method, alongside the upload URL. Harness uploads the file
to the dev Worker first. Only after that PUT succeeds does Harness call the local completion endpoint
with the user's normal bearer token.

The completion contract should:

- be enabled only in the local/provider-smoke profile,
- require the user's normal bearer auth,
- verify the asset belongs to the authenticated user,
- verify the asset is still pending and matches the expected size/storage key already stored in local
  Supabase,
- mark the local `media_assets` row uploaded by reusing the existing upload-completion service code,
- avoid accepting arbitrary client-provided storage keys,
- return disabled/not-found outside local smoke mode.

Harness should never receive internal Worker secrets.

## Data Flow

### Local Input Upload

1. Harness asks local Woven Video for an input upload URL.
2. Local Woven Video creates a pending `media_assets` row in local Supabase.
3. Local Woven Video signs the upload URL using `MEDIA_BASE_URL=https://media-dev.woven.video`.
4. Harness uploads bytes to `https://media-dev.woven.video/uploads/<assetId>?token=...`.
5. The dev Worker verifies the upload token, content type, size, and expiry.
6. The dev Worker writes the object to `woven-media-dev`.
7. Harness calls the local-smoke completion endpoint returned by the backend after the PUT succeeds.
8. Local Supabase marks the input asset uploaded.

### Local Job Execution

1. Harness creates the media job against local Woven Video.
2. Local Woven Video validates that required input assets are uploaded.
3. Trigger.dev dev processes the job.
4. The executor signs provider input URLs as `https://media-dev.woven.video/objects/...`.
5. Fal fetches those URLs from Cloudflare, not localhost.
6. The executor downloads provider outputs and stores them through the existing R2/Worker output path.
7. Local Supabase receives terminal job state and output asset metadata.
8. Harness polls local Woven Video for status and download URLs.

### Production Flow

Production keeps the same upload/download shape but uses the production Worker callback:

1. Production API creates a pending asset and signs `https://media.woven.video/uploads/...`.
2. Production Worker writes to `woven-media`.
3. Production Worker calls the deployed production app's internal completion route.
4. Production job execution signs provider input URLs on `https://media.woven.video/objects/...`.

Manual completion must not be part of the production trust model.

## Error Handling

- If local provider-smoke mode is selected but `MEDIA_BASE_URL` is still localhost, uploaded-input
  jobs should fail early with a clear local configuration error instead of spending a Fal run.
- If the upload PUT fails, the local completion contract must not be called.
- If upload succeeds but completion fails, the asset remains pending and job creation should reject it
  as an unavailable/incomplete input.
- If the Worker receives an invalid token, wrong content type, wrong size, or expired URL, it should
  reject the request the same way production does.
- If manual completion leaves an orphaned object in `woven-media-dev`, the dev bucket lifecycle rule
  should delete old objects as a backup cleanup path.
- Public job status remains sanitized. Internal logs/metadata can include Worker/provider details
  needed to diagnose smoke failures.

## Testing

Automated tests should stay deterministic and should not hit Cloudflare or Fal by default.

Focused tests should cover:

- callback mode calls the internal completion endpoint after successful input upload,
- manual mode writes to R2 and returns success without calling the app callback,
- manual completion is disabled outside the local/provider-smoke profile,
- manual completion requires bearer auth and asset ownership,
- manual completion cannot accept arbitrary storage keys,
- job creation rejects pending uploaded-input assets,
- provider-smoke config validation rejects localhost `MEDIA_BASE_URL` for uploaded-input provider jobs.

Add an opt-in smoke path for real infrastructure. It should require explicit environment/profile
selection and should prove:

- upload URLs use `https://media-dev.woven.video`, not `127.0.0.1`,
- Fal can fetch uploaded inputs through the dev Worker,
- outputs are copied to `woven-media-dev`,
- local Supabase status reaches a terminal state,
- no local Cloudflare Worker process is required.

## Provisioning

Implementation should attempt provisioning through Wrangler/Cloudflare CLI when possible:

1. Verify the active Wrangler account.
2. Create `woven-media-dev` if it does not exist.
3. Configure lifecycle cleanup for `woven-media-dev`.
4. Add the dev Worker routes/custom domain for `media-dev.woven.video`.
5. Set dev Worker secrets.
6. Deploy the dev Worker environment.
7. Verify upload/download routes with signed test URLs.

If Wrangler lacks permissions or is logged into the wrong account, pause and ask for user action
instead of falling back to production storage.

## Acceptance Criteria

- Local Harness can run an uploaded-input provider job end to end with local Supabase and Trigger.dev
  dev.
- The provider sees Woven media input URLs on `https://media-dev.woven.video`.
- Local smoke media bytes are stored in `woven-media-dev`, not local storage and not the production
  bucket.
- Production upload completion remains Worker-owned callback mode.
- Harness never receives `MEDIA_WORKER_SHARED_SECRET`.
- Default automated tests do not depend on real Cloudflare or Fal.
- The local Worker remains available for Worker route development but is not required for provider
  smoke testing.
