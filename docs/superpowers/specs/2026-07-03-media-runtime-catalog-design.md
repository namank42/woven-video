# Media Runtime Catalog Design

**Date:** 2026-07-03
**Status:** Approved design - pending written-spec review
**Repo scope:** `woven-video` backend/API, Supabase catalog rows, media worker provider mapping, billing estimates, and tests. `woven-harness` is a downstream consumer and is not implemented here.
**Docs digest:** `docs/superpowers/research/2026-07-03-media-runtime-catalog-docs.md`

---

## Purpose

Turn the hosted media backend from a placeholder catalog into a production catalog that exposes the
same curated Woven-credit media models shown on the pricing page.

The work must make `GET /api/v1/media/models` useful to agents and tools, not just nonempty. A
downstream client should be able to discover which model IDs are available, which parameters are
valid, which uploaded inputs are required, what roles those inputs play, and what the job is expected
to cost before submission.

## Decisions Locked

- Use `lib/pricing-page-rates.ts` as the candidate source for public model IDs.
- Keep Supabase `model_pricing_rules` as the runtime catalog source. Production readiness means the
  catalog rows exist in the database, are enabled, and carry all metadata needed by the worker.
- Use the exact Fal endpoint IDs as public IDs for Fal-backed models. Do not route GPT Image 2
  through a custom OpenAI adapter; Fal exposes `openai/gpt-image-2` and `openai/gpt-image-2/edit`.
- Keep `music_v2` as the public ID for ElevenLabs Music v2 to match the pricing page.
- Keep existing bearer auth requirements for media catalog and media jobs.
- Keep the app polling Woven job status. The app does not poll Fal directly. The Woven media worker
  polls Supabase for queued/waiting jobs and uses Fal queue status/result; Fal webhooks can wake or
  update Woven state but do not replace the Woven status API.
- Preserve `input_asset_ids` for backward compatibility on simple single-input models, but introduce
  role-aware `input_assets` as the production request shape.
- Do not accept raw provider URL parameters from users for media inputs. User media inputs must be
  uploaded as Woven media assets and mapped by backend-controlled roles.
- Narrow provider parameter options when needed for predictable billing. In particular, Seedance
  public schemas should not expose `duration: "auto"` because exact pre-run estimates require an
  explicit duration.
- No live Fal or ElevenLabs calls are required in CI. Unit and Supabase integration tests must prove
  catalog shape, validation, pricing, and worker input mapping.

## Non-Goals

- No `woven-harness` code changes in this repo.
- No BYOK provider credentials.
- No arbitrary provider model proxy.
- No in-app provider-key selection.
- No generic raw-URL ingestion for provider inputs.
- No support for Kling's advanced `elements` media object in the first catalog contract. The
  production contract supports Kling's core start/end image flow; `elements` requires a nested asset
  grouping API and should not be exposed as a free-form URL parameter.

## Model Coverage

The production catalog should include enabled rows for every pricing-page model ID that can be
represented by the first catalog contract:

- `openai/gpt-image-2`
- `openai/gpt-image-2/edit`
- `fal-ai/nano-banana-pro`
- `google/nano-banana-2-lite`
- `google/nano-banana-2-lite/edit`
- `fal-ai/gemini-omni-flash`
- `fal-ai/gemini-omni-flash/image-to-video`
- `fal-ai/gemini-omni-flash/reference-to-video`
- `fal-ai/gemini-omni-flash/edit`
- `fal-ai/veo3.1`
- `fal-ai/veo3.1/image-to-video`
- `fal-ai/veo3.1/first-last-frame-to-video`
- `fal-ai/veo3.1/reference-to-video`
- `fal-ai/veo3.1/fast`
- `fal-ai/veo3.1/fast/image-to-video`
- `fal-ai/veo3.1/fast/first-last-frame-to-video`
- `bytedance/seedance-2.0/text-to-video`
- `bytedance/seedance-2.0/image-to-video`
- `bytedance/seedance-2.0/reference-to-video`
- `bytedance/seedance-2.0/fast/text-to-video`
- `bytedance/seedance-2.0/fast/image-to-video`
- `bytedance/seedance-2.0/fast/reference-to-video`
- `fal-ai/kling-video/v3/pro/text-to-video`
- `fal-ai/kling-video/v3/pro/image-to-video`
- `fal-ai/kling-video/v3/standard/text-to-video`
- `fal-ai/kling-video/v3/standard/image-to-video`
- `music_v2`

