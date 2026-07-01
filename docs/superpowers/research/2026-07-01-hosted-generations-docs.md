# Docs Digest - Hosted Generations - 2026-07-01

## Dependencies Checked

- Installed: `next@16.2.3`, `@supabase/supabase-js@2.105.1`.
- Not installed yet: Fal JS SDK, ElevenLabs JS SDK, AWS S3 SDK/R2 signing SDK, queue/worker package.
- Design implication: keep Next routes as control-plane endpoints and either add small provider/storage dependencies deliberately or call provider REST APIs with `fetch`.

## Next.js (local docs: `node_modules/next/dist/docs`) - v16.2.3 installed

- Route Handlers live in `app/**/route.ts` and expose Web `Request`/`Response` APIs. Supported methods include `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`.
- Dynamic route params are promises in this Next version: route contexts use `{ params: Promise<{ ... }> }`, or generated `RouteContext<'/path/[id]'>`.
- Route Handlers are public HTTP endpoints. They are appropriate for auth, validation, enqueueing, status reads, webhook callbacks, and signed URL creation.
- `export const runtime = "nodejs"` selects the Node runtime. Node runtime is the default and is the right choice for server SDKs and signing work.
- `export const maxDuration = <seconds>` can declare server-side execution limits for deployment platforms, but long-running provider work should not depend on a route staying alive.
- Next.js docs describe Next as a Backend-for-Frontend API layer, not a full worker system. Hosted generation execution should run outside request/response routes.
- Source: local Next docs:
  - `01-app/01-getting-started/15-route-handlers.md`
  - `01-app/02-guides/backend-for-frontend.md`
  - `01-app/03-api-reference/03-file-conventions/route.md`
  - `01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md`
  - `01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`
  - `01-app/02-guides/deploying-to-platforms.md`

## Cloudflare R2 (context7: `/websites/developers_cloudflare_r2`)

- R2 supports S3-compatible access at `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` with `region: "auto"`.
- Presigned GET/PUT URLs can be generated with AWS SDK v3:
  - `getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn })`
  - `getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType }), { expiresIn })`
- For presigned PUT, the uploading client must send the same `Content-Type` header used when signing.
- Presigned URLs work against the S3 API domain and cannot be used with custom domains. Custom-domain authenticated access requires Cloudflare WAF HMAC validation on paid plans.
- Cloudflare explicitly says presigned URLs are bearer tokens: anyone with the URL can perform the specified operation until it expires. This makes raw R2 presigned URLs a poor fit for agent-visible transcripts even though the account ID itself is not a secret.
- R2 can be bound directly to a Cloudflare Worker. The Worker API supports `env.MY_BUCKET.put(key, request.body)` for streaming a request body into R2 under a Woven-owned route/domain.
- R2 pricing says there are no egress bandwidth charges for data egressing directly from R2, including via the Workers API, S3 API, and `r2.dev`; R2 still charges storage and Class A/B operations.
- Cloudflare Workers request body limits are plan-dependent: Free/Pro 100 MB, Business 200 MB, Enterprise 500 MB by default. This matters for direct upload-through-Worker design; large video inputs may need R2 multipart/direct S3 or an Enterprise limit.
- R2 also supports lifecycle rules to delete old objects. Use this for 30-day final artifact retention and shorter fallback cleanup for temp inputs.
- Design implication: for agent-facing uploads, prefer a Woven-domain Worker upload endpoint over returning raw R2 presigned URLs, unless uploads exceed Worker body limits. Use UUID/asset-scoped temp keys, job-scoped output keys, and deletion for V1 privacy expectations.
- Source: Context7 Cloudflare R2 docs, especially:
  - `r2/api/s3/presigned-urls/index.md`
  - `r2/examples/aws/aws-sdk-js-v3`
  - `r2/get-started/workers-api/index.md`
