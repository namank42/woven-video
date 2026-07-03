# Media Runtime Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the production hosted-media runtime catalog so Woven-credit media models from the pricing page are enabled in Supabase, discoverable by agents, validated with real schemas, mapped to provider inputs correctly, and reserved/settled from parameter-aware quotes.

**Architecture:** Keep Supabase `model_pricing_rules` as the runtime source of truth, but expand parsed metadata into typed schemas, role-aware uploaded-input contracts, output extraction, and pricing formulas. Next.js route handlers stay thin authenticated control-plane endpoints; the media worker signs Woven media asset URLs, maps them into provider-specific Fal fields, and settles from provider-reported cost or the immutable job quote. The plan preserves the legacy `input_asset_ids` shape only for unambiguous single-input models.

**Tech Stack:** Next.js 16.2.3 App Router route handlers, Supabase SQL migrations and supabase-js admin client, Vitest, `@fal-ai/client@1.10.1`, `@elevenlabs/elevenlabs-js@2.55.0`, Cloudflare R2 media Worker contract.

**Docs digest:** `docs/superpowers/research/2026-07-03-media-runtime-catalog-docs.md`; local Next route-handler docs read from `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`, and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md`.

## Global Constraints

- Use `lib/pricing-page-rates.ts` as the candidate source for public model IDs.
- Keep Supabase `model_pricing_rules` as the runtime catalog source.
- Use exact Fal endpoint IDs as public IDs for Fal-backed models.
- Keep `music_v2` as the public ID for ElevenLabs Music v2.
- Keep existing bearer auth requirements for media catalog and media jobs.
- The app polls Woven job status. The app does not poll Fal directly.
- Preserve `input_asset_ids` only for simple single-input models; introduce `input_assets` as the production shape.
- Do not accept raw provider URL parameters from users for media inputs.
- Seedance public schemas must not expose `duration: "auto"`.
- No live Fal or ElevenLabs calls are required in CI.
- Next route handlers must keep the existing `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"` pattern.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `lib/pricing-page-rates.ts` | Modify | Add Nano Banana Lite public model IDs to the pricing-page candidate source |
| `lib/media/types.ts` | Modify | Add rich parameter schema, input asset schema, pricing formula, and quote types |
| `lib/media/model-registry.ts` | Modify | Parse new metadata and support kind/operation filtering |
| `tests/media/model-registry.test.ts` | Modify | Cover rich metadata parsing and malformed metadata rejection |
| `lib/media/schema.ts` | Modify | Validate JSON-Schema-compatible media parameters |
| `tests/media/schema.test.ts` | Modify | Cover enums, ranges, arrays, unions, and named constraints |
| `lib/media/pricing-quotes.ts` | Create | Compute immutable parameter-aware media quotes |
| `lib/media/pricing.ts` | Modify | Reserve and settle from quotes when provider cost is unavailable |
| `tests/media/pricing.test.ts` | Modify | Cover quote formulas and settlement fallback |
| `lib/media/input-assets.ts` | Create | Parse and validate role-aware job input assets |
| `app/api/v1/media/jobs/route.ts` | Modify | Accept `input_assets`, reject ambiguous input, pass parsed input to job creation |
| `lib/media/jobs.ts` | Modify | Store input roles, quote, and compatibility `input_asset_ids` |
| `tests/media/job-routes.test.ts` | Modify | Cover job route input parsing and response shape |
| `tests/media/jobs.test.ts` | Modify | Cover role validation, attachment, and quote reservation |
| `lib/media/provider.ts` | Modify | Pass signed input assets with roles to adapters |
| `lib/media/worker.ts` | Modify | Sign role-aware input assets and settle from stored quote |
| `lib/media/providers/fal.ts` | Modify | Map Woven input roles to Fal provider fields |
| `tests/media/provider-adapters.test.ts` | Modify | Cover Fal role mapping and no generic `input_urls` for production rows |
| `app/api/v1/media/models/route.ts` | Modify | Return `operation`, `input_asset_schema`, `estimate_kind`, and filters |
| `tests/media/model-catalog-route.test.ts` | Modify | Cover filters and public catalog shape |
| `supabase/migrations/20260703180000_seed_media_runtime_catalog.sql` | Create | Seed enabled production catalog rows |
| `tests/media/catalog-seed.test.ts` | Create | Assert migration covers every pricing-page model ID |
| `tests/media/db-rpcs.integration.test.ts` | Modify | Assert local DB exposes seeded media catalog rows |
| `docs/media-worker-deploy.md` | Modify | Replace placeholder enablement with real catalog deploy and smoke checks |

---

### Task 1: Add Rich Media Catalog Types And Metadata Parsing

**Files:**
- Modify: `lib/media/types.ts`
- Modify: `lib/media/model-registry.ts`
- Test: `tests/media/model-registry.test.ts`

**Interfaces:**
- Produces: `MediaInputAssetSchema`, `MediaPricingFormula`, `MediaPricingQuote`, richer `MediaParameterSchema`, and `listMediaModels(filters?)`.
- Consumes: existing `ModelPricingRule` rows and `metadata`.

- [ ] **Step 1: Write the failing registry tests**

Append to `tests/media/model-registry.test.ts`:

```ts
  it("parses rich catalog metadata for production media models", () => {
    const model = parseMediaModel(validRule({
      metadata: {
        input_asset_schema: {
          roles: [{
            role: "first_frame",
            provider_field: "first_frame_url",
            media_kind: "image",
            required: true,
            min: 1,
            max: 1,
            content_type_prefixes: ["image/"],
          }],
        },
        pricing_formula: {
          type: "veo_seconds",
          rates: {
            default: { no_audio: "0.20", audio: "0.40" },
            "4k": { no_audio: "0.40", audio: "0.60" },
          },
          duration_parameter: "duration",
          audio_parameter: "generate_audio",
          resolution_parameter: "resolution",
        },
        parameter_schema: {
          type: "object",
          required: ["prompt"],
          additionalProperties: false,
          properties: {
            prompt: { type: "string", minLength: 1 },
            duration: { type: "string", enum: ["4s", "6s", "8s"], default: "8s" },
          },
        },
      },
    }));

    expect(model?.inputAssetSchema.roles).toEqual([{
      role: "first_frame",
      providerField: "first_frame_url",
      mediaKind: "image",
      required: true,
      min: 1,
      max: 1,
      contentTypePrefixes: ["image/"],
    }]);
    expect(model?.pricingFormula).toMatchObject({ type: "veo_seconds" });
    expect(model?.parameterSchema.properties?.duration).toMatchObject({
      enum: ["4s", "6s", "8s"],
      default: "8s",
    });
  });

  it("excludes rows with malformed input asset schema metadata", () => {
    expect(parseMediaModel(validRule({
      metadata: {
        input_asset_schema: {
          roles: [{
            role: "",
            provider_field: "image_url",
            media_kind: "image",
            required: true,
            min: 1,
            max: 1,
            content_type_prefixes: ["image/"],
          }],
        },
      },
    }))).toBeNull();
  });

  it("excludes rows with malformed pricing formula metadata", () => {
    expect(parseMediaModel(validRule({
      metadata: {
        pricing_formula: { type: "" },
      },
    }))).toBeNull();
  });
```

- [ ] **Step 2: Run the registry tests to verify they fail**

Run: `pnpm exec vitest run tests/media/model-registry.test.ts`

Expected: FAIL because `MediaModel` does not expose `inputAssetSchema` or `pricingFormula`, and the parser still rejects rich parameter schema properties such as `enum`.

- [ ] **Step 3: Extend `lib/media/types.ts`**

Replace the current `MediaParameterSchema` type block and add these exported types before `MediaModel`:

