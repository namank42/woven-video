# Docs Digest — media review fixes — 2026-07-05

Gathered for the review-fix design on `feat/credit-models` (settle cap, GPT Image size pricing,
fal submit durability, SSRF allowlist, fal failure handling, Trigger idempotency, music duration).

## @fal-ai/client (context7: /fal-ai/fal-js + /websites/fal_ai) — v1.10.1 (installed)

### Webhook mechanics
- `fal.queue.submit(endpointId, { input, webhookUrl })` sends the webhook URL as an
  URL-encoded `fal_webhook` query param on the submit URL
  (verified in installed source `node_modules/@fal-ai/client/src/queue.js:60` —
  `query: webhookUrl ? { fal_webhook: webhookUrl } : undefined`).
- Docs do NOT explicitly guarantee that query params inside the webhook URL survive the
  round-trip. **Design consequence: carry job hints in the webhook URL path**
  (e.g. `/api/v1/media/webhooks/fal/<jobId>/<nonce>`), not in query params.
- Webhook POST payload fields: `request_id`, `gateway_request_id`, `status` (`"OK"` | `"ERROR"`),
  `payload` (model output on success / error detail on failure), `error` (message, ERROR only),
  `payload_error` (set when the payload was not JSON-serializable even though status is OK).
- Source: context7 /websites/fal_ai (fal.ai/docs/documentation/model-apis/inference/webhooks).

### Queue status & failure semantics
- `QueueStatus` union in the installed client is ONLY: `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`
  (types/common: InQueueQueueStatus | InProgressQueueStatus | CompletedQueueStatus).
  There is **no FAILED/ERROR/CANCELLED queue status** — a failed request still reaches
  `COMPLETED`; the failure surfaces when fetching the result.
- `fal.queue.result(endpointId, { requestId })` throws `ApiError` (subclass `ValidationError`)
  on failed requests — properties: `body`, `requestId`, `status` (HTTP code), `timeoutType?`.
  Status responses can also carry `error` / `error_type` fields.
- **Design consequence:** failure detection = (a) webhook `status: "ERROR"`, (b) `ApiError`
  thrown from `queue.result` after COMPLETED, (c) deadline backstop. Do NOT string-match
  FAILED/CANCELLED in poll status; instead treat unknown status strings as diagnostic failures.
- Cancel: `fal.queue.cancel(endpointId, { requestId })` → `PUT /requests/<id>/cancel`;
  REST returns `202 {"status": "CANCELLATION_REQUESTED"}`; the request may still complete
  if already mid-processing. IN_QUEUE cancels are immediate.
- Source: context7 /fal-ai/fal-js reference + installed `queue.js`.

## fal GPT Image 2 pricing (WebFetch https://fal.ai/models/openai/gpt-image-2)

- Pricing varies by **quality AND resolution**. Per-image rates:

  | Size        | low    | medium | high   |
  |-------------|--------|--------|--------|
  | 1024×768    | $0.005 | $0.037 | $0.145 |
  | 1024×1024   | $0.006 | $0.053 | $0.211 |
  | 1024×1536   | $0.005 | $0.042 | $0.165 |
  | 1920×1080   | $0.005 | $0.040 | $0.158 |
  | 2560×1440   | $0.007 | $0.056 | $0.222 |
  | 3840×2160   | $0.012 | $0.101 | $0.401 |

- Custom dimensions allowed up to 4K if edges are multiples of 16.
- Current seeded catalog rates (low $0.20 / medium $0.50 / high $1.00) are 2.5–5×
  the real worst case — today Woven can never undercharge on this model, only overcharge.
- Source: WebFetch of the fal model page (context7 had only gpt-image-1.5).

## Trigger.dev SDK (context7: /websites/trigger_dev) — v4.5.0 (installed)

- `tasks.trigger(id, payload, { idempotencyKey, idempotencyKeyTTL })`: re-triggering with the
  same key returns the EXISTING run instead of creating a new one.
- **Default key retention is 30 days** unless `idempotencyKeyTTL` is set (units: s/m/h/d).
  So a fixed `idempotencyKey: jobId` suppresses ALL re-dispatches of that job for 30 days —
  including legitimate reconciliation re-dispatches after a crash.
- Keys created with `idempotencyKeys.create` inside a task run are scoped to that run by
  default (`scope` option controls this); raw strings passed from outside a run are global.
- **Design consequence:** discriminate keys per logical wake
  (`create:<jobId>`, `webhook:<jobId>:<requestId>`, `reconcile:<jobId>:<bucket>`) and/or set a
  short `idempotencyKeyTTL` so suppression cannot outlive a job's deadline.
- Source: context7 /websites/trigger_dev (trigger.dev/docs/idempotency).

## ElevenLabs Music API (context7: /websites/elevenlabs_io) — raw REST (no SDK installed)

- `POST /v1/music` (also /stream, /detailed): `music_length_ms` allowed range is
  **3000–600000 ms (3 s – 10 min)**; only usable with `prompt` (not `composition_plan`).
- Composition plans: sections are 3000–120000 ms each, max 30 chunks (music_v2 enforces
  section durations strictly).
- The consumer product FAQ says "max 5 minutes" but that describes the Eleven Creative UI,
  not the API. The API limit is 600000 ms.
- **Design consequence:** catalog max of 600000 ms is correct; the public pricing-page copy
  ("up to 5 minutes") is stale and should say 10 minutes.
- Source: context7 /websites/elevenlabs_io (api-reference/music).
