# Media Pricing Page Design

**Date:** 2026-07-01
**Status:** Approved design - pending written-spec review
**Repo scope:** `woven-video` public `/pricing` page and pricing display data. No `woven-harness` changes in this spec.
**Docs digests:**
- `docs/superpowers/research/2026-07-01-hosted-media-models-docs.md`
- `docs/superpowers/research/2026-07-01-pricing-page-next-docs.md`

---

## Purpose

Update the public Woven pricing page so the hosted model rate table includes the curated image, video, and music models that will be available through Woven credits.

The page should make clear that hosted credits cover more than chat models: users can also spend credits on image generation, video generation, and ElevenLabs music generation. The actual backend job admission and settlement will still use `model_pricing_rules`; the public page is a readable published rate card.

## Decisions

- Only update `/pricing`. Do not add a compact pricing preview to the homepage in this spec.
- Keep the pricing page static and SEO-friendly. Do not fetch Supabase or `/api/v1/media/models` at request time.
- Move pricing-page row data out of `app/pricing/page.tsx` into a typed module so media rows do not make the page file a long config file.
- Keep chat token models, tools/features, and media models as separate table groups under the existing "Hosted model rates" area.
- Apply Woven's expected hosted-media markup to public media prices. Current default is 20%.
- List media model families when variants share pricing. The row notes should show included variants instead of creating a noisy row for every endpoint path.
- Use Woven USD prices, not raw provider prices, in the public table.

## Pricing Rows

### Image Models

| Public row | Included models | Public rate |
| --- | --- | --- |
| GPT Image 2 | `openai/gpt-image-2`, `openai/gpt-image-2/edit` | Text tokens: $6.00/M input, $1.50/M cached, $12.00/M output. Image tokens: $9.60/M input, $2.40/M cached, $36.00/M output. Actual request cost depends on size and quality. |
| Nano Banana Pro | `fal-ai/nano-banana-pro` | $0.18/image. 4K: $0.36/image. Web search: +$0.018/request. |

### Video Models

| Public row | Included models | Public rate |
| --- | --- | --- |
| Gemini Omni Flash | text-to-video, image-to-video, reference-to-video, edit | $1.20/generation, 3-10 seconds. This treats Fal's "$1 per unit" as one generation unit; if billing exports show a different unit basis, update this row before publishing. |
| Veo 3.1 | text-to-video, image-to-video, first/last frame, reference-to-video | 720p/1080p: $0.24/sec without audio, $0.48/sec with audio. 4K: $0.48/sec without audio, $0.72/sec with audio. |
| Veo 3.1 Fast | text-to-video, image-to-video, first/last frame | 720p/1080p: $0.12/sec without audio, $0.18/sec with audio. 4K: $0.36/sec without audio, $0.42/sec with audio. |
| Seedance 2.0 | text-to-video, image-to-video, reference-to-video | From $0.36/sec at 720p. 1080p: $0.82/sec. Reference/video-input variants may price differently; show exact estimate in app before job submission. |
| Seedance 2.0 Fast | text-to-video, image-to-video, reference-to-video | From $0.29/sec at 720p. Reference/video-input variants may price differently; show exact estimate in app before job submission. |
| Kling v3 Pro | text-to-video, image-to-video | $0.13/sec audio off, $0.20/sec audio on, $0.24/sec with voice control. |
| Kling v3 Standard | text-to-video, image-to-video | $0.10/sec audio off, $0.15/sec audio on, $0.18/sec with voice control. |

### Music

| Public row | Included models | Public rate |
| --- | --- | --- |
| Eleven Music v2 | `music_v2` | $0.20/minute, $0.20 minimum, up to 5 minutes. |

## Page Design

The existing `/pricing` page keeps its subscription card and hosted credits add-on. The "Hosted model rates" section changes from one chat-model table into grouped hosted-rate tables:

1. **Chat models**: current token table.
2. **Media models**: new table with columns `Model`, `Capability`, `Rate`, and `Notes`.
3. **Other features**: existing table for auto captions, web search, and web fetch.

Desktop should use compact tables similar to the current page. Mobile should keep the current card-per-row pattern so long rate strings do not overflow.

Media rows should be concise. Detailed caveats belong in the `Notes` column, not in paragraph copy above the table.

## Data Shape

Create a typed pricing data module, for example `lib/pricing-page-rates.ts`, with separate exported arrays:

- `chatModelRates`
- `mediaModelRates`
- `featureRates`

Suggested media row type:

```ts
type MediaModelRate = {
  name: string;
  capability: string;
  modelIds: string[];
  rate: string;
  notes: string;
};
```

`app/pricing/page.tsx` imports the arrays and renders them. This avoids introducing runtime data fetching and keeps the page compatible with static metadata/rendering in Next.js.

## Backend Contract

This spec does not change public API routes.

The actual backend media model catalog should still expose pricing through `GET /api/v1/media/models` using the existing `estimated_price` object. Job creation should continue to reserve credits from backend pricing rows, not from the static marketing table.

The implementation plan for backend model seeding should ensure `model_pricing_rules` rows match the public rate card. If a provider rate is too complex for a single public row, the backend can still provide exact estimates during job creation while the pricing page publishes a clear "from" rate.

## Error Handling

Because `/pricing` is static, there is no runtime pricing fetch failure. The main risk is stale public pricing. To reduce drift:

- Keep the source docs digest linked from this spec.
- Keep media rates in one typed module rather than inline JSX.
- Add a short comment in the data module that prices are Woven public rates after hosted markup and must stay aligned with `model_pricing_rules`.

## Testing

Implementation should include:

- A unit test for the pricing data module to verify media rows exist for GPT Image 2, Nano Banana Pro, Gemini Omni Flash, Veo 3.1, Seedance 2.0, Kling v3, and Eleven Music v2.
- A rendering test or build check that `/pricing` imports and renders the new media table without dynamic data access.
- Existing media pricing tests remain backend-focused and should not be coupled to the public marketing table.

## Out Of Scope

- Homepage pricing preview.
- Dynamic pricing fetched from Supabase.
- A public price-estimation calculator.
- Changes to `/api/v1/media/models`.
- Backend seed migration for the curated media model rows.
- `woven-harness` UI changes.

## Risks

- **Provider pricing drift:** Fal and ElevenLabs can change pricing. Keep public rates isolated in one module and update docs digest when refreshing.
- **Complex per-request costs:** GPT Image 2 and Seedance can vary by tokens, size, quality, or resolution. The pricing page should publish representative or tokenized rates and rely on the in-app estimate before job creation for exact cost.
- **Omni Flash unit ambiguity:** Fal currently says "$1 per units". The spec treats that as one generation unit; if billing exports show a different unit basis, update the public rate before publishing.
