# Anthropic Successor Rollout Design

**Date:** 2026-07-14
**Status:** Approved design - pending written-spec review
**Backend scope:** `woven-video` hosted catalog, model retirement metadata, reasoning metadata, public
pricing, migration tests, and rollout verification.
**Consumer scope:** Coordinated `woven-harness` Woven-catalog consumption and BYOK model migration;
Harness implementation remains a separate repository plan.

---

## Purpose

Complete the backend-owned retirement contract for Claude Opus 4.7 and replace Claude Sonnet 4.6
with Claude Sonnet 5 across Woven Credits and BYOK without making Harness own Woven replacement
policy.

This specification is a follow-up to
`docs/superpowers/specs/2026-07-12-hosted-model-selection-policy-design.md`. It supersedes that
document's Sonnet and Opus metadata rows. Kimi remains the sole Woven default, and Sol retains the
GPT-5.5 replacement claim already implemented on the feature branch.

## Verified Provider Contract

The provider facts used by this design are recorded in
`docs/superpowers/research/2026-07-14-claude-sonnet-5-rollout-docs.md`.

- Anthropic's API model ID is `claude-sonnet-5`.
- Vercel AI Gateway's model ID is `anthropic/claude-sonnet-5`.
- Sonnet 5 is a direct Sonnet 4.6 upgrade with a 1,000,000-token context window and up to 128,000
  output tokens.
- Supported effort levels are `low`, `medium`, `high`, `xhigh`, and `max`; the documented default is
  `high`.
- Sonnet 5 uses adaptive thinking. Manual thinking budgets and non-default sampling parameters are
  rejected.
- Introductory provider pricing runs through August 31, 2026. Standard pricing begins afterward.

## Decisions

- Implement the Opus replacement claim and Sonnet replacement as one backend follow-up because both
  amend the same catalog retirement policy.
- Keep this follow-up separate from the completed Kimi-default correction.
- Replace Sonnet 4.6 rather than exposing both Sonnet versions in the steady-state catalog.
- Preserve Kimi K2.6 as the sole Woven default.
- Keep replacement policy backend-owned for Woven and local for BYOK.
- Do not add request-time aliases for Sonnet 4.6 or Opus 4.7.
- Deploy the retirement only after a compatible Harness release has reached acceptable adoption.
- Keep disabled model rows for billing and usage history.
- Continue settling Woven usage from Gateway-reported actual cost plus the existing 20% markup.
- Show both introductory and standard Sonnet 5 public rates with explicit effective dates so pricing
  remains unambiguous across the August 31 transition.

## Final Enabled Hosted Catalog Policy

After the migration, the enabled hosted chat catalog contains exactly these five models:

| Model | `is_default` | `replaces_model_ids` |
| --- | --- | --- |
| `openai/gpt-5.6-sol` | `false` | `["openai/gpt-5.5"]` |
| `openai/gpt-5.6-terra` | `false` | `[]` |
| `anthropic/claude-sonnet-5` | `false` | `["anthropic/claude-sonnet-4.6"]` |
| `anthropic/claude-opus-4.8` | `false` | `["anthropic/claude-opus-4.7"]` |
| `moonshotai/kimi-k2.6` | `true` | `[]` |

The retired IDs are canonical, unprefixed, absent from the enabled catalog, and each claimed by only
one enabled successor. The existing catalog validator therefore continues to enforce the contract
without runtime code changes.

## Database Migration

Add one immutable, idempotent migration after
`20260712123000_seed_hosted_model_selection_policy.sql`.

### Sonnet 5 upsert

Upsert one hosted chat pricing row with:

| Field | Value |
| --- | --- |
| `provider` | `vercel-ai-gateway` |
| `model` | `anthropic/claude-sonnet-5` |
| `operation` | `chat` |
| `display_name` | `Claude Sonnet 5` |
| `markup_bps` | `2000` |
| `minimum_charge_usd_micros` | `1` |
| `reserve_amount_usd_micros` | `50000` |
| `enabled` | `true` |

The row's metadata contains:

```json
{
  "provider_model_id": "anthropic/claude-sonnet-5",
  "supports_reasoning": true,
  "supported_reasoning_efforts": ["low", "medium", "high", "xhigh", "max"],
  "default_reasoning_effort": "high",
  "is_default": false,
  "replaces_model_ids": ["anthropic/claude-sonnet-4.6"]
}
```

