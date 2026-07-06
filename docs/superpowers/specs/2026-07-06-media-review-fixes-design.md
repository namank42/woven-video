# Media Review Fixes — Design

**Date:** 2026-07-06
**Branch:** `feat/credit-models`
**Status:** Approved
**Research digest:** `docs/superpowers/research/2026-07-05-media-review-fixes-docs.md`

## Context

A four-part pre-merge review of the hosted media jobs branch (base `6fd5a30`, head `32218f0`)
found 4 critical issues, ~9 important issues, and a set of minors. This design covers fixes for
**all** of them. Decisions locked with the owner:

- Settlement is **capped at the reserved quote**; Woven absorbs overages and logs them.
- Submit durability uses the **webhook self-heal** pattern (job hint in the webhook URL path).
- Output fetching uses a **provider domain allowlist** (no redirects), not generic IP blocking.
- Manual upload completion is **fail-closed outside production-excluded environments**.
- Full scope: criticals + importants + minors in one batch.

Facts below marked "(docs)" come from the research digest, not memory.

## Finding → fix map

| # | Severity | Finding | Fix section |
|---|----------|---------|-------------|
| 1 | Critical | Settlement uncapped vs reservation | §1a |
| 2 | Critical | GPT Image 2 quote ignores image size | §1b |
| 3 | Critical | Paid fal work lost if post-submit persist fails | §2a |
| 4 | Critical | SSRF via provider-returned output URLs | §3a |
| 5 | Important | Caption routes lack job-type fence | §3b |
| 6 | Important | Manual completion mode has no prod gate | §3c |
| 7 | Important | Reconciliation re-dispatches valid-lease jobs | §2d |
| 8 | Important | Expired uploaded inputs attachable | §3e |
| 9 | Important | fal terminal failures hang until timeout | §2c |
| 10 | Important | `provider_not_configured` leaves job claimed | §2c |
| 11 | Important | Internal secrets compared with `===` | §3d |
| 12 | Important | Music copy says 5 min, catalog allows 10 | §1c |
| 13 | Important | Trigger CLI pinned to `@latest` | §4a |
| 14 | Minor | Tracked `.superpowers/sdd` reports | §4b |
| 15 | Minor | Timed-out jobs show stale `claimed` progress | §4d |
| 16 | Minor | Loopback check misses private/IPv6 ranges | §3f |
| 17 | Minor | Stale bucket description in billing docs | §4c |

Trigger idempotency-key suppression (found during research: default key retention is 30 days
(docs), so the current fixed `idempotencyKey: jobId` suppresses legitimate re-dispatches) is
fixed in §2b.

## §1 Money & settlement

### §1a Settle cap

New migration replaces `record_and_settle_claimed_media_job`
(current definition: `supabase/migrations/20260701122000_claim_aware_media_job_finalization.sql`).

- After resolving `v_charged_amount_usd_micros`, compute
  `v_capped := least(p_final_cost_usd_micros, v_job.reserved_amount_usd_micros)`.
- Settle and charge at `v_capped`. When capping fires, record in the usage event metadata:
  `uncapped_cost_usd_micros` (the requested amount) and
  `overage_usd_micros` (requested − reserved). Raw provider cost is recorded as before.
- The `usage_event_charge_mismatch` guard compares the caller's
  `charged_amount_usd_micros` against the **capped** value.
- The executor logs a structured warning (job id, model, reserved, requested, overage)
  whenever the RPC reports a cap was applied (returned in the RPC result payload).

### §1b GPT Image 2 size-aware quoting

Real fal rates vary by quality × resolution, $0.005–$0.401 per image (docs). The seeded flat
rates (low $0.20 / medium $0.50 / high $1.00) can never undercharge but overprice 2.5–5× and
violate the runtime-catalog spec's size-class requirement.

New pricing formula type `gpt_image_sized` in `lib/media/pricing-quotes.ts`:

- Rate table = real fal rate × ~1.25 headroom, rounded up (per image):

  | Size tier (megapixels) | low | medium | high / auto quality |
  |---|---|---|---|
  | `standard` ≤ 2.1 MP | $0.01 | $0.07 | $0.27 |
  | `large` ≤ 3.7 MP | $0.01 | $0.07 | $0.28 |
  | `max` ≤ 8.3 MP | $0.02 | $0.13 | $0.51 |