```ts
export type MediaParameterPrimitiveType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export type MediaParameterConstraint =
  | { type: "exactly_one"; fields: string[]; message?: string }
  | { type: "at_least_one"; fields: string[]; message?: string };

export type MediaParameterPropertySchema = {
  type?: MediaParameterPrimitiveType | MediaParameterPrimitiveType[];
  enum?: Array<string | number | boolean | null>;
  required?: string[];
  properties?: Record<string, MediaParameterPropertySchema>;
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: MediaParameterPropertySchema;
  anyOf?: MediaParameterPropertySchema[];
  oneOf?: MediaParameterPropertySchema[];
  default?: unknown;
  description?: string;
};

export type MediaParameterSchema = MediaParameterPropertySchema & {
  type: "object";
  required?: string[];
  properties?: Record<string, MediaParameterPropertySchema>;
  constraints?: MediaParameterConstraint[];
};

export type MediaInputAssetRole = {
  role: string;
  providerField: string;
  mediaKind: "image" | "video" | "audio";
  required: boolean;
  min: number;
  max: number;
  contentTypePrefixes: string[];
};

export type MediaInputAssetSchema = {
  roles: MediaInputAssetRole[];
};

export type MediaPricingFormula = {
  type:
    | "static"
    | "flat_generation"
    | "nano_banana"
    | "gemini_unit"
    | "veo_seconds"
    | "seedance_seconds"
    | "kling_seconds"
    | "music_minutes"
    | "gpt_image_conservative";
  [key: string]: unknown;
};

export type MediaPricingQuote = {
  estimateKind: "static" | "parameter_quote" | "conservative_quote";
  providerCostUsdMicros: number;
  chargedAmountUsdMicros: number;
  reservedAmountUsdMicros: number;
  markupAmountUsdMicros: number;
  formula: string;
  inputs: Record<string, unknown>;
};
```

Then add these fields to `MediaModel`:

```ts
  inputAssetSchema: MediaInputAssetSchema;
  pricingFormula: MediaPricingFormula;
```

Update every existing `MediaModel` fixture in `tests/media/*.test.ts` that TypeScript checks by
adding:

```ts
inputAssetSchema: { roles: [] },
pricingFormula: { type: "static" },
```

- [ ] **Step 4: Extend metadata parsing in `lib/media/model-registry.ts`**

Import the new types and replace the narrow `PARAMETER_TYPES` handling with rich schema validation. Add helpers with these signatures:

```ts
function inputAssetSchemaValue(value: unknown): MediaInputAssetSchema | null
function pricingFormulaValue(value: unknown): MediaPricingFormula | null
function parameterSchemaValue(value: unknown): MediaParameterSchema | null
function parameterPropertySchemaValue(value: unknown): MediaParameterPropertySchema | null
function primitiveTypeValue(value: unknown): MediaParameterPrimitiveType | null
```

The helpers must:

- Default missing `input_asset_schema` to `{ roles: [] }`.
- Default missing `pricing_formula` to `{ type: "static" }`.
- Convert snake-case role metadata to camel-case runtime fields.
- Reject empty role names, empty provider fields, invalid media kinds, negative counts, `max < min`, and non-string content type prefixes.
- Accept `type: "integer"`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `items`, `anyOf`, `oneOf`, `default`, and `description`.
- Keep `metadata` unchanged for lower-level provider code.

In `parseMediaModel`, parse and return:

```ts
  const inputAssetSchema = inputAssetSchemaValue(metadata.input_asset_schema);
  const pricingFormula = pricingFormulaValue(metadata.pricing_formula);

  if (
    !publicId ||
    !providerEndpoint ||
    !kind ||
    !provider ||
    !operation ||
    !parameterSchema ||
    !inputAssetSchema ||
    !pricingFormula
  ) {
    return null;
  }
```

Add to the returned object:

```ts
    inputAssetSchema,
    pricingFormula,
```

- [ ] **Step 5: Add catalog filtering support**

Change `listMediaModels` to accept optional filters:

```ts
export type MediaModelFilters = {
  kind?: MediaKind;
  operation?: MediaOperation;
};

export async function listMediaModels(filters: MediaModelFilters = {}): Promise<MediaModel[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("model_pricing_rules")
    .select(SELECT_COLUMNS)
    .in("operation", [...MEDIA_OPERATIONS])
    .eq("enabled", true)
    .order("display_name");

  if (filters.operation) {
    query = query.eq("operation", filters.operation);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((rule) => parseMediaModel(rule as ModelPricingRule))
    .filter(isMediaModel)
    .filter((model) => !filters.kind || model.kind === filters.kind);
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run tests/media/model-registry.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/media/types.ts lib/media/model-registry.ts tests/media/model-registry.test.ts
git commit -m "feat: parse rich media catalog metadata"
```

---

### Task 2: Validate Rich Media Parameter Schemas

**Files:**
- Modify: `lib/media/schema.ts`
- Test: `tests/media/schema.test.ts`

**Interfaces:**
- Consumes: `MediaParameterSchema` from Task 1.
- Produces: `validateMediaParameters(parameters, schema)` with enum/range/array/union/constraint validation.

- [ ] **Step 1: Write failing schema tests**

Append to `tests/media/schema.test.ts`:

```ts
  it("rejects enum values outside the model schema", () => {
    expect(validateMediaParameters(
      { duration: "12s" },
      {
        type: "object",
        properties: { duration: { type: "string", enum: ["4s", "6s", "8s"] } },
      },
    )).toEqual({
      ok: false,
      error: "Invalid parameter value for duration: expected one of 4s, 6s, 8s.",
    });
  });

  it("validates integer and numeric bounds", () => {
    expect(validateMediaParameters(
      { num_images: 2 },
      {
        type: "object",
        properties: { num_images: { type: "integer", minimum: 1, maximum: 4 } },
      },
    )).toEqual({ ok: true, value: { num_images: 2 } });

    expect(validateMediaParameters(
      { num_images: 2.5 },
      {
        type: "object",
        properties: { num_images: { type: "integer", minimum: 1, maximum: 4 } },
      },
    )).toEqual({
      ok: false,
      error: "Invalid parameter type for num_images: expected integer.",
    });

    expect(validateMediaParameters(
      { num_images: 5 },
      {
        type: "object",
        properties: { num_images: { type: "integer", minimum: 1, maximum: 4 } },
      },
    )).toEqual({
      ok: false,
      error: "Invalid parameter value for num_images: expected <= 4.",
    });
  });

  it("validates arrays and nested object items", () => {
    expect(validateMediaParameters(
      { multi_prompt: [{ timestamp: 0, prompt: "open" }] },
      {
        type: "object",
        properties: {
          multi_prompt: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              type: "object",
              required: ["timestamp", "prompt"],
              additionalProperties: false,
              properties: {
                timestamp: { type: "number", minimum: 0 },
                prompt: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    )).toEqual({ ok: true, value: { multi_prompt: [{ timestamp: 0, prompt: "open" }] } });
  });

  it("supports oneOf for GPT image_size", () => {
    const schema = {
      type: "object" as const,
      properties: {
        image_size: {
          oneOf: [
            { type: "string", enum: ["square", "landscape_16_9", "auto"] },
            {
              type: "object",
              required: ["width", "height"],
              additionalProperties: false,
              properties: {
                width: { type: "integer", minimum: 16, maximum: 3840 },
                height: { type: "integer", minimum: 16, maximum: 3840 },
              },
            },
          ],
        },
      },
    };

    expect(validateMediaParameters({ image_size: "auto" }, schema)).toEqual({
      ok: true,
      value: { image_size: "auto" },
    });
    expect(validateMediaParameters({ image_size: { width: 1024, height: 768 } }, schema)).toEqual({
      ok: true,
      value: { image_size: { width: 1024, height: 768 } },
    });
  });

  it("validates named cross-field constraints", () => {
    const schema = {
      type: "object" as const,
      properties: {
        prompt: { type: "string" as const },
        multi_prompt: { type: "array" as const, minItems: 1 },
      },
      constraints: [{ type: "exactly_one" as const, fields: ["prompt", "multi_prompt"] }],
    };

    expect(validateMediaParameters({}, schema)).toEqual({
      ok: false,
      error: "Exactly one of prompt, multi_prompt is required.",
    });
    expect(validateMediaParameters({ prompt: "open", multi_prompt: [{ prompt: "close" }] }, schema)).toEqual({
      ok: false,
      error: "Exactly one of prompt, multi_prompt is required.",
    });
  });
```

