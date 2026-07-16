# Kimi K3 Hosted Cutover Design

**Date:** 2026-07-17
**Status:** Approved design — pending written-spec review
**Backend scope:** `woven-video` hosted catalog, billing metadata, public pricing and SEO copy,
migration tests, and production cutover verification.
**Consumer scope:** Coordinated `woven-harness` hosted-catalog fixtures and Kimi capability fallback;
Kimi remains unavailable in BYOK mode.

---

## Purpose

Replace Kimi K2.6 with Kimi K3 in Woven Credits and make K3 the sole backend-owned hosted default.
Existing saved K2.6 selections must migrate through the live catalog's successor metadata. Historical
K2.6 billing records remain intact, while new direct K2.6 requests stop executing.

This is an immediate atomic cutover, not a staged overlap. It does not add Moonshot credentials,
Moonshot BYOK routing, a runtime model alias, or a hardcoded K3 hosted catalog entry in Harness.

## Verified Provider Contract

The provider facts used by this design are recorded in
`docs/superpowers/research/2026-07-17-kimi-k3-hosted-cutover-docs.md`.

- The exact Vercel AI Gateway ID is `moonshotai/kimi-k3`.
- K3 has a 1,000,000-token context window and a 131,072-token maximum output.
- The live endpoint advertises text, image, and file input with text output.
- The live endpoint advertises reasoning, tool use, vision, file input, and implicit caching.
- Thinking mode is always on. The provider does not expose a reviewed selectable effort contract for
  this rollout.
- Base Gateway rates are `$3.00/M` input, `$15.00/M` output, and `$0.30/M` cached input read. There is
  no cache-write rate.
- Vercel's launch post mentions video input, but the live executable endpoint does not advertise
  video in its input modalities. This cutover treats the live endpoint as runtime truth and does not
  publish a video-support claim.

## Decisions

- Use one immutable, idempotent database migration for the K3 enable/default and K2.6 retirement.
- Enable K3 and disable K2.6 atomically; never expose both in the steady-state hosted catalog.
- Make K3 the sole `is_default: true` hosted model.
- Declare K3 as the sole successor to `moonshotai/kimi-k2.6`.
- Keep selection and replacement policy backend-owned and delivered by `GET /api/v1/models`.
- Do not add a request-time alias. A direct request for K2.6 returns `404 model_not_found`.
- Keep K2.6's disabled pricing row for billing, ledger, usage, and audit history.
- Publish K3 as reasoning-capable without an effort picker or request override.
- Continue settling usage from Gateway-reported actual cost plus Woven's existing 20% markup.
- Update the public pricing table and public model claims in the same release.
- Keep Kimi hosted-only. Raw Kimi IDs remain rejected in Harness BYOK mode.
- Do not require a new Harness release before the backend cutover; the shipped live-catalog successor
  resolver already handles the new backend metadata generically.

## Final Enabled Hosted Catalog Policy

After the migration, the enabled hosted chat catalog contains exactly these five models:

| Model | `is_default` | `replaces_model_ids` |
| --- | --- | --- |
| `openai/gpt-5.6-sol` | `false` | `["openai/gpt-5.5"]` |
| `openai/gpt-5.6-terra` | `false` | `[]` |
| `anthropic/claude-sonnet-5` | `false` | `["anthropic/claude-sonnet-4.6"]` |
| `anthropic/claude-opus-4.8` | `false` | `["anthropic/claude-opus-4.7"]` |
| `moonshotai/kimi-k3` | `true` | `["moonshotai/kimi-k2.6"]` |

K2.6 is absent from the enabled catalog. Its ID is canonical, unprefixed, and claimed by only K3, so
the existing catalog validator continues to enforce the contract without runtime validator changes.

## Database Migration

Add one migration after `20260714120000_rollout_claude_sonnet_5.sql`.

### K3 upsert

Upsert one hosted chat pricing row with:

| Field | Value |
| --- | --- |
| `provider` | `vercel-ai-gateway` |
| `model` | `moonshotai/kimi-k3` |
| `operation` | `chat` |
| `display_name` | `Kimi K3` |
| `markup_bps` | `2000` |
| `minimum_charge_usd_micros` | `1` |
| `reserve_amount_usd_micros` | `50000` |
| `enabled` | `true` |