- Tier resolution from the `image_size` parameter:
  - Named presets map to known dimensions (all fal presets are ≤ 1.05 MP → `standard`).
  - Custom `{width, height}` → megapixels → smallest tier whose ceiling covers it;
    above 8.3 MP → reject with `media_quote_unsupported_size`. Note the parameter schema
    caps each edge at 3840, so 3840×3840 (14.7 MP) is schema-valid but exceeds fal's priced
    4K tier — quote-time rejection is the enforcement for un-priced sizes.
  - `"auto"` → `large` tier (model chooses the size; quote conservatively).
- `num_images` multiplies as today; quality `auto` prices as `high`.
- Catalog seed migration updates `pricing_formula` for `openai/gpt-image-2` and
  `openai/gpt-image-2/edit`: `{"type": "gpt_image_sized", "size_parameter": "image_size",
  "quality_parameter": "quality", "image_parameter": "num_images",
  "provider_rate_usd_by_quality_and_size": {...}}`.
- `lib/pricing-page-rates.ts` and the pricing page display "from $0.01 per image" (the lowest
  tier/quality rate), consistent with the source-of-truth test
  (`tests/pricing-page-source.test.ts`).
- **Pre-implementation gate:** re-verify the fal pricing table with a real browser
  (browser-fetch of `fal.ai/models/openai/gpt-image-2`) before the seed rates land; adjust the
  table if it differs from the digest.

### §1c Music duration copy

ElevenLabs Music API allows `music_length_ms` 3,000–600,000 (10 min) (docs); the catalog max of
600,000 is correct. Update the Eleven Music v2 copy in `lib/pricing-page-rates.ts` from
"up to 5 minutes" to "up to 10 minutes". No catalog change.

## §2 Execution durability & failure handling

### §2a Webhook self-heal submit flow

fal docs do not guarantee query params inside the webhook URL survive the round-trip; the
webhook URL itself travels as an encoded `fal_webhook` query param (docs, verified in installed
client source). Therefore the job hint rides in the **path**.

- Schema: add `provider_attempt_nonce text` to `generation_jobs` (nullable; no index needed —
  lookups are by primary key with nonce equality check).
- Executor submit path (`lib/media/executor.ts`, `lib/media/providers/fal.ts`):
  1. Persist a crypto-random `provider_attempt_nonce` on the job, claim-fenced, **before**
     any provider call. Persist failure here aborts the attempt safely (nothing submitted).
  2. Submit with `webhookUrl = <falWebhookBaseUrl>/api/v1/media/webhooks/fal/<jobId>/<nonce>`.
  3. Persist `provider_job_id` with bounded retries (3 attempts, exponential backoff).
     Only a stale-claim error aborts retries (another actor owns the job).
  4. On final persist failure: do NOT throw the submission away and do NOT release the job as
     failed — return `waiting_provider`; the webhook self-heal or the reconciliation deadline
     resolves it.
- Route: `app/api/v1/media/webhooks/fal/route.ts` moves to
  `app/api/v1/media/webhooks/fal/[[...hint]]/route.ts` (optional catch-all keeps the bare URL
  working for in-flight jobs). After signature verification (unchanged), lookup order:
  1. By `provider_job_id = request_id` (existing behavior).
  2. On miss, if path hints are present: match `id = <jobId> AND provider_attempt_nonce =
     <nonce> AND provider_job_id IS NULL AND status IN ('running','waiting_provider')`;
     adopt the `request_id` into `provider_job_id`, then continue normal processing.
  The hint is a lookup key only — the fal signature remains the sole authenticator.
- Resubmit guard: the fal adapter only submits when the job has **no** `provider_attempt_nonce`
  for the current claim (nonce cleared on claim acquisition for queued jobs; a claimed job with
  nonce set and null `provider_job_id` waits instead of resubmitting). Worst case is exactly
  one paid submission per job; if no webhook ever lands, the reconciliation deadline fails the
  job and releases the reservation.

### §2b Trigger.dev per-wake idempotency keys

`lib/media/trigger-dispatch.ts` replaces the fixed `idempotencyKey: jobId`:

- `create:<jobId>` — job-creation dispatch.
- `webhook:<jobId>:<falRequestId>` — webhook wake (dedupes duplicate deliveries of the same
  callback, allows later distinct callbacks).
- `reconcile:<jobId>:<claimGeneration>` — reconciliation re-dispatch, where claimGeneration is
  the expired claim token being reconciled; for jobs that never held a claim, the finder's
  batch timestamp (returned by the finder RPC) is used instead.
- All dispatches set `idempotencyKeyTTL: "1h"` so no suppression outlives a job lifetime
  (default retention is 30 days (docs)).

### §2c fal failure detection

There is no FAILED/ERROR/CANCELLED **queue status**; the client enum is
`IN_QUEUE | IN_PROGRESS | COMPLETED`, and failures surface as webhook `status: "ERROR"` or as a
thrown `ApiError` when fetching the result (docs).

- Poll path (`lib/media/providers/fal.ts`): switch on known statuses — `IN_QUEUE`/`IN_PROGRESS`
  → `waiting_provider`; `COMPLETED` → `fal.queue.result(...)`, catching `ApiError` →
  `provider_failed` with sanitized diagnostics (HTTP status, error body summary, request id —
  no endpoint id); **unknown** status string → `provider_failed` with diagnostics (never wait
  indefinitely on an unrecognized state).
- Webhook route: `status: "ERROR"` payloads record the failure (error message + payload detail)
  on the job before dispatching the executor wake, so the executor fails fast without a wasted
  poll. `payload_error` with `status: "OK"` falls through to the normal poll path —
  `queue.result` still works in that case (docs).
- `provider_not_configured` thrown by an adapter (e.g. missing ElevenLabs key) is mapped by the
  executor to `releaseJob(..., "provider_not_configured")` instead of rethrowing with the claim
  held. The test currently pinning "without releasing the reservation"
  (`tests/media/executor.test.ts`) is inverted to pin the release.

### §2d Reconciliation lease fix

Migration replaces the expired-job finder (current definition:
`supabase/migrations/20260705120000_media_reconciliation_timeouts.sql`): for
`running`/`waiting_provider` rows, require `claim_expires_at IS NULL OR claim_expires_at <
p_now` before returning the row. Stale `last_provider_poll_at` alone no longer qualifies a job
for re-dispatch (it remains selectable for observability queries, not for dispatch).

## §3 Security hardening

### §3a Output-fetch SSRF allowlist

New strict fetch helper used by `lib/media/output-assets.ts` for provider-returned URLs:

- HTTPS only.
- Hostname must match the **adapter-declared allowlist**: each `MediaProviderAdapter` exposes
  `outputUrlAllowlist: string[]` — fal: `["fal.media", "*.fal.media"]`; ElevenLabs: `[]`
  (returns bytes, never URLs). Wildcards match one-or-more subdomain labels; no env override.
- `redirect: "error"` — any redirect fails the fetch.
- Abort-signal timeout and a streamed byte cap sized per output kind; exceeding either aborts
  and fails the output attempt with diagnostics.
- Response `Content-Type` must match the expected output kind prefix (`image/`, `video/`,
  `audio/`); mismatch fails the attempt.
- Inline `data:` outputs keep their existing size-checked materialization path (not fetched).

### §3b Caption route type fence

- `app/api/v1/reel-captions/jobs/[jobId]/route.ts`: add `.eq("type", REEL_CAPTION_JOB_TYPE)`
  and return a caption-specific response shape (no raw row passthrough).
- `app/api/v1/reel-captions/jobs/[jobId]/process/route.ts`: `loadJob` and the
  `claimQueuedJob` update both filter by `REEL_CAPTION_JOB_TYPE`.
- Regression tests: a hosted-media job id hitting either caption endpoint gets 404 and no
  state change.

### §3c Manual completion prod gate

`lib/media/env.ts`: parsing `MEDIA_UPLOAD_COMPLETION_MODE=manual` while
`VERCEL_ENV === "production"` (or `NODE_ENV === "production"` when VERCEL_ENV is unset) is a
hard configuration error — env parsing throws, requests fail loudly, nothing completes.
Callback mode remains the only production path; the local real-R2 smoke profile keeps manual
mode in dev. `.env.example` documents the constraint. No R2 HEAD verification from the Next
app (it holds no R2 credentials by design).