- [ ] **Step 2: Run schema tests to verify they fail**

Run: `pnpm exec vitest run tests/media/schema.test.ts`

Expected: FAIL because the validator only checks shallow JavaScript types.

- [ ] **Step 3: Implement recursive validation**

Replace `lib/media/schema.ts` with a recursive validator that keeps the exported function signature:

```ts
import type {
  MediaParameterConstraint,
  MediaParameterPropertySchema,
  MediaParameterSchema,
} from "@/lib/media/types";

export function validateMediaParameters(
  parameters: unknown,
  schema: MediaParameterSchema,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    return { ok: false, error: "parameters must be a JSON object." };
  }

  const value = parameters as Record<string, unknown>;
  const result = validateObject(value, schema, "");
  if (!result.ok) return result;

  const constraint = validateConstraints(value, schema.constraints ?? []);
  if (!constraint.ok) return constraint;

  return { ok: true, value };
}
```

Add private helpers:

```ts
function validateObject(value: Record<string, unknown>, schema: MediaParameterSchema | MediaParameterPropertySchema, path: string) {
  for (const key of schema.required ?? []) {
    if (!(key in value)) return invalid(`Missing required parameter: ${joinPath(path, key)}.`);
  }

  const declared = new Set([...Object.keys(schema.properties ?? {}), ...(schema.required ?? [])]);
  if (schema.additionalProperties !== true) {
    for (const key of Object.keys(value)) {
      if (!declared.has(key)) return invalid(`Unknown parameter: ${joinPath(path, key)}.`);
    }
  }

  for (const [key, rule] of Object.entries(schema.properties ?? {})) {
    if (!(key in value)) continue;
    const result = validateValue(value[key], rule, joinPath(path, key));
    if (!result.ok) return result;
  }

  return ok();
}

function validateValue(value: unknown, schema: MediaParameterPropertySchema, path: string) {
  if (schema.oneOf) return validateAlternatives(value, schema.oneOf, path, "oneOf");
  if (schema.anyOf) return validateAlternatives(value, schema.anyOf, path, "anyOf");

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    return invalid(`Invalid parameter type for ${path}: expected ${types.join(" or ")}.`);
  }

  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    return invalid(`Invalid parameter value for ${path}: expected one of ${schema.enum.join(", ")}.`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return invalid(`Invalid parameter value for ${path}: expected >= ${schema.minimum}.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return invalid(`Invalid parameter value for ${path}: expected <= ${schema.maximum}.`);
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return invalid(`Invalid parameter value for ${path}: expected at least ${schema.minLength} characters.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return invalid(`Invalid parameter value for ${path}: expected at most ${schema.maxLength} characters.`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return invalid(`Invalid parameter value for ${path}: expected at least ${schema.minItems} items.`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return invalid(`Invalid parameter value for ${path}: expected at most ${schema.maxItems} items.`);
    }
    if (schema.items) {
      for (const [index, item] of value.entries()) {
        const result = validateValue(item, schema.items, `${path}[${index}]`);
        if (!result.ok) return result;
      }
    }
  }

  if (isRecord(value) && schema.properties) {
    const result = validateObject(value, schema, path);
    if (!result.ok) return result;
  }

  return ok();
}
```

Use these exact semantics for constraints:

```ts
function validateConstraints(value: Record<string, unknown>, constraints: MediaParameterConstraint[]) {
  for (const constraint of constraints) {
    const present = constraint.fields.filter((field) => value[field] !== undefined);
    if (constraint.type === "exactly_one" && present.length !== 1) {
      return invalid(constraint.message ?? `Exactly one of ${constraint.fields.join(", ")} is required.`);
    }
    if (constraint.type === "at_least_one" && present.length < 1) {
      return invalid(constraint.message ?? `At least one of ${constraint.fields.join(", ")} is required.`);
    }
  }
  return ok();
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/media/schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/media/schema.ts tests/media/schema.test.ts
git commit -m "feat: validate rich media parameters"
```

---

### Task 3: Add Parameter-Aware Media Pricing Quotes

**Files:**
- Create: `lib/media/pricing-quotes.ts`
- Modify: `lib/media/pricing.ts`
- Test: `tests/media/pricing.test.ts`

**Interfaces:**
- Consumes: `MediaModel.pricingFormula`, `MediaModel.pricing.markupBps`, and validated parameters.
- Produces: `quoteMediaJob({ model, parameters })` and quote-aware `reservationUsdMicros` / `chargeMediaUsdMicros`.

- [ ] **Step 1: Write failing quote tests**

Append to `tests/media/pricing.test.ts`:

```ts
import { quoteMediaJob } from "@/lib/media/pricing-quotes";

describe("quoteMediaJob", () => {
  it("quotes Nano Banana Pro from image count, 4K mode, and web search", () => {
    const quote = quoteMediaJob({
      model: mediaModel({
        id: "fal-ai/nano-banana-pro",
        pricingFormula: {
          type: "nano_banana",
          image_parameter: "num_images",
          resolution_parameter: "resolution",
          web_search_parameter: "enable_web_search",
          provider_rate_usd_per_image: "0.15",
          provider_rate_usd_per_web_search: "0.015",
          four_k_multiplier: 2,
        },
      }),
      parameters: { num_images: 2, resolution: "4K", enable_web_search: true },
    });

    expect(quote).toMatchObject({
      estimateKind: "parameter_quote",
      providerCostUsdMicros: 630_000,
      chargedAmountUsdMicros: 756_000,
      reservedAmountUsdMicros: 756_000,
      formula: "nano_banana",
    });
  });

  it("quotes Nano Banana Lite from image count and provider unit pricing", () => {
    const quote = quoteMediaJob({
      model: mediaModel({
        id: "fal-ai/nano-banana-lite",
        pricingFormula: {
          type: "nano_banana",
          image_parameter: "num_images",
          provider_rate_usd_per_image: "1.00",
        },
      }),
      parameters: { num_images: 2 },
    });

    expect(quote).toMatchObject({
      estimateKind: "parameter_quote",
      providerCostUsdMicros: 2_000_000,
      chargedAmountUsdMicros: 2_400_000,
      reservedAmountUsdMicros: 2_400_000,
      formula: "nano_banana",
    });
  });

  it("quotes Veo seconds from duration, resolution, and audio", () => {
    const quote = quoteMediaJob({
      model: mediaModel({
        id: "fal-ai/veo3.1/image-to-video",
        pricing: { ...model.pricing, minimumUsdMicros: 0 },
        pricingFormula: {
          type: "veo_seconds",
          duration_parameter: "duration",
          resolution_parameter: "resolution",
          audio_parameter: "generate_audio",
          rates: {
            default: { no_audio: "0.20", audio: "0.40" },
            "4k": { no_audio: "0.40", audio: "0.60" },
          },
        },
      }),
      parameters: { duration: "8s", resolution: "720p", generate_audio: true },
    });

    expect(quote).toMatchObject({
      providerCostUsdMicros: 3_200_000,
      chargedAmountUsdMicros: 3_840_000,
      reservedAmountUsdMicros: 3_840_000,
      formula: "veo_seconds",
      inputs: { duration_seconds: 8, resolution: "720p", generate_audio: true },
    });
  });

  it("rejects Seedance auto duration because production quotes require explicit duration", () => {
    expect(() => quoteMediaJob({
      model: mediaModel({
        pricingFormula: {
          type: "seedance_seconds",
          duration_parameter: "duration",
          resolution_parameter: "resolution",
          rates: { "720p": "0.3034", "1080p": "0.682" },
        },
      }),
      parameters: { duration: "auto", resolution: "720p" },
    })).toThrow("media_quote_requires_explicit_duration");
  });

  it("settles from the stored quote when provider raw cost is unavailable", () => {
    expect(chargeMediaUsdMicros({
      model,
      rawCostUsd: 0,
      pricingQuote: {
        estimateKind: "parameter_quote",
        providerCostUsdMicros: 3_200_000,
        chargedAmountUsdMicros: 3_840_000,
        reservedAmountUsdMicros: 3_840_000,
        markupAmountUsdMicros: 640_000,
        formula: "veo_seconds",
        inputs: {},
      },
    })).toMatchObject({
      rawCostUsdMicros: 3_200_000,
      chargedAmountUsdMicros: 3_840_000,
      markupAmountUsdMicros: 640_000,
    });
  });
});
```

Add this helper at the bottom of the file:

```ts
function mediaModel(overrides: Partial<MediaModel> = {}): MediaModel {
  return {
    id: "fal-ai/test",
    provider: "fal",
    providerModel: "fal-ai/test",
    providerEndpoint: "fal-ai/test",
    operation: "video_generation",
    kind: "video",
    displayName: "Test Media Model",
    supportsUploadedInputs: false,
    supportedInputTypes: [],
    outputTypes: ["video"],
    defaultParameters: {},
    parameterSchema: { type: "object" },
    inputAssetSchema: { roles: [] },
    pricingFormula: { type: "static" },
    pricing: model.pricing,
    metadata: {},
    rule: {},
    ...overrides,
  } as MediaModel;
}
```

- [ ] **Step 2: Run pricing tests to verify they fail**

Run: `pnpm exec vitest run tests/media/pricing.test.ts`

Expected: FAIL because `lib/media/pricing-quotes.ts` does not exist and `chargeMediaUsdMicros` does not accept a stored quote.

- [ ] **Step 3: Create `lib/media/pricing-quotes.ts`**

Create the file with these public functions:

```ts
import { chargeWithMarkupUsdMicros, usdToMicrosCeil } from "@/lib/billing/money";
import type { MediaModel, MediaPricingQuote } from "@/lib/media/types";

export function quoteMediaJob({
  model,
  parameters,
}: {
  model: MediaModel;
  parameters: Record<string, unknown>;
}): MediaPricingQuote {
  const formula = model.pricingFormula;
  switch (formula.type) {
    case "nano_banana":
      return quoteProviderCost(model, "parameter_quote", "nano_banana", quoteNanoBananaProviderCost(formula, parameters), {
        num_images: integerParameter(parameters, stringValue(formula.image_parameter) ?? "num_images", 1),
        resolution: stringParameter(parameters, stringValue(formula.resolution_parameter) ?? "resolution", "1K"),
        enable_web_search: booleanParameter(parameters, stringValue(formula.web_search_parameter) ?? "enable_web_search", false),
      });
    case "gemini_unit":
      return quoteProviderCost(model, "parameter_quote", "gemini_unit", usdToMicrosCeil(stringValue(formula.provider_rate_usd_per_generation) ?? "1"), {});
    case "veo_seconds":
    case "seedance_seconds":
    case "kling_seconds":
      return quoteProviderCost(model, "parameter_quote", formula.type, quotePerSecondProviderCost(formula, parameters), quotePerSecondInputs(formula, parameters));
    case "music_minutes":
      return quoteMusic(model, formula, parameters);
    case "gpt_image_conservative":
      return quoteProviderCost(model, "conservative_quote", "gpt_image_conservative", quoteGptImageProviderCost(formula, parameters), {
        num_images: integerParameter(parameters, stringValue(formula.image_parameter) ?? "num_images", 1),
        quality: stringParameter(parameters, stringValue(formula.quality_parameter) ?? "quality", "high"),
      });
    case "flat_generation":
      return quoteProviderCost(model, "parameter_quote", "flat_generation", usdToMicrosCeil(stringValue(formula.provider_rate_usd) ?? "0"), {});
    case "static":
    default:
      return {
        estimateKind: "static",
        providerCostUsdMicros: model.pricing.reserveUsdMicros,
        chargedAmountUsdMicros: model.pricing.reserveUsdMicros,
        reservedAmountUsdMicros: model.pricing.reserveUsdMicros,
        markupAmountUsdMicros: 0,
        formula: "static",
        inputs: {},
      };
  }
}
```

The implementation must also include:

- `quoteProviderCost(model, estimateKind, formula, providerCostUsdMicros, inputs)` using `chargeWithMarkupUsdMicros`.
- `quoteNanoBananaProviderCost` using `provider_rate_usd_per_image`, `provider_rate_usd_per_web_search`, and `four_k_multiplier`.
  `provider_rate_usd_per_web_search`, `resolution_parameter`, `web_search_parameter`, and
  `four_k_multiplier` are optional so the same formula can represent Nano Banana Lite's
  image-count-only unit pricing.
- `quotePerSecondProviderCost` parsing `"8s"` and `"8"` durations, rejecting `"auto"` with `media_quote_requires_explicit_duration`, and reading either a flat `rates[resolution]` string or a nested `{ no_audio, audio }` map.
- `quoteMusic` returning public $0.20/min with a $0.20 minimum from `music_length_ms` or `musicLengthMs`.
- `quoteGptImageProviderCost` using metadata maps:
  - `provider_rate_usd_by_quality`
  - `image_parameter`
  - `quality_parameter`
  - default quality `high`
- `serializeMediaPricingQuote(quote)` returning snake-case JSON with `estimate_kind`,
  `provider_cost_usd_micros`, `charged_amount_usd_micros`, `reserved_amount_usd_micros`,
  `markup_amount_usd_micros`, `formula`, and `inputs`.
- `deserializeMediaPricingQuote(value)` returning `MediaPricingQuote | null` from the same
  snake-case JSON shape.

- [ ] **Step 4: Update `lib/media/pricing.ts`**

Change the functions to:

```ts
import { chargeWithMarkupUsdMicros } from "@/lib/billing/money";
import type { MediaModel, MediaPricingQuote } from "@/lib/media/types";

export function reservationUsdMicros(model: MediaModel, pricingQuote?: MediaPricingQuote): number {
  return pricingQuote?.reservedAmountUsdMicros ?? model.pricing.reserveUsdMicros;
}

export function chargeMediaUsdMicros({
  model,
  rawCostUsd,
  pricingQuote,
}: {
  model: MediaModel;
  rawCostUsd: number | string;
  pricingQuote?: MediaPricingQuote | null;
}) {
  const rawCost = Number(rawCostUsd);
  if ((!Number.isFinite(rawCost) || rawCost <= 0) && pricingQuote) {
    return {
      rawCostUsdMicros: pricingQuote.providerCostUsdMicros,
      chargedAmountUsdMicros: pricingQuote.chargedAmountUsdMicros,
      markupAmountUsdMicros: pricingQuote.markupAmountUsdMicros,
    };
  }

  return chargeWithMarkupUsdMicros({
    rawCostUsd,
    markupBps: model.pricing.markupBps,
    minimumChargeUsdMicros: model.pricing.minimumUsdMicros,
  });
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run tests/media/pricing.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/media/pricing-quotes.ts lib/media/pricing.ts tests/media/pricing.test.ts
git commit -m "feat: quote media jobs from parameters"
```

---

### Task 4: Parse And Store Role-Aware Job Input Assets

**Files:**
- Create: `lib/media/input-assets.ts`
- Modify: `app/api/v1/media/jobs/route.ts`
- Modify: `lib/media/jobs.ts`
- Test: `tests/media/job-routes.test.ts`
- Test: `tests/media/jobs.test.ts`

**Interfaces:**
- Produces: `MediaJobInputAsset`, `parseMediaJobInputAssets`, and role-aware `createReservedMediaJob`.
- Consumes: `MediaModel.inputAssetSchema` and `quoteMediaJob`.

- [ ] **Step 1: Write failing route tests**

Append to `tests/media/job-routes.test.ts`:

```ts
  it("passes role-aware input_assets to job creation", async () => {
    const createReservedMediaJob = vi.fn(async () => ({
      id: "job_1",
      status: "queued",
      model: "fal-ai/veo3.1/first-last-frame-to-video",
      estimatedCostUsdMicros: 3_840_000,
      reservedCreditsUsdMicros: 3_840_000,
      createdAt: "2026-07-01T12:00:00.000Z",
      expiresAt: "2026-07-01T13:00:00.000Z",
    }));

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({ ok: true, auth: { user: { id: "user_1" } } })),
    }));
    vi.doMock("@/lib/api/license", () => ({ licenseGateResponse: vi.fn(async () => null) }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal-ai/veo3.1/first-last-frame-to-video",
        parameterSchema: { type: "object" },
        inputAssetSchema: {
          roles: [
            { role: "first_frame", providerField: "first_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
            { role: "last_frame", providerField: "last_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
          ],
        },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({ ok: true, value: { prompt: "reveal" } })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({ createReservedMediaJob }));

    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal-ai/veo3.1/first-last-frame-to-video",
      parameters: { prompt: "reveal" },
      input_assets: [
        { asset_id: "asset_first", role: "first_frame" },
        { asset_id: "asset_last", role: "last_frame" },
      ],
    }));

    expect(response.status).toBe(200);
    expect(createReservedMediaJob).toHaveBeenCalledWith(expect.objectContaining({
      inputAssets: [
        { assetId: "asset_first", role: "first_frame" },
        { assetId: "asset_last", role: "last_frame" },
      ],
      inputAssetIds: ["asset_first", "asset_last"],
    }));
  });

  it("rejects requests that send both input_assets and input_asset_ids", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({ ok: true, auth: { user: { id: "user_1" } } })),
    }));
    vi.doMock("@/lib/api/license", () => ({ licenseGateResponse: vi.fn(async () => null) }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({ id: "model_1", parameterSchema: { type: "object" }, inputAssetSchema: { roles: [] } })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({ ok: true, value: {} })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({ createReservedMediaJob: vi.fn() }));

    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "model_1",
      input_asset_ids: ["asset_1"],
      input_assets: [{ asset_id: "asset_1", role: "image" }],
      parameters: {},
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_media_input" },
    });
  });
```

- [ ] **Step 2: Write failing job tests**

In the first `createReservedMediaJob` test in `tests/media/jobs.test.ts`, change the call to include role-aware inputs:

```ts
      inputAssets: [{ assetId: "asset_1", role: "image" }],
      inputAssetIds: ["asset_1"],
```

Then update the insert expectation to include:

```ts
        input_assets: [{ asset_id: "asset_1", role: "image" }],
        pricing_quote: {
          estimate_kind: "static",
          provider_cost_usd_micros: 500_000,
          charged_amount_usd_micros: 500_000,
          reserved_amount_usd_micros: 500_000,
          markup_amount_usd_micros: 0,
          formula: "static",
          inputs: {},
        },
```

Add a new test:

```ts
  it("rejects uploaded inputs that do not satisfy required roles", async () => {
    await expect(createReservedMediaJob({
      userId: "user_1",
      model: {
        ...model,
        inputAssetSchema: {
          roles: [
            { role: "first_frame", providerField: "first_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
            { role: "last_frame", providerField: "last_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
          ],
        },
      },
      parameters: { prompt: "a mountain" },
      inputAssets: [{ assetId: "asset_1", role: "first_frame" }],
      inputAssetIds: ["asset_1"],
    })).rejects.toThrow("invalid_media_input");
  });
```

- [ ] **Step 3: Run route and job tests to verify they fail**

Run: `pnpm exec vitest run tests/media/job-routes.test.ts tests/media/jobs.test.ts`

Expected: FAIL because `input_assets` is not parsed and `createReservedMediaJob` does not accept `inputAssets`.

- [ ] **Step 4: Create `lib/media/input-assets.ts`**

Create:

```ts
import type { MediaInputAssetSchema, MediaModel } from "@/lib/media/types";

export type MediaJobInputAsset = {
  assetId: string;
  role: string;
};

export function parseMediaJobInputAssets({
  model,
  inputAssets,
  inputAssetIds,
}: {
  model: Pick<MediaModel, "inputAssetSchema">;
  inputAssets: unknown;
  inputAssetIds: unknown;
}): { ok: true; inputAssets: MediaJobInputAsset[]; inputAssetIds: string[] } | { ok: false; error: string } {
  if (inputAssets !== undefined && inputAssetIds !== undefined) {
    return { ok: false, error: "input_assets and input_asset_ids cannot both be provided." };
  }

  if (inputAssets !== undefined) {
    if (!Array.isArray(inputAssets)) return { ok: false, error: "input_assets must be an array." };
    const parsed: MediaJobInputAsset[] = [];
    for (const item of inputAssets) {
      if (!isRecord(item) || typeof item.asset_id !== "string" || !item.asset_id.trim() || typeof item.role !== "string" || !item.role.trim()) {
        return { ok: false, error: "input_assets must contain asset_id and role strings." };
      }
      parsed.push({ assetId: item.asset_id.trim(), role: item.role.trim() });
    }
    const validation = validateInputAssetRoles(parsed, model.inputAssetSchema);
    if (!validation.ok) return validation;
    return { ok: true, inputAssets: parsed, inputAssetIds: parsed.map((item) => item.assetId) };
  }

  const legacyIds = parseLegacyInputAssetIds(inputAssetIds);
  if (!legacyIds.ok) return legacyIds;
  if (legacyIds.inputAssetIds.length === 0) {
    const validation = validateInputAssetRoles([], model.inputAssetSchema);
    if (!validation.ok) return validation;
    return { ok: true, inputAssets: [], inputAssetIds: [] };
  }

  const inferredRole = inferLegacyRole(model.inputAssetSchema);
  if (!inferredRole) {
    return { ok: false, error: "input_assets with roles are required for this model." };
  }
  const inferred = legacyIds.inputAssetIds.map((assetId) => ({ assetId, role: inferredRole }));
  const validation = validateInputAssetRoles(inferred, model.inputAssetSchema);
  if (!validation.ok) return validation;
  return { ok: true, inputAssets: inferred, inputAssetIds: legacyIds.inputAssetIds };
}
```

The same file must export `validateInputAssetRoles(inputAssets, schema)` for `lib/media/jobs.ts` to reuse after asset rows are loaded. It must enforce required roles, min/max role counts, known role names, and duplicate asset IDs.

- [ ] **Step 5: Update `app/api/v1/media/jobs/route.ts`**

Add `input_assets?: unknown` to `CreateMediaJobBody`. Import `parseMediaJobInputAssets`. Replace `parseInputAssetIds` use with:

```ts
  const inputAssets = parseMediaJobInputAssets({
    model,
    inputAssets: body.input_assets,
    inputAssetIds: body.input_asset_ids,
  });
  if (!inputAssets.ok) {
    return apiError(inputAssets.error, 400, "invalid_media_input");
  }
```

Pass to job creation:

```ts
      inputAssets: inputAssets.inputAssets,
      inputAssetIds: inputAssets.inputAssetIds,
```

- [ ] **Step 6: Update `lib/media/jobs.ts`**

Import:

```ts
import type { MediaJobInputAsset } from "@/lib/media/input-assets";
import { quoteMediaJob, serializeMediaPricingQuote } from "@/lib/media/pricing-quotes";
```

Change `createReservedMediaJob` input to include:

```ts
  inputAssets,
  inputAssetIds,
}: {
  userId: string;
  model: MediaModel;
  parameters: Record<string, unknown>;
  inputAssets: MediaJobInputAsset[];
  inputAssetIds: string[];
}
```

Update every existing `createReservedMediaJob` call in `tests/media/jobs.test.ts` to pass
`inputAssets: inputAssetIds.map((assetId) => ({ assetId, role: "image" }))` when the test uses image
inputs, or `inputAssets: []` when the test has no inputs.

Compute quote before validation:

```ts
  const pricingQuote = quoteMediaJob({ model, parameters });
  const reserveAmount = reservationUsdMicros(model, pricingQuote);
```

Store both shapes:

```ts
      input: {
        media_model_id: model.id,
        operation: model.operation,
        parameters,
        input_assets: inputAssets.map((asset) => ({ asset_id: asset.assetId, role: asset.role })),
        input_asset_ids: inputAssetIds,
        pricing_quote: serializeMediaPricingQuote(pricingQuote),
      },
```

Add `serializeMediaPricingQuote` in `lib/media/pricing-quotes.ts` with snake-case fields matching the test.

Extend `validateInputAssets` to accept `inputAssets`. After loading rows, check every loaded row's `content_type` against the role's `contentTypePrefixes` instead of only the model-level family list.

- [ ] **Step 7: Run tests**

Run: `pnpm exec vitest run tests/media/job-routes.test.ts tests/media/jobs.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/media/input-assets.ts app/api/v1/media/jobs/route.ts lib/media/jobs.ts tests/media/job-routes.test.ts tests/media/jobs.test.ts
git commit -m "feat: accept role-aware media job inputs"
```

---

### Task 5: Map Role-Aware Inputs Into Provider Payloads

**Files:**
- Modify: `lib/media/provider.ts`
- Modify: `lib/media/worker.ts`
- Modify: `lib/media/providers/fal.ts`
- Test: `tests/media/provider-adapters.test.ts`
- Test: `tests/media/worker.test.ts`

**Interfaces:**
- Consumes: stored `generation_jobs.input.input_assets`.
- Produces: signed provider input assets and Fal field mapping.

- [ ] **Step 1: Write failing Fal adapter test**

Add to `describe("falMediaAdapter")` in `tests/media/provider-adapters.test.ts`:

```ts
  it("maps role-aware input assets to Fal provider fields", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    mocks.falSubmit.mockResolvedValue({ request_id: "fal_req_roles" });

    await falMediaAdapter.run({
      model: mediaModel({
        inputAssetSchema: {
          roles: [
            { role: "first_frame", providerField: "first_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
            { role: "last_frame", providerField: "last_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
          ],
        },
        parameterSchema: {
          type: "object",
          properties: { prompt: { type: "string" } },
        },
      }),
      parameters: { prompt: "product reveal" },
      inputUrls: [],
      inputAssets: [
        { assetId: "asset_first", role: "first_frame", url: "https://media.example/first.png", contentType: "image/png" },
        { assetId: "asset_last", role: "last_frame", url: "https://media.example/last.png", contentType: "image/png" },
      ],
    });

    expect(mocks.falSubmit).toHaveBeenCalledWith("fal-ai/frontier-video", {
      input: {
        prompt: "product reveal",
        first_frame_url: "https://media.example/first.png",
        last_frame_url: "https://media.example/last.png",
      },
      abortSignal: undefined,
    });
  });
```

- [ ] **Step 2: Update provider types**

In `lib/media/provider.ts`, add:

```ts
export type ProviderInputAsset = {
  assetId: string;
  role: string;
  url: string;
  contentType: string;
};
```

Add optional `inputAssets?: ProviderInputAsset[]` to `MediaProviderAdapter.run` input.

- [ ] **Step 3: Update worker normalization and signing**

In `lib/media/worker.ts`, update `normalizeClaimedJob` to parse:

```ts
    inputAssets: inputAssetEntriesValue(input.input_assets),
    pricingQuote: mediaPricingQuoteValue(input.pricing_quote),
```

Change `signedInputAssetUrls` to return `ProviderInputAsset[]` and select `id, storage_key, content_type`. For each stored `{ asset_id, role }`, return:

```ts
{
  assetId,
  role,
  contentType: asset.content_type,
  url: `${env.baseUrl}/objects/${assetId}?token=${encodeURIComponent(token)}`,
}
```

Keep `inputUrls` as `signedAssets.map((asset) => asset.url)` for legacy adapter compatibility.

- [ ] **Step 4: Update `runProviderAdapter` and adapter call**

Pass both:

```ts
    inputUrls,
    inputAssets,
```

into `adapter.run`.

- [ ] **Step 5: Update `lib/media/providers/fal.ts`**

Import `ProviderInputAsset`. Add a helper:

```ts
function applyInputAssets(input: Record<string, unknown>, model: MediaModel, inputAssets: ProviderInputAsset[]) {
  const rolesByName = new Map(model.inputAssetSchema.roles.map((role) => [role.role, role]));
  const byRole = new Map<string, ProviderInputAsset[]>();
  for (const asset of inputAssets) {
    const items = byRole.get(asset.role) ?? [];
    items.push(asset);
    byRole.set(asset.role, items);
  }

  for (const [roleName, assets] of byRole) {
    const role = rolesByName.get(roleName);
    if (!role) continue;
    input[role.providerField] = role.max === 1 ? assets[0]!.url : assets.map((asset) => asset.url);
  }
}
```

In `run`, after declared parameters are merged:

```ts
    applyInputAssets(input, model, inputAssets ?? []);

    if ((inputAssets?.length ?? 0) === 0 && inputUrls.length > 0) {
      input.input_urls = inputUrls;
    }
```

This keeps old tests passing while production rows use named fields.

- [ ] **Step 6: Run adapter and worker tests**

Run: `pnpm exec vitest run tests/media/provider-adapters.test.ts tests/media/worker.test.ts`

Expected: PASS after updating existing worker test fixtures to include `input_assets: []` only where assertions need exact input payloads.

- [ ] **Step 7: Commit**

```bash
git add lib/media/provider.ts lib/media/worker.ts lib/media/providers/fal.ts tests/media/provider-adapters.test.ts tests/media/worker.test.ts
git commit -m "feat: map media input roles to provider fields"
```

---

### Task 6: Return Filtered Agent-Usable Catalog Responses

**Files:**
- Modify: `app/api/v1/media/models/route.ts`
- Test: `tests/media/model-catalog-route.test.ts`

**Interfaces:**
- Consumes: `listMediaModels({ kind, operation })`.
- Produces: public catalog response with `operation`, `input_asset_schema`, and `estimate_kind`.

- [ ] **Step 1: Update the existing catalog route test**

In `tests/media/model-catalog-route.test.ts`, extend the mocked model with:

```ts
        inputAssetSchema: {
          roles: [{
            role: "image",
            providerField: "image_url",
            mediaKind: "image",
            required: true,
            min: 1,
            max: 1,
            contentTypePrefixes: ["image/"],
          }],
        },
        pricingFormula: { type: "veo_seconds" },
```

Update the expected response model to include:

```ts
          operation: "video_generation",
          input_asset_schema: {
            roles: [{
              role: "image",
              provider_field: "image_url",
              media_kind: "image",
              required: true,
              min: 1,
              max: 1,
              content_type_prefixes: ["image/"],
            }],
          },
```

And update `estimated_price` to include:

```ts
            estimate_kind: "parameter_quote",
```

- [ ] **Step 2: Add filter tests**

Append:

```ts
  it("passes valid kind and operation filters to listMediaModels", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({ ok: true, auth: { user: { id: "user_1" } } })),
    }));
    const listMediaModels = vi.fn(async () => []);
    vi.doMock("@/lib/media/model-registry", () => ({ listMediaModels }));

    const { GET } = await import("@/app/api/v1/media/models/route");
    const response = await GET(new Request("https://example.test/api/v1/media/models?kind=image&operation=image_generation"));

    expect(response.status).toBe(200);
    expect(listMediaModels).toHaveBeenCalledWith({ kind: "image", operation: "image_generation" });
  });

  it("rejects invalid catalog filters", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({ ok: true, auth: { user: { id: "user_1" } } })),
    }));
    vi.doMock("@/lib/media/model-registry", () => ({ listMediaModels: vi.fn(async () => []) }));

    const { GET } = await import("@/app/api/v1/media/models/route");
    const response = await GET(new Request("https://example.test/api/v1/media/models?kind=document"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_media_input" },
    });
  });
```

- [ ] **Step 3: Run route tests to verify they fail**

Run: `pnpm exec vitest run tests/media/model-catalog-route.test.ts`

Expected: FAIL because the route ignores filters and omits the new catalog fields.

- [ ] **Step 4: Update the route**

In `app/api/v1/media/models/route.ts`, import media constants:

```ts
import { MEDIA_OPERATIONS, type MediaKind, type MediaOperation } from "@/lib/media/types";
```

Add helpers:

```ts
const MEDIA_KINDS = ["image", "video", "audio", "captions"] as const;

function parseKind(value: string | null): MediaKind | null | undefined {
  if (value === null) return undefined;
  return (MEDIA_KINDS as readonly string[]).includes(value) ? value as MediaKind : null;
}

function parseOperation(value: string | null): MediaOperation | null | undefined {
  if (value === null) return undefined;
  return (MEDIA_OPERATIONS as readonly string[]).includes(value) ? value as MediaOperation : null;
}
```

In `GET`, parse:

```ts
    const url = new URL(request.url);
    const kind = parseKind(url.searchParams.get("kind"));
    const operation = parseOperation(url.searchParams.get("operation"));
    if (kind === null || operation === null) {
      return apiError("Invalid media catalog filter.", 400, "invalid_media_input");
    }

    const models = await listMediaModels({ kind, operation });
```

Map `inputAssetSchema` to snake case:

```ts
          operation: model.operation,
          input_asset_schema: {
            roles: model.inputAssetSchema.roles.map((role) => ({
              role: role.role,
              provider_field: role.providerField,
              media_kind: role.mediaKind,
              required: role.required,
              min: role.min,
              max: role.max,
              content_type_prefixes: role.contentTypePrefixes,
            })),
          },
```

Set:

```ts
            estimate_kind: model.pricingFormula.type === "static" ? "static" : model.pricingFormula.type === "gpt_image_conservative" ? "conservative_quote" : "parameter_quote",
```

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run tests/media/model-catalog-route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/media/models/route.ts tests/media/model-catalog-route.test.ts
git commit -m "feat: expose filtered media model catalog"
```

---

### Task 7: Seed The Production Media Runtime Catalog

**Files:**
- Modify: `lib/pricing-page-rates.ts`
- Create: `supabase/migrations/20260703180000_seed_media_runtime_catalog.sql`
- Create: `tests/media/catalog-seed.test.ts`
- Modify: `tests/media/db-rpcs.integration.test.ts`
- Modify: `docs/media-worker-deploy.md`

**Interfaces:**
- Consumes: model IDs from `lib/pricing-page-rates.ts` and provider fields from the docs digest.
- Produces: enabled Supabase catalog rows for image, video, and audio media models.

- [ ] **Step 1: Write failing seed coverage test**

Create `tests/media/catalog-seed.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mediaModelRates } from "@/lib/pricing-page-rates";

