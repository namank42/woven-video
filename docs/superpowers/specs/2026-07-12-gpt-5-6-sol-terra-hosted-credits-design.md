# GPT-5.6 Sol and Terra Hosted Credits Design

**Date:** 2026-07-12
**Status:** Approved design - pending written-spec review
**Repo scope:** `woven-video` hosted-chat catalog, pricing page, current hosted-model copy, and tests. No `woven-harness` changes.
**Docs digest:** `docs/superpowers/research/2026-07-12-gpt-5-6-sol-terra-docs.md`

---

## Purpose

Replace GPT-5.5 with GPT-5.6 Sol and GPT-5.6 Terra in Woven Credits. The Harness already consumes
the authenticated `GET /api/v1/models` catalog dynamically, so the backend should expose the two
new Gateway models through the existing contract and allow them through the existing billed chat
completion path.

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
- Preserve the existing `/api/v1/models` response shape. Its scalar pricing fields continue to
  describe the base tier.
- Publish both the base and long-context tiers on `/pricing`, because both models charge more above
  272,000 input tokens.
- Keep the pricing page static; do not make it fetch the catalog or Supabase at render time.
- Do not change Harness code. Its hosted catalog and stale-selection reconciliation are already
  backend-driven.

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

The migration should use the existing insert-on-conflict pattern so a replay restores the intended
display name, pricing configuration, metadata, and enabled state. In the same migration, update the
`openai/gpt-5.5` chat row to `enabled = false`. Do not delete or rewrite the old row.

Sol keeps GPT-5.5's `$0.10` reservation because its base provider rates are the same. Terra uses a
`$0.05` reservation, matching its provider rate being half of Sol's base rate. Final settlement is
still based on actual Gateway cost rather than either reservation amount.

## Catalog and Harness Data Flow

1. An authenticated Harness client requests `GET /api/v1/models`.
2. `listHostedChatModels()` returns enabled `chat` rows, including Sol and Terra and excluding
   GPT-5.5.
3. The route requests live Gateway capabilities for each model and returns the existing OpenAI-style
   list response.
4. Harness prefixes the returned IDs for its Woven access mode and displays the backend-driven
   entries.
5. If GPT-5.5 was previously selected, Harness's existing reconciliation moves the session to a
   valid hosted model after catalog hydration.

No new response field, API version, hardcoded route allowlist, or Harness release is required.

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
- If live capability enrichment fails, preserve the current catalog behavior: return the enabled
  model with `capabilities: null` and `pricing: null`. Catalog-health policy is outside this change.
- The rollout smoke test is the guard against enabling a row whose live Gateway endpoint cannot run.

## Testing

Implementation should proceed test-first and include:

1. Add `tests/gpt-5-6-sol-terra-migration.test.ts` to prove both exact model IDs, display names, 20%
   markup, reserve amounts, provider metadata, and enablement are present, and that GPT-5.5 is
   disabled without a delete.
2. Update `tests/pricing-page-rates.test.ts` to prove Sol and Terra replace GPT-5.5 and publish the
   exact base and `>272K` Woven rates.
3. Update `tests/pricing-page-source.test.ts` to prove the optional higher tier is rendered in both
   desktop and mobile branches while non-tiered rows remain valid.
4. Update `tests/seo-faqs.test.ts` to prove current hosted-model copy contains Sol and Terra and no
   longer presents GPT-5.5 as current.
5. Run the focused tests first, then `pnpm test` for the full Vitest suite.
6. Run `pnpm build` as the final repository gate.

Deployment verification:

1. Apply the migration to the target Supabase environment and deploy the web backend.
2. Call authenticated `GET /api/v1/models` and verify Sol and Terra are present, GPT-5.5 is absent,
   and both new rows have non-null live capabilities and pricing.
3. Send one small non-streaming chat request through each new model.
4. Verify each generation job succeeded and its reservation settled into a usage event and ledger
   charge.

## Out of Scope

- GPT-5.6 Luna.
- Harness code or a Harness release.
- Automatic latest-generation discovery.
- An alias or migration from GPT-5.5 requests to Sol.
- A versioned or breaking `/api/v1/models` response.
- Exposing Gateway pricing tier arrays through the model endpoint.
- Changing catalog behavior when capability enrichment is unavailable.
- Refactoring the existing chat reservation or settlement system.

## Risks

- **Provider pricing drift:** The pricing page is static while Gateway pricing is live. Keep the
  research digest and pricing tests tied to the reviewed July 12 rates and refresh both when rates
  change.
- **Tier interpretation:** The higher tier begins when input crosses 272K tokens and affects input,
  output, and cache prices. The UI must not imply that each column has a separate threshold.
- **Upstream availability:** Gateway availability can change after migration. Production catalog and
  chat smoke tests are required before calling the rollout complete.
- **Stale saved selection:** GPT-5.5 disappears from the backend catalog. Harness already reconciles
  missing hosted selections; this behavior should be confirmed during the catalog smoke test.