On conflict, update the pricing fields, enable the row, and merge these reviewed keys into existing
metadata rather than replacing unrelated metadata.

### Retire Sonnet 4.6

Set the existing `anthropic/claude-sonnet-4.6` hosted chat row to `enabled = false`. Do not delete or
rewrite historical jobs, reservations, usage events, or pricing rows.

### Complete Opus replacement metadata

Merge `replaces_model_ids: ["anthropic/claude-opus-4.7"]` into the enabled
`anthropic/claude-opus-4.8` hosted chat row while preserving its provider ID, reasoning metadata, and
other unrelated metadata. Opus remains non-default.

## API Contract

`GET /api/v1/models` continues to expose the existing top-level selection fields. The relevant
objects are:

```json
{
  "id": "anthropic/claude-sonnet-5",
  "display_name": "Claude Sonnet 5",
  "is_default": false,
  "replaces_model_ids": ["anthropic/claude-sonnet-4.6"],
  "capabilities": {
    "supports_reasoning": true,
    "supported_reasoning_efforts": ["low", "medium", "high", "xhigh", "max"],
    "default_reasoning_effort": "high"
  }
}
```

```json
{
  "id": "anthropic/claude-opus-4.8",
  "is_default": false,
  "replaces_model_ids": ["anthropic/claude-opus-4.7"]
}
```

Sonnet 4.6 and Opus 4.7 remain absent from the successful catalog. Invalid or contradictory policy
still fails the complete request with `500 invalid_model_catalog`. Gateway capability lookup failure
still preserves backend-owned selection and reasoning metadata while degrading live-only capability
and pricing fields.

## Hosted Request Behavior

- A request for `anthropic/claude-sonnet-5` uses the existing hosted chat path and bills from the
  Gateway-reported Sonnet 5 cost plus 20% markup.
- A direct hosted request for `anthropic/claude-sonnet-4.6` returns the existing `model_not_found`
  response after retirement.
- A direct hosted request for `anthropic/claude-opus-4.7` continues to return `model_not_found`.
- The backend does not infer execution aliases from `replaces_model_ids`.
- Replacement metadata exists for catalog reconciliation, not request rewriting.

## Public Pricing

Replace the Sonnet 4.6 public rate entry with Sonnet 5. The pricing UI must label both periods and
show all four exact Woven rates after 20% markup:

| Period | Input | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| Intro through August 31, 2026 | `$2.40/M` | `$12.00/M` | `$0.24/M` | `$3.00/M` |
| From September 1, 2026 | `$3.60/M` | `$18.00/M` | `$0.36/M` | `$4.50/M` |

The page must not present the introductory values without their end date or hide the standard values
behind an assumed future deploy. Settlement remains dynamic and does not use these presentation
constants.

## Harness Consumer Contract

Harness implementation is coordinated but separately planned and committed in `woven-harness`.

### Woven Credits

- Decode Sonnet 5 only from the successful live Woven catalog.
- Normalize persisted `woven:` IDs before matching replacement claims.
- Migrate a saved or active `anthropic/claude-sonnet-4.6` Woven selection to the live Sonnet 5 entry.
- Migrate a saved or active `anthropic/claude-opus-4.7` Woven selection to the live Opus 4.8 entry.
- Continue selecting Kimi for a fresh Woven user from `is_default: true`.
- Do not retain a local Woven successor table or hardcoded Sonnet 5 model ID.

### BYOK

- Add Sonnet 5 as the local Sonnet entry and remove Sonnet 4.6 from the picker.
- Add the local successor mapping `anthropic/claude-sonnet-4.6 -> anthropic/claude-sonnet-5`.
- Retain the local mappings `anthropic/claude-opus-4.7 -> anthropic/claude-opus-4.8` and
  `openai/gpt-5.5 -> openai/gpt-5.6-sol`.
- Keep BYOK's fresh default independent from Woven's live default policy.

### Request shaping and context

- Recognize direct, Woven-prefixed, and provider-qualified Sonnet 5 IDs as adaptive-thinking models.
- Add Sonnet 5 to the 1,000,000-token BYOK context fallback. Woven continues to prefer the live
  catalog context hint.
- Never send manual `budget_tokens` or non-default `temperature`, `top_p`, or `top_k` for Sonnet 5.
- Pass `max` through as Anthropic `max`. The installed `@ai-sdk/anthropic` version accepts `max`, so
  Harness must stop downgrading the backend tier to `xhigh` for current adaptive models.