describe("media runtime catalog seed", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260703180000_seed_media_runtime_catalog.sql"),
    "utf8",
  );

  it("seeds every pricing-page media model id", () => {
    const ids = mediaModelRates.flatMap((group) => group.modelIds);
    for (const id of ids) {
      expect(migration).toContain(`"public_id": "${id}"`);
    }
  });

  it("seeds role-aware provider mappings and disables generic Fal URL fallback", () => {
    expect(migration).toContain('"provider_field": "image_url"');
    expect(migration).toContain('"provider_field": "image_urls"');
    expect(migration).toContain('"provider_field": "first_frame_url"');
    expect(migration).toContain('"provider_field": "last_frame_url"');
    expect(migration).toContain('"provider_field": "video_url"');
    expect(migration).toContain('"fal_allow_generic_url_fallback": false');
  });
});
```

- [ ] **Step 2: Write failing DB integration catalog test**

Replace the placeholder-specific test in `tests/media/db-rpcs.integration.test.ts` with:

```ts
  it("lists the enabled production media catalog seeded from the pricing page", async () => {
    const models = await listMediaModels();
    const ids = new Set(models.map((model) => model.id));

    expect(ids.has("fal:launch-placeholder-video")).toBe(false);
    expect(ids.has("openai/gpt-image-2")).toBe(true);
    expect(ids.has("openai/gpt-image-2/edit")).toBe(true);
    expect(ids.has("fal-ai/nano-banana-pro")).toBe(true);
    expect(ids.has("fal-ai/nano-banana-lite")).toBe(true);
    expect(ids.has("fal-ai/nano-banana-lite/edit")).toBe(true);
    expect(ids.has("fal-ai/veo3.1")).toBe(true);
    expect(ids.has("bytedance/seedance-2.0/text-to-video")).toBe(true);
    expect(ids.has("fal-ai/kling-video/v3/pro/text-to-video")).toBe(true);
    expect(ids.has("music_v2")).toBe(true);

    expect(models.find((model) => model.id === "fal-ai/veo3.1/first-last-frame-to-video")).toMatchObject({
      provider: "fal",
      kind: "video",
      inputAssetSchema: {
        roles: expect.arrayContaining([
          expect.objectContaining({ role: "first_frame", providerField: "first_frame_url" }),
          expect.objectContaining({ role: "last_frame", providerField: "last_frame_url" }),
        ]),
      },
    });
  });