The row's metadata contains:

```json
{
  "provider_model_id": "moonshotai/kimi-k3",
  "supports_reasoning": true,
  "supported_reasoning_efforts": [],
  "default_reasoning_effort": null,
  "is_default": true,
  "replaces_model_ids": ["moonshotai/kimi-k2.6"]
}
```

On conflict, update the reviewed pricing fields, enable the row, and merge these reviewed keys into
existing metadata rather than replacing unrelated metadata.

### K2.6 retirement

In the same migration, update the hosted K2.6 chat row to:

- `enabled = false`;
- `metadata.is_default = false`; and
- `metadata.replaces_model_ids = []`.

Do not delete or rewrite historical jobs, reservations, usage events, ledger entries, or the pricing
row itself. Do not modify the other four enabled models beyond verifying their existing selection
metadata remains unchanged.

## API Contract

`GET /api/v1/models` continues using the existing catalog validator and live Gateway enrichment. The
K3 object has this selection and reasoning contract:

```json
{
  "id": "moonshotai/kimi-k3",
  "display_name": "Kimi K3",
  "is_default": true,
  "replaces_model_ids": ["moonshotai/kimi-k2.6"],
  "capabilities": {
    "context_length": 1000000,
    "input_modalities": ["text", "image", "file"],
    "output_modalities": ["text"],
    "supports_reasoning": true,
    "supported_reasoning_efforts": [],
    "default_reasoning_effort": null,
    "supports_tools": true,
    "supports_vision": true,
    "supports_files": true
  }
}
```

The pricing object is live Gateway pricing after the row's markup. If Gateway capability enrichment
temporarily fails, K3 remains present with its backend-owned default, replacement, and fixed reasoning
metadata. Live-only context, modality, tool, vision, file, and pricing fields degrade through the
existing behavior.

## Hosted Request and Billing Behavior

- A request for `moonshotai/kimi-k3` uses the existing OpenAI-compatible Gateway chat path.
- A direct request for `moonshotai/kimi-k2.6` returns the existing `404 model_not_found` response.
- The backend does not rewrite K2.6 requests to K3. Replacement metadata is for catalog
  reconciliation, not execution aliasing.
- Streaming and non-streaming settlement continue reading Gateway-reported provider cost and charging
  that cost plus `markup_bps = 2000`.
- The reservation, minimum charge, idempotency, ledger, and usage-event contracts remain unchanged.

## Public Pricing and Model Claims

Replace the K2.6 public pricing entry with K3 and show the exact Woven rates after 20% markup:

| Input | Output | Cache read | Cache write |
| --- | --- | --- | --- |
| `$3.60/M` | `$18.00/M` | `$0.36/M` | `—` |

Update all current public K2.6 claims, including the pricing data, SEO FAQ/model list, and billing
architecture documentation. Do not make a video-input claim in public copy. Static presentation
values do not participate in runtime settlement.

## Harness Consumer Contract

Harness continues to treat the successful live Woven catalog as authoritative.

- A fresh Woven session resolves to K3 from `is_default: true`.
- A saved `moonshotai/kimi-k2.6` or `woven:moonshotai/kimi-k2.6` selection resolves to K3 from the live
  replacement claim.
- An unknown missing hosted selection with no successor falls back to K3 as the sole live default.
- K3 uses the live `context_length = 1_000_000` hint for compaction.
- Add a K3-specific 1,000,000-token fallback before the K2-family 262,000-token fallback so a missing
  hint cannot incorrectly classify K3.
- Fixed reasoning decodes as `supportsReasoning = true`, an empty supported-effort list, and no
  default effort. Harness shows no picker and sends no reasoning-effort override.
- Do not add a static K3 hosted catalog entry. Remove the unused static K2.6 current-model constant
  and use test-local historical selections where a retired ID is required.
- Keep Kimi absent from the BYOK catalog. Raw `kimi-*` IDs continue to throw the existing
  Woven-credits-only error, and no Moonshot credential surface is added.

The Harness compatibility patch updates fixtures, assertions, and the capability fallback. It is not
a production cutover prerequisite because the current released successor resolver and live context
hint already handle K3 generically.