The Nano Banana Pro row should be marked as text-to-image only because the documented candidate
endpoint does not accept uploaded image inputs.

The Nano Banana Lite rows should expose both documented Fal endpoints. The base row is
text-to-image only. The `/edit` row should require Woven uploaded `reference_images` mapped to
Fal's `image_urls`; even though Fal marks `image_urls` optional, Woven should keep the edit catalog
semantically distinct from text-to-image.

## Public API Shape

### Catalog

`GET /api/v1/media/models` should continue returning only enabled curated media models. It should
also support filters:

- `?kind=image`
- `?kind=video`
- `?kind=audio`
- `?operation=image_generation`
- `?operation=video_generation`
- `?operation=music_generation`

Unknown filter values should return `400 invalid_media_input`, not silently return all models.

Each catalog model should include:

```json
{
  "id": "fal-ai/veo3.1/image-to-video",
  "provider": "fal",
  "kind": "video",
  "operation": "video_generation",
  "display_name": "Veo 3.1 Image to Video",
  "enabled": true,
  "supports_uploaded_inputs": true,
  "supported_input_types": ["image"],
  "output_types": ["video"],
  "estimated_price": {
    "unit": "second",
    "minimum_usd_micros": 0,
    "reserve_usd_micros": 5760000,
    "markup_bps": 2000,
    "estimate_kind": "parameter_quote"
  },
  "default_parameters": {
    "duration": "8s",
    "resolution": "720p",
    "generate_audio": true
  },
  "parameter_schema": {},
  "input_asset_schema": {
    "roles": [
      {
        "role": "image",
        "media_kind": "image",
        "required": true,
        "min": 1,
        "max": 1,
        "content_type_prefixes": ["image/"]
      }
    ]
  }
}
```

The catalog response should not expose provider secrets, R2 keys, raw Fal queue IDs, or internal SQL
row IDs.

### Job Creation

`POST /api/v1/media/jobs` should accept the existing shape:

```json
{
  "model": "fal-ai/gemini-omni-flash/image-to-video",
  "input_asset_ids": ["asset_123"],
  "parameters": {
    "prompt": "make this a subtle cinematic shot"
  }
}
```

This remains valid only when the selected model has exactly one required uploaded-input role with a
maximum of one asset. The backend infers that role.

The production shape is:

```json
{
  "model": "fal-ai/veo3.1/first-last-frame-to-video",
  "input_assets": [
    { "asset_id": "asset_first", "role": "first_frame" },
    { "asset_id": "asset_last", "role": "last_frame" }
  ],
  "parameters": {
    "prompt": "a clean product reveal",
    "duration": "8s",
    "resolution": "720p",
    "generate_audio": false
  }
}
```

If both `input_assets` and `input_asset_ids` are present, the route should reject the request with
`400 invalid_media_input`. If role-aware inputs are required and the client sends ambiguous
`input_asset_ids`, the route should reject the request with `400 invalid_media_input`.

The job input stored in `generation_jobs.input` should include:

- `media_model_id`
- `operation`
- `parameters`
- `input_assets` as ordered `{ asset_id, role }` entries
- `input_asset_ids` for compatibility and existing attachment queries
- `pricing_quote` as the immutable estimate used for reservation and settlement fallback

## Input Asset Roles

The first production contract supports these roles:

| Role | Provider field | Media kind | Cardinality |
| --- | --- | --- | --- |
| `image` | `image_url` | image | exactly 1 |
| `reference_images` | `image_urls` | image | 1..N, endpoint-limited |
| `mask` | `mask_url` | image | 0..1 |
| `first_frame` | `first_frame_url` | image | exactly 1 |
| `last_frame` | `last_frame_url` | image | exactly 1 |
| `start_image` | `start_image_url` | image | exactly 1 |
| `end_image` | `end_image_url` | image | 0..1 or exactly 1, endpoint-dependent |
| `video` | `video_url` | video | exactly 1 |
| `reference_videos` | `video_urls` | video | 0..3 for Seedance reference endpoints |
| `reference_audio` | `audio_urls` | audio | 0..3 for Seedance reference endpoints |

Validation must check ownership, upload completion, attachment status, media kind, allowed content
type prefixes, required roles, min/max counts, duplicate asset IDs, and role ordering for array
fields. Reference arrays preserve request order.

## Parameter Schema

The current schema only validates shallow JavaScript types. The production schema should be a
JSON-Schema-compatible subset that agents can consume directly:

- `type`: scalar type or a limited union.
- `required`: required object keys.
- `properties`: nested property schemas.
- `additionalProperties`: false by default for model parameters.
- `enum`: allowed string, number, boolean, or null values.
- `minimum` and `maximum`: numeric bounds.
- `minLength` and `maxLength`: string bounds.
- `minItems` and `maxItems`: array bounds.
- `items`: array item schema.
- `anyOf` or `oneOf`: limited support for fields such as GPT Image 2 `image_size`.
- `constraints`: named cross-field constraints for cases such as Kling `prompt` xor
  `multi_prompt`.
- `default`: public default value.
- `description`: short agent-facing description.

The backend validator should reject unknown parameters, invalid enum values, out-of-range values,
wrong scalar types, invalid nested object shapes, invalid array counts, and violated constraints.

Provider URL fields such as `image_url`, `video_url`, `first_frame_url`, and `audio_urls` should not
appear as user-settable parameters. They are generated from `input_assets`.

## Provider Input Mapping

The Fal adapter should build provider input in this order:

1. Start with curated `default_parameters`.
2. Merge validated user parameters.
3. Add provider asset fields generated from signed Woven media URLs and the model's
   `input_asset_schema`.

For example:

- `image` maps to `image_url`.
- `reference_images` maps to `image_urls`.
- `first_frame` and `last_frame` map to `first_frame_url` and `last_frame_url`.
- `start_image` and `end_image` map to `start_image_url` and `end_image_url`.
- `video` maps to `video_url`.
- `reference_videos` maps to `video_urls`.
- `reference_audio` maps to `audio_urls`.

The generic `input_urls` fallback should not be used for production catalog rows. Rows may keep
explicit `fal_output_paths`, usually `images` for image endpoints and `video` for video endpoints.

The ElevenLabs adapter should keep its operation-specific request shape and set
`modelId: "music_v2"` for Music v2.

## Pricing And Reservation

Job creation should compute a quote before reservation:

```json
{
  "estimate_kind": "parameter_quote",
  "provider_cost_usd_micros": 3200000,
  "charged_amount_usd_micros": 3840000,
  "reserved_amount_usd_micros": 3840000,
  "formula": "veo_seconds",
  "inputs": {
    "duration_seconds": 8,
    "resolution": "720p",
    "generate_audio": true
  }
}
```

The quote should be stored in `generation_jobs.input.pricing_quote`. The worker should settle with a
verified provider-reported raw cost when available. If the provider does not report a usable raw
cost, the worker should settle from the immutable quote instead of falling back to a flat static
minimum.

Estimator groups:

- Nano Banana Pro: image count, 4K multiplier, and web search add-on.
- Nano Banana Lite: image count, using Fal's documented `$1 per units` as a per-output-image
  provider unit for safe reservation.
- Gemini Omni Flash: generation unit.
- Veo 3.1 and Veo 3.1 Fast: duration, audio flag, resolution, fast/standard variant.
- Seedance 2.0 and Seedance 2.0 Fast: explicit duration, resolution, fast/standard variant, and
  reference-video pricing where documented.