```

- [ ] **Step 3: Run seed tests to verify they fail**

Run: `pnpm exec vitest run tests/media/catalog-seed.test.ts tests/media/db-rpcs.integration.test.ts`

Expected: unit seed test FAILS because the migration does not exist. DB test is skipped unless `RUN_SUPABASE_DB_TESTS=1`.

- [ ] **Step 4: Create the seed migration**

Create `supabase/migrations/20260703180000_seed_media_runtime_catalog.sql` with an idempotent upsert.
The migration must contain one explicit `values` tuple for each of these public model IDs:

```txt
openai/gpt-image-2
openai/gpt-image-2/edit
fal-ai/nano-banana-pro
fal-ai/nano-banana-lite
fal-ai/nano-banana-lite/edit
fal-ai/gemini-omni-flash
fal-ai/gemini-omni-flash/image-to-video
fal-ai/gemini-omni-flash/reference-to-video
fal-ai/gemini-omni-flash/edit
fal-ai/veo3.1
fal-ai/veo3.1/image-to-video
fal-ai/veo3.1/first-last-frame-to-video
fal-ai/veo3.1/reference-to-video
fal-ai/veo3.1/fast
fal-ai/veo3.1/fast/image-to-video
fal-ai/veo3.1/fast/first-last-frame-to-video
bytedance/seedance-2.0/text-to-video
bytedance/seedance-2.0/image-to-video
bytedance/seedance-2.0/reference-to-video
bytedance/seedance-2.0/fast/text-to-video
bytedance/seedance-2.0/fast/image-to-video
bytedance/seedance-2.0/fast/reference-to-video
fal-ai/kling-video/v3/pro/text-to-video
fal-ai/kling-video/v3/pro/image-to-video
fal-ai/kling-video/v3/standard/text-to-video
fal-ai/kling-video/v3/standard/image-to-video
music_v2
```

Every metadata JSON object must include these fields with concrete values for that row:

- `public_id`: the public model ID listed above.
- `provider_endpoint`: the exact Fal endpoint ID for Fal rows; `music` for ElevenLabs Music v2.
- `kind`: `image`, `video`, or `audio`.
- `supports_uploaded_inputs`: true only when the row has required or optional uploaded input roles.
- `supported_input_types`: the distinct media families accepted by `input_asset_schema`.
- `output_types`: `["image"]`, `["video"]`, or `["audio"]`.
- `pricing_unit`: `job`, `second`, or `minute`.
- `default_parameters`: provider defaults that should be sent when users omit the parameter.
- `parameter_schema`: the public schema from the provider docs digest, excluding provider URL fields.
- `input_asset_schema`: role definitions with `role`, `provider_field`, `media_kind`, `required`, `min`, `max`, and `content_type_prefixes`.
- `pricing_formula`: one of the formula types implemented in Task 3 with its concrete provider rates.
- `fal_output_paths`: required for Fal rows; omitted for ElevenLabs rows.
- `fal_allow_generic_url_fallback`: false for every Fal row in this migration.

Use the docs digest for exact endpoint-specific fields. Required specifics:

- Image outputs use `fal_output_paths: [{ "path": "images", "type": "image" }]`.
- Video outputs use `fal_output_paths: [{ "path": "video", "type": "video" }]`.
- `openai/gpt-image-2/edit` uses required role `reference_images -> image_urls` and optional role `mask -> mask_url`.
- `fal-ai/nano-banana-lite` uses the documented text-to-image Lite endpoint with no input asset
  roles, `limit_generations: true`, image output path `images`, and the full Lite aspect-ratio enum
  including `4:1`, `1:4`, `8:1`, and `1:8`.
- `fal-ai/nano-banana-lite/edit` uses required role `reference_images -> image_urls`, image output
  path `images`, `limit_generations: true`, and a `nano_banana` pricing formula with
  `provider_rate_usd_per_image: "1.00"`.
- Single image-to-video rows use `image -> image_url`.
- Veo first-last rows use `first_frame -> first_frame_url` and `last_frame -> last_frame_url`.
- Kling image-to-video rows use `start_image -> start_image_url` and optional `end_image -> end_image_url`.
- Gemini edit uses `video -> video_url`.
- Seedance reference rows support `reference_images -> image_urls`, `reference_videos -> video_urls`, and `reference_audio -> audio_urls` with the documented max counts.
- Seedance schemas must enumerate `"4"` through `"15"` for `duration` and must not include `"auto"`.
- Kling schemas must use `constraints: [{ "type": "exactly_one", "fields": ["prompt", "multi_prompt"] }]`.
- `music_v2` uses provider `elevenlabs`, model `music_v2`, operation `music_generation`, kind `audio`, output type `audio`, and pricing formula `music_minutes`.

The migration must end with this exact conflict clause:

```sql
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    enabled = excluded.enabled,
    metadata = excluded.metadata,
    updated_at = now();
