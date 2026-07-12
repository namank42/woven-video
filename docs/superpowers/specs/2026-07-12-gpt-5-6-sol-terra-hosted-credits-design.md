# GPT-5.6 Sol and Terra Hosted Credits Design

**Date:** 2026-07-12
**Status:** Revised approved design - pending written-spec review
**Repo scope:** `woven-video` hosted-chat catalog, pricing page, current hosted-model copy, and tests,
plus the cross-repo `woven-harness` catalog-consumer contract. Harness implementation remains a
separate change.
**Docs digests:** `docs/superpowers/research/2026-07-12-gpt-5-6-sol-terra-docs.md` and
`docs/superpowers/research/2026-07-12-hosted-reasoning-efforts-docs.md`

---

## Purpose

Replace GPT-5.5 with GPT-5.6 Sol and GPT-5.6 Terra in Woven Credits. The Harness already consumes
the authenticated `GET /api/v1/models` catalog dynamically, so the backend should expose the two
new Gateway models through the existing contract and allow them through the existing billed chat
completion path.

The backend must also publish each enabled hosted model's exact selectable reasoning efforts and
default effort. Harness must remain data-driven: a generic `supports_reasoning: true` must never be
expanded into guessed Low/Medium/High choices.

The public pricing page and current hosted-model SEO copy must change in the same release so Woven
does not advertise GPT-5.5 after the credits catalog has moved on.

## Current State

- Enabled `model_pricing_rules` rows are the source of truth for hosted chat admission and
  `GET /api/v1/models` discovery.
- The catalog route enriches each enabled row with capabilities and base pricing from Vercel AI
  Gateway's per-model endpoints API.
- `POST /api/v1/chat/completions` rejects models without an enabled pricing row, reserves the row's
  configured amount, sends the request through Vercel AI Gateway, and settles from Gateway-reported
  generation cost plus the row's markup.
- The public pricing table is static and currently publishes GPT-5.5.
- Historical specs, archived landing-page copy, and ChatGPT/Codex documentation also mention
  GPT-5.5 for historical or non-Woven-Credits reasons. Those references are not current hosted-model
  claims and must not be changed mechanically.

## Decisions

- Add only GPT-5.6 Sol and GPT-5.6 Terra. GPT-5.6 Luna is out of scope.
- Use explicit, reviewed database rows instead of dynamically mirroring the latest upstream model
  family.
- Disable GPT-5.5 rather than deleting its row, preserving billing and usage history.
- Do not alias GPT-5.5 to Sol. A request for the disabled model receives the existing
  `404 model_not_found` response.
- Use the existing 20% hosted markup for both new models.
- Extend `/api/v1/models` additively with exact reasoning effort and default fields inside
  `capabilities`. Its scalar pricing fields continue to describe the base tier.
- Publish both the base and long-context tiers on `/pricing`, because both models charge more above
  272,000 input tokens.
- Keep the pricing page static; do not make it fetch the catalog or Supabase at render time.
- Keep reviewed reasoning capabilities in `model_pricing_rules.metadata`; Gateway's generic
  reasoning support flag is insufficient to derive model-specific tiers.
- Harness must consume the backend array and default verbatim and must not infer effort tiers from
  `supports_reasoning`.

## Model Rows

Add a new immutable Supabase migration with these enabled rows:

| Field | GPT-5.6 Sol | GPT-5.6 Terra |
| --- | --- | --- |
| `provider` | `vercel-ai-gateway` | `vercel-ai-gateway` |
| `model` | `openai/gpt-5.6-sol` | `openai/gpt-5.6-terra` |
| `operation` | `chat` | `chat` |
| `display_name` | `GPT-5.6 Sol` | `GPT-5.6 Terra` |
| `markup_bps` | `2000` | `2000` |
| `minimum_charge_usd_micros` | `1` | `1` |
| `reserve_amount_usd_micros` | `100000` | `50000` |
| `metadata.provider_model_id` | `openai/gpt-5.6-sol` | `openai/gpt-5.6-terra` |
| `metadata.supports_reasoning` | `true` | `true` |
| `metadata.supported_reasoning_efforts` | `["low", "medium", "high", "xhigh", "max"]` | `["low", "medium", "high", "xhigh", "max"]` |
| `metadata.default_reasoning_effort` | `"medium"` | `"medium"` |

The migration should use the existing insert-on-conflict pattern so a replay restores the intended
display name, pricing configuration, metadata, and enabled state. In the same migration, update the
`openai/gpt-5.5` chat row to `enabled = false`. Do not delete or rewrite the old row.

Sol keeps GPT-5.5's `$0.10` reservation because its base provider rates are the same. Terra uses a
`$0.05` reservation, matching its provider rate being half of Sol's base rate. Final settlement is
still based on actual Gateway cost rather than either reservation amount.

Add a follow-up immutable migration that seeds the complete reasoning metadata contract for every
enabled hosted chat model:

| Model | `supports_reasoning` | `supported_reasoning_efforts` | `default_reasoning_effort` |
| --- | --- | --- | --- |
| `openai/gpt-5.6-sol` | `true` | `["low", "medium", "high", "xhigh", "max"]` | `"medium"` |
| `openai/gpt-5.6-terra` | `true` | `["low", "medium", "high", "xhigh", "max"]` | `"medium"` |
| `anthropic/claude-sonnet-4.6` | `true` | `["low", "medium", "high", "max"]` | `"high"` |
| `anthropic/claude-opus-4.8` | `true` | `["low", "medium", "high", "xhigh", "max"]` | `"high"` |
| `moonshotai/kimi-k2.6` | `true` | `[]` | `null` |

Kimi's empty array is valid: it supports thinking, but its documented API does not expose granular
effort tiers. An empty array therefore must not be used to derive `supports_reasoning: false`.

## Reasoning Capability Contract

Add these fields to each non-null catalog `capabilities` object:

```json
{
  "supports_reasoning": true,
  "supported_reasoning_efforts": ["low", "medium", "high", "xhigh", "max"],
  "default_reasoning_effort": "medium"
}
```

The database metadata is authoritative for all three fields. Gateway remains authoritative for
live context length, modalities, tools, vision, files, and provider pricing. This separation keeps
reviewed UI choices stable while still allowing operational Gateway capability data to refresh.

Parse the metadata through one pure, tested helper before serializing it. A valid contract requires:

- `supports_reasoning` is a boolean;
- `supported_reasoning_efforts` is an array containing only `minimal`, `low`, `medium`, `high`,
  `xhigh`, or `max`, with no duplicates and in canonical increasing-effort order;
- `off` and provider-level `none` are excluded because Harness represents disabled reasoning as a
  separate UI state;
- a non-empty effort array requires `default_reasoning_effort` to be one of its members;
- an empty effort array requires a `null` default;
- `supports_reasoning: false` requires an empty array and a `null` default; and
- `supports_reasoning: true` may have an empty array and `null` default when the model exposes no
  granular selector.

If any field is missing or the combination is invalid, keep the model in the catalog, emit a
structured server warning with the model ID and validation reason, and safely publish
`supports_reasoning: false`, `supported_reasoning_efforts: []`, and
`default_reasoning_effort: null`. Never substitute a guessed tier list.

## Catalog and Harness Data Flow

1. An authenticated Harness client requests `GET /api/v1/models`.
2. `listHostedChatModels()` returns enabled `chat` rows, including Sol and Terra and excluding
   GPT-5.5.
3. The route validates the row's reasoning metadata and requests live Gateway capabilities for each
   model.
4. The route returns an OpenAI-style list response whose reasoning fields come from database
   metadata and whose remaining capability and pricing fields come from Gateway.
5. Harness prefixes the returned IDs for its Woven access mode, displays the backend-driven entries,
   and uses the exact effort array and default without inference.
6. If GPT-5.5 was previously selected, the coordinated Harness change maps that retired selection to
   Sol before falling back to a placeholder or static catalog entry.

No API version or hardcoded route allowlist is required. The new fields are additive, but full UI
parity requires the coordinated Harness consumer change.

## Chat Billing Data Flow

1. Harness sends `openai/gpt-5.6-sol` or `openai/gpt-5.6-terra` to
   `POST /api/v1/chat/completions`.
2. `getHostedChatModel()` confirms that the exact row is enabled.
3. Woven creates a generation job and reserves the configured amount.
4. Woven forwards the request to Vercel AI Gateway's Chat Completions endpoint with the exact model
   ID.
5. On success, Woven reads the Gateway generation cost, applies the row's 20% markup, records usage,
   and settles the reservation.
6. Gateway-reported cost remains authoritative, so requests above the 272K threshold settle against
   the provider's higher tier without adding tier math to the Woven catalog route.
7. Gateway, network, stream, or settlement failures follow the existing release/error paths.

## Public Pricing

Replace the GPT-5.5 row in `chatModelRates` with Sol and Terra. The displayed Woven rates are:

| Model | Input tier | Input/M | Output/M | Cache read/M | Cache write/M |
| --- | --- | ---: | ---: | ---: | ---: |
| GPT-5.6 Sol | up to 272K input tokens | $6.00 | $36.00 | $0.60 | $7.50 |
| GPT-5.6 Sol | over 272K input tokens | $12.00 | $54.00 | $1.20 | $15.00 |
| GPT-5.6 Terra | up to 272K input tokens | $3.00 | $18.00 | $0.30 | $3.75 |
| GPT-5.6 Terra | over 272K input tokens | $6.00 | $27.00 | $0.60 | $7.50 |

Extend the chat pricing data type with an optional higher-tier object rather than embedding markup or
line breaks inside strings. It should carry the threshold label and the four higher-tier displayed
rates:

```ts
type ChatModelRateTier = {
  threshold: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};
```

`ChatModelRate` gets an optional `higherTier?: ChatModelRateTier`. Sol and Terra use
`threshold: ">272K"`; models without tiered pricing omit it.

Desktop table cells and mobile definition-list values should render the normal rate first and, when
present, a subdued `>272K: <rate>` line below it. The threshold is based on input tokens even in the
output and cache columns; the table introduction or row presentation must make that clear.

## Current Hosted-Model Copy

Update current public hosted-model claims so they name Sol and Terra instead of GPT-5.5. This
includes the hosted-model FAQ content and the maintained billing architecture's current model list.
Update their focused tests accordingly.

Do not rewrite:

- historical design specs or implementation plans;
- `docs/landing-page-archive.md`;
- changelog entries;
- ChatGPT/Codex model documentation where GPT-5.5 describes a separate access mode or historical
  release.

## Error Handling

- A disabled GPT-5.5 request continues to return the existing `404 model_not_found`; there is no
  silent substitution.
- Insufficient balance continues to return the existing `402 insufficient_balance` before provider
  work starts.
- Gateway rejection or network failure releases the reservation through the current chat failure
  path.
- If live Gateway enrichment fails, return the enabled model with its backend-owned reasoning
  contract intact and `pricing: null`; live-only capability values degrade to neutral values. This
  ensures a transient Gateway catalog failure cannot erase or invent reasoning tiers.
- If reasoning metadata is missing or invalid, keep the model available, publish the safe reasoning
  fallback (`false`, `[]`, `null`), and emit a structured warning.
- Do not add request-time rejection of unsupported effort values in this revision. Older Harness
  builds still infer tiers, so server enforcement would make rollout ordering user-visible. The
  provider remains the final request validator until the consumer migration is complete.
- The rollout smoke test is the guard against enabling a row whose live Gateway endpoint cannot run.

## Testing

Implementation should proceed test-first and include:

1. Add `tests/gpt-5-6-sol-terra-migration.test.ts` to prove both exact model IDs, display names, 20%
   markup, reserve amounts, provider and reasoning metadata, and enablement are present, and that
   GPT-5.5 is disabled without a delete.
2. Update `tests/pricing-page-rates.test.ts` to prove Sol and Terra replace GPT-5.5 and publish the
   exact base and `>272K` Woven rates.
3. Update `tests/pricing-page-source.test.ts` to prove the optional higher tier is rendered in both
   desktop and mobile branches while non-tiered rows remain valid.
4. Update `tests/seo-faqs.test.ts` to prove current hosted-model copy contains Sol and Terra and no
   longer presents GPT-5.5 as current.
5. Add focused metadata-parser and model-route tests proving all five exact arrays/defaults, Kimi's
   valid empty array, invalid/missing metadata safe degradation, canonical-order validation, and
   preservation of reasoning metadata when Gateway enrichment fails.
6. Run the focused tests first, then `pnpm test` for the full Vitest suite.
7. Run `pnpm build` as the final repository gate.

Deployment verification:

1. Apply the migration to the target Supabase environment and deploy the web backend.
2. Call authenticated `GET /api/v1/models` and verify Sol and Terra are present, GPT-5.5 is absent,
   and all five hosted models expose the exact reviewed reasoning contract.
3. Send one small non-streaming chat request through each new model.
4. Verify each generation job succeeded and its reservation settled into a usage event and ledger
   charge.

## Out of Scope

- GPT-5.6 Luna.
- Implementing or releasing the coordinated Harness consumer patch from this repository.
- Automatic latest-generation discovery.
- An alias or migration from GPT-5.5 requests to Sol.
- A versioned or breaking `/api/v1/models` response.
- Exposing Gateway pricing tier arrays through the model endpoint.
- Request-time backend enforcement of supported effort values before the Harness migration is
  complete.
- Refactoring the existing chat reservation or settlement system.

## Risks

- **Provider pricing drift:** The pricing page is static while Gateway pricing is live. Keep the
  research digest and pricing tests tied to the reviewed July 12 rates and refresh both when rates
  change.
- **Tier interpretation:** The higher tier begins when input crosses 272K tokens and affects input,
  output, and cache prices. The UI must not imply that each column has a separate threshold.
- **Upstream availability:** Gateway availability can change after migration. Production catalog and
  chat smoke tests are required before calling the rollout complete.
- **Old Harness inference:** Existing Harness builds synthesize Low/Medium/High when only
  `supports_reasoning` is available. Deploy the additive backend fields first, then ship the Harness
  consumer patch that removes inference; do not enable strict request validation in this revision.
- **Stale saved selection:** GPT-5.5 disappears from the backend catalog, but the current Harness can
  preserve a synthesized placeholder for a saved missing model. The coordinated Harness patch must
  map GPT-5.5 to Sol before placeholder reconciliation.
