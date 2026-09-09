# Retire Anthropic Hosted Chat Design

Companion spec: `woven-harness/docs/superpowers/specs/2026-09-09-remove-chat-byok-design.md`
ships after this one and removes the last Anthropic path (chat BYOK) from the desktop app.

## Goal

Remove Anthropic models from Woven credits entirely: hidden from the model
catalog, removed from the pricing page, and rejected at request admission.
Bring-back stays a flag flip: pricing rows and history are preserved, so a
future migration can restore Anthropic by setting two booleans.

`openai/gpt-5.6-luna` remains the sole hosted default. Historical Anthropic
jobs, usage, and billing records remain intact.

## Product Decisions

- Retire every `anthropic/*` chat rule under `provider = 'vercel-ai-gateway'`
  in a single migration (`claude-haiku-4.5`, `claude-opus-4.8`,
  `claude-sonnet-5`, plus already-superseded `claude-opus-4.7` /
  `claude-sonnet-4.6` rows if still present).
- Discovery and admission go together: `enabled = false` plus
  `catalog_visible = false`. No Kimi-style compatibility period — stale
  clients receive 404 immediately.
- Never silently substitute another model when a client requests Anthropic.
  Return 404 `model_not_found`, execute nothing, bill nothing.
- Do not delete pricing rules or any historical data.
- Remove Anthropic entries from the public pricing page rates.
- Update product-surface copy that promises BYOK chat keys (homepage, pricing page, subscription offer, SEO FAQs, answer-first/SEO description copy) so no shipped page describes the removed path.
- Out of scope: the landing-page/keyword corpus (`lib/seo/landing-pages.ts`, `lib/seo/keywords.ts`, `lib/seo/hubs.ts`, `lib/seo/internal-links.ts`, `lib/seo/schema.ts` — a separate search-equity decision), historical usage records, non-chat operations, docs history under `docs/superpowers`, and the dormant conditional in `app/terms/page.tsx` (legal text, no false claim).

## Current Behavior

- `listHostedChatModels()` returns enabled + visible chat rules to
  `GET /api/v1/models`.
- `getHostedChatModel()` admits an exact enabled model for
  `POST /api/v1/chat/completions`. A miss returns 404 `model_not_found`
  before job creation, so no usage is metered and no charge is possible.
- `validateHostedModelSelectionPolicies` requires exactly one default model
  among listed rules; the default is Luna. It rejects a catalog only when a
  `replaces_model_ids` entry is itself enabled.
- The pricing page renders `chatModelRates`, including Claude Sonnet 5 and
  Claude Opus 4.8 entries.

## Database

One migration, `supabase/migrations/20260909120000_disable_anthropic_hosted_chat.sql`:

```sql
update public.model_pricing_rules
set enabled = false,
    catalog_visible = false,
    metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('is_default', false),
    updated_at = now()
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and model like 'anthropic/%';
```

No deploy-interval hazard: the running web code already honors both flags
(the Kimi K3 soft-retirement migration introduced `catalog_visible` and
`listHostedChatModels` filters on it).

The selection policy stays valid by construction. Luna remains the sole
default, and disabling models cannot violate the replacement rule, which
fails only when a replacement target is still enabled.

Bring-back is a future migration setting `enabled` and `catalog_visible`
back to true on the same rows. Nothing in this change destroys data.

## Backend App Code

No catalog or admission code changes: the existing flag filters implement
both the catalog hide and the metering block.

Pricing page: delete the Anthropic entries from `chatModelRates` in
`lib/pricing-page-rates.ts`; remove the BYOK-key bullets and reword the meta
description and "Use your own keys" note in `app/pricing/page.tsx`; apply the
same bullet removal to the homepage (`app/page.tsx`) and the no-access
subscription offer (`components/account/subscription-offer.ts`). Update
`tests/pricing-page-rates.test.ts` and
`tests/billing/subscription-offer.test.ts`; `homepage-copy`, `seo-faqs`,
route, and historical migration tests stay green unchanged. Refresh the
"Current hosted chat models" list and the example model id in
`docs/billing-architecture.md`.

## Error Handling

- Post-deploy Anthropic completion requests get 404 `model_not_found`
  (`Hosted model is not enabled: <id>`), with no job row and no charge.
- Stale desktop builds stop seeing Anthropic in refreshed catalogs; the
  harness `HostedModelCatalog.resolve` falls those selections back to the
  hosted default. A stale build that sends an Anthropic id anyway gets the
  same 404.

## Tests

Add a migration test mirroring `model-catalog-visibility-migration.test.ts`
that asserts, against the post-migration catalog:

- No `anthropic/*` id appears in `GET /api/v1/models` output.
- Exactly one default remains, and it is `openai/gpt-5.6-luna`.
- A `POST /api/v1/chat/completions` for `anthropic/claude-sonnet-5` (rule
  lookup mocked to miss, Supabase admin mocked to throw) returns 404
  `model_not_found` without touching the database.
- `validateHostedModelSelectionPolicies` passes on the listed models.
- No enabled `anthropic/%` rule remains for any operation.

## Verification and Rollout

- Run the billing/catalog suites. Deploy. Confirm via an authenticated
  `GET /api/v1/models` response and a pricing page render with no Anthropic
  entries.
- Ships before the harness BYOK removal. Either order would be coherent;
  backend-first isolates the billing boundary for verification.
- Requires an independent review before merge (billing boundary).