### §3d Timing-safe secret comparison

Shared helper (`lib/security/timing-safe-equal.ts`): SHA-256 both inputs, then
`crypto.timingSafeEqual` on the digests (hashing makes unequal lengths safe). Used by
`app/api/internal/media/cleanup/route.ts` and
`app/api/internal/media/uploads/complete/route.ts`. Tests include wrong-length secrets.

### §3e Expired-input rejection

`lib/media/jobs.ts` job creation: select `kind, upload_expires_at` alongside existing fields;
throw `upload_expired` when `upload_expires_at <= now`; require `kind = 'input'`. The attach
update predicate adds `kind = 'input'` and `upload_expires_at > now()` so the check holds
under concurrency (TOCTOU close). API surfaces `upload_expired` as a 400.

### §3f Private-range check completion

`isLoopbackMediaBaseUrl` in `lib/media/env.ts` becomes a private-address check covering:
loopback (127.0.0.0/8, `::1`, IPv4-mapped `::ffff:127.x`), unspecified (0.0.0.0, `::`),
link-local (169.254.0.0/16, `fe80::/10`), RFC1918, unique-local (`fc00::/7`), and the cloud
metadata IP (169.254.169.254). Literal hostname/IP checks only — inputs are operator-configured
base URLs; no DNS resolution.

## §4 Cleanups

- **§4a** Pin `@trigger.dev/sdk` and the `trigger.dev` CLI to the same exact version (4.5.0,
  carets dropped); `scripts/trigger-dev.mjs` invokes the local pinned binary, never `@latest`.
- **§4b** `git rm` `.superpowers/sdd/task-4-report.md` and `.superpowers/sdd/task-5-report.md`
  (path is gitignored; earlier commits removed identical artifacts).
- **§4c** Fix the stale private-bucket description in `docs/billing-architecture.md` (~line 64)
  to match the R2 `media.woven.video` model.
- **§4d** In the §2d migration, the reservation-release expiry branch merges the same failed
  progress metadata as the no-reservation branch, so timed-out jobs never publicly show
  `claimed`.

## Migrations

Three new idempotent migrations, consistent with branch style (`create or replace` / upsert):

1. `cap_media_settlement` — §1a function replacement.
2. `media_reconciliation_lease_fix` — §2d finder predicate + §4d progress merge +
   §2a `provider_attempt_nonce` column.
3. `reseed_gpt_image_sized_rates` — §1b catalog upsert.

## Error handling summary

- Cap fires → job settles, output delivered, overage logged; never a user-visible error.
- Submit persist fails → job waits; webhook self-heals or deadline refunds. Never two
  submissions, never a silent orphan.
- Output fetch violates allowlist/type/size → output attempt fails with diagnostics; existing
  claim-fenced failure paths handle retry/failure. Provider misbehavior cannot reach internal
  addresses.
- Misconfiguration (manual mode in prod, unknown fal status) fails loudly and closed.

## Testing

- **Unit:** quoter tiers (presets, custom dims, auto, >8.3 MP rejection, num_images); settle-cap
  warning plumbing; webhook self-heal lookup (hit, miss, wrong nonce, adopted request id);
  per-wake idempotency keys + TTL; fal status mapping (`IN_QUEUE`, `IN_PROGRESS`, `COMPLETED` +
  `ApiError`, unknown status); `provider_not_configured` release; SSRF helper allow/deny table
  (host, wildcard depth, redirect, content-type, byte cap, data: bypass untouched); caption
  fences; env prod gate; timing-safe compare (incl. wrong length); expired inputs; private
  ranges.
- **Integration (`RUN_SUPABASE_DB_TESTS=1`):** over-reserve settle charges exactly the reserved
  amount with a balanced ledger; expiry restores ledger balance (reserve → expire → balance
  equals pre-reservation); reconciliation finder skips valid-lease rows with stale poll
  timestamps.
- Full vitest suite green; fal pricing table re-verified in a real browser before seeding.

## Out of scope

- R2 object-existence attestation for manual completion (gate-only per decision).
- "Bring your own URL" job inputs and their SSRF treatment (feature does not exist).
- The stray untracked `pnpm-workspace.yaml` in the working tree (not part of this branch).