- Source: official Cloudflare docs opened 2026-07-01:
  - `https://developers.cloudflare.com/r2/api/s3/presigned-urls/`
  - `https://developers.cloudflare.com/r2/api/workers/workers-api-reference/`
  - `https://developers.cloudflare.com/r2/pricing/`
  - `https://developers.cloudflare.com/workers/platform/limits/`

## Fal (context7: `/websites/fal_ai`)

- Fal supports async queue submission from JavaScript:
  - `fal.queue.submit(endpointId, { input, webhookUrl? })` returns `{ request_id }`.
  - `fal.queue.status(endpointId, { requestId, logs: true })` reads queue/job status and logs.
  - `fal.queue.result(endpointId, { requestId })` reads the completed result.
- Fal queue submissions can include `webhookUrl` for asynchronous completion callbacks.
- Fal model docs show queue endpoints by model ID, e.g. `fal-ai/flux-1/schnell/redux`, with `input` shape varying by model. This supports a curated allowlist where each Woven pricing row stores the provider endpoint and schema metadata.
- Fal has an upload-file API/CDN flow, but Woven-hosted V1 can instead use short-lived Woven media URLs for model inputs and copy provider output back to R2.
- Design implication: submit Fal jobs from the worker, store `request_id` in `generation_jobs.provider_job_id`, accept webhook callbacks when configured, and keep polling fallback for missed callbacks.
- Source: Context7 Fal docs:
  - `documentation/development/calling-your-endpoints`
  - model API reference snippets for queued model submission
  - MCP upload-file docs for Fal CDN behavior

## ElevenLabs (context7: `/websites/elevenlabs_io`)

- Text-to-speech can be generated with the JS SDK:
  - `new ElevenLabsClient({ apiKey })`
  - `client.textToSpeech.convert(voiceId, { modelId, text, outputFormat, voiceSettings })`
  - response is stream-like audio bytes that can be piped/written.
- Text-to-speech with timestamps is available at:
  - `POST /v1/text-to-speech/{voice_id}/stream/with-timestamps?output_format=...`
  - body includes `text` and `model_id`; response streams audio with timestamp information.
- Speech-to-text Scribe endpoint:
  - `POST /v1/speech-to-text`
  - accepts `model_id`, `file`, `cloud_storage_url`, `source_url`, `timestamps_granularity`, `diarize`, `webhook`, `webhook_id`, `webhook_metadata`, and related transcription options.
- ElevenLabs docs confirm `cloud_storage_url` for Scribe, which lets Woven pass an R2 URL without proxying large audio through Next routes.
- Current public pricing is credit-based across products. The pricing page lists Speech to Text at about `330 credits per minute`, Eleven Music at `900 credits per minute`, Sound Effects at `200 credits per generation`, and Voice Changer/Voice Isolator at `1,000 credits per minute`. Exact USD cost depends on ElevenLabs plan/top-up economics, so Woven pricing rows should keep provider cost basis in configurable metadata rather than hardcoding one global ElevenLabs USD rate.
- Design implication: treat ElevenLabs audio generations as worker jobs that stream provider output into R2; treat Scribe/captions as the same R2-input pattern instead of Supabase Storage.
- Source: Context7 ElevenLabs docs:
  - text-to-speech streaming guide
  - text-to-speech stream-with-timestamps API reference
  - speech-to-text convert API reference
- Source: official pricing page opened 2026-07-01: `https://elevenlabs.io/pricing`

## Design Constraints From Docs

- Next route handlers should create jobs, reserve credits, issue Woven-domain media upload URLs, return model catalogs/status, and receive provider/webhook callbacks.
- Long provider execution belongs in a worker/queue process because route handlers have deployment-defined execution limits and clients may disconnect.
- R2 can be the only blob store, but standard presigned URLs are for the S3 API endpoint, not `media.woven.video`.
- Fal has native async queue semantics; Woven should store Fal request IDs and use webhook plus polling fallback.
- ElevenLabs audio output may be streamed synchronously by the provider API, so the worker must be able to stream/download bytes and write them to R2 before settlement.