```

- [ ] **Step 5: Update deployment docs**

In `docs/media-worker-deploy.md`, replace the entire "Curated Media Model Enablement" section with:

````md
## Curated Media Model Catalog

Clean schema deployments seed enabled production media rows in `model_pricing_rules` through
`20260703180000_seed_media_runtime_catalog.sql`. Production deploy no longer requires manually
enabling `fal:launch-placeholder-video`.

Before enabling job creation in production, verify:

```bash
pnpm run test:media-db
curl -s https://www.woven.video/api/v1/media/models \
  -H "Authorization: Bearer $LOCAL_OR_PROD_TOKEN"
curl -s "https://www.woven.video/api/v1/media/models?kind=image" \
  -H "Authorization: Bearer $LOCAL_OR_PROD_TOKEN"
```

The catalog response must include image, video, and audio rows, `input_asset_schema`, and
`parameter_schema`. Do not enable rows that rely on generic recursive Fal URL extraction.
````

- [ ] **Step 6: Run seed tests**

Run: `pnpm exec vitest run tests/media/catalog-seed.test.ts`

Expected: PASS.

Run DB tests with local Supabase when available:

```bash
pnpm run test:media-db
```

Expected: PASS when Supabase is running and migrations are applied.

- [ ] **Step 7: Commit**

```bash
git add lib/pricing-page-rates.ts supabase/migrations/20260703180000_seed_media_runtime_catalog.sql tests/media/catalog-seed.test.ts tests/media/db-rpcs.integration.test.ts docs/media-worker-deploy.md
git commit -m "feat: seed production media model catalog"
```

---

### Task 8: Settle Worker Jobs From Stored Quotes

**Files:**
- Modify: `lib/media/worker.ts`
- Test: `tests/media/worker.test.ts`

**Interfaces:**
- Consumes: `generation_jobs.input.pricing_quote`.
- Produces: final billing that falls back to the immutable quote when provider raw cost is missing.

- [ ] **Step 1: Write failing worker settlement test**

In `tests/media/worker.test.ts`, add a test near existing settlement tests:

```ts
  it("settles from stored pricing quote when provider returns no raw cost", async () => {
    const adapter = {
      run: vi.fn(async () => ({
        status: "succeeded" as const,
        outputs: [{ url: "https://provider.example/output.mp4", type: "video" as const, contentType: "video/mp4" }],
        rawCostUsd: 0,
        metadata: { request_id: "provider_1" },
      })),
    };
    const admin = mockAdminForClaimedJob({
      input: {
        media_model_id: "fal:frontier-video",
        parameters: { prompt: "a mountain" },
        input_asset_ids: [],
        input_assets: [],
        pricing_quote: {
          estimate_kind: "parameter_quote",
          provider_cost_usd_micros: 3_200_000,
          charged_amount_usd_micros: 3_840_000,
          reserved_amount_usd_micros: 3_840_000,
          markup_amount_usd_micros: 640_000,
          formula: "veo_seconds",
          inputs: { duration_seconds: 8 },
        },
      },
    });

    await expect(drainOneMediaJob({ adapters: { fal: adapter } })).resolves.toMatchObject({
      claimed: true,
      status: "succeeded",
    });

    expect(admin.rpc).toHaveBeenCalledWith("record_and_settle_claimed_media_job", expect.objectContaining({
      p_final_cost_usd_micros: 3_840_000,
      p_usage_event: expect.objectContaining({
        raw_provider_cost: 0,
        charged_amount_usd_micros: 3_840_000,
        markup_amount_usd_micros: 640_000,
      }),
    }));
  });