## Data Flow

1. Preflight verifies K3 in the public Gateway catalog and model-specific endpoint metadata.
2. An authenticated direct Gateway smoke streams a K3 response, completes a tool call, and reports
   billable usage under the exact model ID.
3. The production migration atomically enables/defaults K3 and disables K2.6.
4. The backend loads the five enabled rows and validates one default plus unique replacement claims.
5. Gateway enrichment adds K3's live context, modalities, capabilities, and marked-up pricing.
6. Harness refreshes the Woven catalog, migrates saved K2.6 selections to K3, and defaults fresh
   Woven sessions to K3.
7. K3 requests execute under their exact ID and settle from actual Gateway cost plus 20%.
8. The website deployment replaces K2.6 pricing and public model claims with K3 in the same release.

## Error Handling and Rollback

- Do not deploy the migration if the exact-ID authenticated Gateway smoke cannot stream, call a tool,
  and expose billable usage.
- Missing, malformed, duplicate, or contradictory selection metadata continues failing the complete
  catalog with `500 invalid_model_catalog` before Gateway enrichment begins.
- A live enrichment outage does not change the default or successor metadata. The existing degraded
  capability response remains usable for selection, while unavailable live fields stay conservative.
- Remaining clients that directly submit K2.6 receive `model_not_found`; this is intentional because
  aliases would make requested, executed, and billed identities disagree.
- If K3 must be rolled back, apply a new corrective migration that disables K3, clears its default
  and K2.6 replacement claim, re-enables K2.6 as the sole default, and declares K2.6 as the successor
  to `moonshotai/kimi-k3`. This gives saved K3 selections an unambiguous path back while preserving
  one enabled default and one owner per retired ID.
- If the public deployment fails after the database migration, either complete it promptly or apply
  the corrective migration; do not leave the backend catalog and public pricing split indefinitely.
- Never edit a migration already applied to production.

## Testing

Backend implementation proceeds test-first and includes:

1. A migration source-contract test proving the exact K3 row, complete reasoning and selection
   metadata, metadata merge behavior, K2.6 disable, historical-row preservation, and scoped
   provider/operation predicates.
2. Local database verification proving exactly five enabled hosted chat rows, K3 as the sole default,
   K3 as the sole K2.6 replacement owner, K2.6 disabled, and migration idempotency.
3. Updated selection-policy fixtures proving the three existing successor claims plus K3 as K2.6's
   unique replacement owner.
4. Updated reasoning fixtures proving K3 is reasoning-capable with an empty effort list and null
   default.
5. Model-route tests proving K3's top-level identity fields, live 1M context and capabilities,
   exactly one returned default, and backend metadata preservation during enrichment failure.
6. Chat-route tests proving K3 executes normally and disabled K2.6 returns `model_not_found` without
   starting a provider request or billing job.
7. Pricing and SEO tests proving K2.6 is absent and all four K3 presentation values are exact.
8. Complete `pnpm test`, `pnpm build`, `supabase db reset`, persisted-row queries, and
   `git diff --check`.

Before writing implementation code, read the relevant Next.js 16.2.3 guides under
`node_modules/next/dist/docs/` as required by this repository.

Coordinated Harness verification includes:

1. Hosted-catalog decoding for K3's identity, fixed reasoning contract, and 1M context.
2. Fresh/unknown Woven selection resolving to K3.
3. Canonical and `woven:`-prefixed K2.6 selections resolving to K3.
4. The live context hint and K3-specific fallback both producing 1,000,000 tokens while K2 models
   remain at 262,000.
5. Kimi remaining absent from BYOK and raw Kimi resolution continuing to fail.
6. Focused Swift tests, Sidecar tests, and the repository's normal build gate.

Production verification includes:

1. Linked migration history, dry-run, and a scoped pre-cutover `model_pricing_rules` backup.
2. Public and model-specific Gateway metadata checks plus the authenticated K3 execution smoke.
3. Immediate post-migration verification of the exact five-row catalog and selection metadata.
4. Canonical deployment verification for K3 pricing and public model copy.
5. Authenticated `GET /api/v1/models`, K3 chat execution, usage-event cost, charged micros, and ledger
   settlement verification.