- Kling v3 Pro and Standard: duration, audio flag, and standard/pro variant.
- ElevenLabs Music v2: music length in milliseconds with a $0.20/min Woven policy and $0.20 minimum.
- GPT Image 2: conservative quote based on public Woven token-rate policy, image count, quality, and
  size class. The catalog should mark this as `estimate_kind: "conservative_quote"`.

The pricing-page values are Woven public rates after markup. Implementation can store raw provider
rates plus `markup_bps: 2000`, or store Woven quote formulas directly, but tests must prove returned
estimates match the pricing page policy.

## Supabase Catalog Rows

Replace the disabled launch placeholder with a real catalog seed migration. Each enabled row must
define:

- `provider`
- `model`
- `operation`
- `display_name`
- `markup_bps`
- `minimum_charge_usd_micros`
- `reserve_amount_usd_micros`
- `enabled`
- `metadata.public_id`
- `metadata.provider_endpoint`
- `metadata.kind`
- `metadata.supports_uploaded_inputs`
- `metadata.supported_input_types`
- `metadata.output_types`
- `metadata.default_parameters`
- `metadata.parameter_schema`
- `metadata.input_asset_schema`
- `metadata.pricing_formula`
- `metadata.fal_output_paths` for Fal-backed models

The migration should be idempotent with `on conflict (provider, model, operation) do update`.
Production deploy should not require manually enabling placeholder rows.

## Documentation And Operations

Update the media worker deployment docs so they describe:

- the real catalog seed,
- required provider and R2 environment variables,
- local DB catalog smoke tests,
- production migration/deploy order,
- model-list smoke checks,
- job-create smoke checks that avoid live provider spend unless explicitly requested.

The docs should remove or revise instructions that tell the operator to manually enable the old
launch placeholder.

## Testing Requirements

Unit tests should cover:

- parsing model rows with `input_asset_schema`, extended `parameter_schema`, and `pricing_formula`;
- rejecting malformed schema metadata;
- filtering `GET /api/v1/media/models` by `kind` and `operation`;
- rejecting invalid filter values;
- validating enums, bounds, arrays, nested objects, unions, and cross-field constraints;
- parsing `input_assets` and preserving backward compatibility for simple `input_asset_ids`;
- rejecting ambiguous or conflicting uploaded inputs;
- estimating cost for each pricing formula group;
- ensuring all `mediaModelRates.modelIds` are represented in the catalog seed;
- mapping signed Woven input assets to provider-specific Fal fields;
- not sending generic `input_urls` for production catalog rows;
- settling from stored quote when provider raw cost is unavailable.

Supabase integration tests should cover:

- all seeded pricing-page model IDs are visible through `listMediaModels()`;
- enabled rows have valid metadata, input roles, output paths, and pricing formulas;
- DB rows do not expose the disabled launch placeholder as the only available model;
- a role-aware media job can be created with attached uploaded assets and a reserved amount derived
  from the quote.

Verification commands:

- `pnpm test`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm run test:media-db` after local Supabase is running with migrations applied

## Acceptance Criteria

- Local `/api/v1/media/models` returns nonempty image, video, and audio model catalogs when called
  with a valid local bearer token.
- `/api/v1/media/models?kind=image` returns only image models.
- `/api/v1/media/models?kind=video` returns only video models.
- `/api/v1/media/models?operation=music_generation` returns `music_v2`.
- Every public model ID from `lib/pricing-page-rates.ts` appears in the enabled runtime catalog.
- Kling `elements` and raw provider URL parameters are intentionally absent from the first public
  parameter schema.
- Agents can infer required uploaded inputs from `input_asset_schema`.
- Jobs with role-aware uploaded inputs submit provider payloads with correct Fal field names.
- Jobs reserve and settle from parameter-aware quotes.
- The old disabled placeholder is no longer the reason the local catalog is empty.
- Production deploy can run migrations and immediately expose the real catalog without manual DB
  edits.