```

Use the existing mock helper shape in `tests/media/worker.test.ts`; if it has a different helper name, add the `pricing_quote` payload to the existing settled-job test fixture instead.

- [ ] **Step 2: Run worker tests to verify failure**

Run: `pnpm exec vitest run tests/media/worker.test.ts`

Expected: FAIL because the worker still calls `chargeMediaUsdMicros({ model, rawCostUsd })` without the stored quote.

- [ ] **Step 3: Parse quote in worker**

In `lib/media/worker.ts`, import `deserializeMediaPricingQuote` from `lib/media/pricing-quotes`.

Add to `normalizeClaimedJob`:

```ts
    pricingQuote: deserializeMediaPricingQuote(input.pricing_quote),
```

Update the charge call:

```ts
  const charge = chargeMediaUsdMicros({
    model,
    rawCostUsd: result.rawCostUsd,
    pricingQuote: job.pricingQuote,
  });
```

Keep `usageEvent.raw_provider_cost` as the real provider-returned number. The final charged amount uses the fallback quote only when provider raw cost is absent.

- [ ] **Step 4: Run worker tests**

Run: `pnpm exec vitest run tests/media/worker.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/media/worker.ts tests/media/worker.test.ts
git commit -m "fix: settle media jobs from stored quote fallback"
```

---

### Task 9: Full Verification

**Files:**
- No source files unless verification exposes a defect from prior tasks.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified plan completion.

- [ ] **Step 1: Run unit tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Run real Supabase tests**

If local Supabase is not running, run:

```bash
supabase start
supabase db reset
```

Then run:

```bash
pnpm run test:media-db
```

Expected: PASS.

- [ ] **Step 5: Handle verification failures**

If a verification command fails, return to the task that introduced the failing behavior, make the
smallest correction there, rerun that task's tests, and create a normal task-scoped commit. If all
verification commands pass, do not create a verification commit.