## Data Flow

1. A compatible Harness build ships with backend replacement consumption and Sonnet 5 BYOK support.
2. Desktop adoption reaches the rollout threshold chosen by the release owner.
3. The backend migration enables Sonnet 5, disables Sonnet 4.6, and adds the Sonnet and Opus
   replacement claims atomically.
4. The backend validates the resulting five-model catalog before Gateway enrichment.
5. Harness refreshes the live Woven catalog.
6. Existing Sonnet 4.6 and Opus 4.7 Woven selections migrate through backend claims; new Woven users
   still select Kimi.
7. BYOK performs the corresponding migrations from its local successor map.

## Error Handling and Rollback

- Do not deploy the retirement migration if a direct Gateway smoke test cannot execute
  `anthropic/claude-sonnet-5` with adaptive thinking and a reviewed effort value.
- Catalog invariant failures continue to return `500 invalid_model_catalog` and block automatic Woven
  selection.
- Remaining old Harness builds may receive `model_not_found` for Sonnet 4.6 after retirement. This is
  an accepted consequence of the no-alias policy and is why desktop adoption gates deployment.
- If Sonnet 5 must be rolled back after deployment, apply a new corrective migration that re-enables
  Sonnet 4.6, keeps Sonnet 5 enabled, and clears Sonnet 5's replacement claim. Both exact IDs then
  remain valid and the catalog validator does not see an enabled model claimed as replaced.
- Do not mutate a migration that has already shipped to production.

## Testing

Backend implementation proceeds test-first and includes:

1. A migration source-contract test proving the exact Sonnet 5 pricing row, complete reasoning and
   selection metadata, Sonnet 4.6 disable, Opus 4.7 replacement claim, metadata merge behavior, and
   provider/operation scope.
2. Updated selection-policy fixtures proving Kimi is the sole default and the three retired IDs have
   unique owners.
3. Updated reasoning-metadata fixtures proving Sonnet 5 exposes all five ordered tiers with `high` as
   default.
4. Model route tests proving the exact Sonnet and Opus replacement arrays, one returned default, and
   backend metadata preservation when Gateway enrichment fails.
5. Pricing tests proving Sonnet 4.6 is absent and both dated Sonnet 5 rate sets are exact.
6. A local `supabase db reset` followed by exact enabled/disabled row and JSON metadata queries.
7. The focused tests, complete `pnpm test` suite, `pnpm build`, and `git diff --check`.
8. Pre-deploy Gateway smoke testing for model recognition, adaptive thinking, all reviewed effort
   levels used by Harness, context reporting, and usage/cost reporting.
9. Post-deploy authenticated `/api/v1/models`, Sonnet 5 streaming chat, reservation, settlement, and
   expected retired-model rejection checks.

Coordinated Harness acceptance tests cover:

1. Woven Sonnet 4.6 -> Sonnet 5 migration from the live replacement claim.
2. Woven Opus 4.7 -> Opus 4.8 migration from the live replacement claim.
3. BYOK Sonnet and Opus migrations from the local successor map.
4. Sonnet 5 adaptive-thinking provider options for direct and Woven-prefixed IDs.
5. Exact `low`, `medium`, `high`, `xhigh`, and `max` effort pass-through.
6. The 1M context fallback for Sonnet 5 BYOK plus live context hints for Woven.
7. Kimi remaining the Woven fresh default and the existing BYOK default remaining independent.

## Rollout

1. Implement and verify the backend and Harness changes on their separate branches.
2. Smoke-test Sonnet 5 directly through Vercel AI Gateway before changing the live catalog.
3. Release the compatible Harness build first.
4. Wait for acceptable desktop adoption; the release owner decides the threshold from observed
   adoption and legacy traffic.
5. Deploy the backend migration and web pricing update together.
6. Verify the live catalog, Sonnet 5 execution and settlement, saved-model migrations, and retired
   model rejection.
7. Monitor `model_not_found` traffic for Sonnet 4.6 and keep the rollback migration procedure ready.

## Out of Scope

- Request-time aliases for Sonnet 4.6, Opus 4.7, or GPT-5.5.
- Making replacement metadata automatically rewrite chat requests.
- Changing Kimi's default status.
- Removing disabled pricing rows or historical billing data.
- Making BYOK consume Woven's hosted replacement policy.
- Adding Priority Tier support.
- Automatically selecting Sonnet 5 as Woven's default.
