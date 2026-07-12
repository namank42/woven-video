# Hosted Model Selection Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live Woven model catalog the sole authority for the hosted default model and retired-model replacement claims, with Sol as the only default and GPT-5.5 successor.

**Architecture:** Merge explicit selection policy into each enabled chat model's database metadata, validate all enabled rows through one pure cross-catalog validator, and expose the validated fields at the top level of `GET /api/v1/models`. Invalid or contradictory policy fails the request before Gateway enrichment, ensuring every successful catalog has exactly one default and unambiguous replacement claims.

**Tech Stack:** PostgreSQL/Supabase migrations, TypeScript 5, Next.js 16.2.3 App Router Route Handlers, Vitest 4.1.9, pnpm

**Docs digest:** [`docs/superpowers/research/2026-07-12-nextjs-model-catalog-route-docs.md`](../research/2026-07-12-nextjs-model-catalog-route-docs.md)

## Global Constraints

- `model_pricing_rules.metadata` is authoritative for `is_default` and `replaces_model_ids`.
- GPT-5.6 Sol is the sole Woven default and the sole model declaring `openai/gpt-5.5` as replaced.
- Every enabled hosted chat model explicitly stores both fields; missing fields are invalid.
- Every successful `GET /api/v1/models` response has exactly one `is_default: true` model.
- `is_default` and `replaces_model_ids` are top-level model fields, not capabilities.
- Replacement IDs are exact canonical backend IDs and never use Harness's internal `woven:` prefix.
- Validate the complete catalog before starting any Gateway enrichment.
- Invalid policy returns HTTP 500 with code and type `invalid_model_catalog`, logs one structured internal reason, and never falls back to a hardcoded model.
- Invalid reasoning metadata continues to safe-degrade per model when selection policy is valid.
- Gateway failure preserves backend-owned selection and reasoning fields while live fields degrade and pricing becomes `null`.
- Harness uses policy only from a current successful live Woven catalog; static and cached policy cannot drive automatic selection.
- BYOK retains its independent local GPT-5.5-to-Sol migration.
- Do not add model aliases, request-time effort enforcement, database policy columns, or Harness code in this repository.
- Preserve the native Next.js `Request`/`Response.json` route and `export const dynamic = "force-dynamic"`.
- Use `pnpm`, follow RED -> GREEN, and commit each independently reviewable task.

## File Structure

- Create `supabase/migrations/20260712123000_seed_hosted_model_selection_policy.sql` to merge the exact five-model policy into existing metadata.
- Create `tests/hosted-model-selection-policy-migration.test.ts` to lock the sole default, replacement claim, merge behavior, and migration scope.
- Create `lib/ai/hosted-model-selection-policy.ts` as the pure per-row and cross-catalog validator.
- Create `tests/hosted-model-selection-policy.test.ts` to cover the valid catalog and every malformed or contradictory policy class.
- Modify `app/api/v1/models/route.ts` to validate before Gateway calls and serialize top-level policy fields.
- Modify `tests/model-catalog-route.test.ts` to prove successful policy serialization, fail-closed behavior, no enrichment on invalid policy, Gateway-failure preservation, and unchanged reasoning degradation.

---

### Task 1: Seed the sole default and GPT-5.5 replacement claim

**Files:**
- Create: `supabase/migrations/20260712123000_seed_hosted_model_selection_policy.sql`
- Create: `tests/hosted-model-selection-policy-migration.test.ts`

**Interfaces:**
- Consumes: The five enabled hosted chat rows and existing metadata established by prior migrations.
- Produces: Explicit `is_default` and `replaces_model_ids` metadata on every enabled hosted model without overwriting provider or reasoning metadata.

- [ ] **Step 1: Write the failing migration source-contract test**

Create `tests/hosted-model-selection-policy-migration.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712123000_seed_hosted_model_selection_policy.sql",
);

describe("hosted model selection policy migration", () => {
  it("seeds Sol as the sole default and GPT-5.5 successor", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('openai/gpt-5.6-sol', true, '[\"openai/gpt-5.5\"]'::jsonb)",
    );
    expect(normalized).toContain(
      "('openai/gpt-5.6-terra', false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-sonnet-4.6', false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-opus-4.8', false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('moonshotai/kimi-k2.6', false, '[]'::jsonb)",
    );
    expect(normalized.match(/, true, /g)).toHaveLength(1);
    expect(normalized).toContain("'is_default', policy.is_default");
    expect(normalized).toContain("'replaces_model_ids', policy.replaces_model_ids");
    expect(normalized).toContain(
      "coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(",
    );
    expect(normalized).toContain("rules.provider = 'vercel-ai-gateway'");
    expect(normalized).toContain("rules.operation = 'chat'");
    expect(sql).not.toMatch(/metadata\s*=\s*jsonb_build_object/i);
  });
});
```

- [ ] **Step 2: Run the migration test to verify RED**

Run:

```bash
pnpm test tests/hosted-model-selection-policy-migration.test.ts
```

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Add the immutable idempotent metadata migration**

Create `supabase/migrations/20260712123000_seed_hosted_model_selection_policy.sql`:

```sql
-- Make the live hosted catalog authoritative for default selection and
-- retired-model migration without replacing provider or reasoning metadata.

with selection_policy(model, is_default, replaces_model_ids) as (
  values
    ('openai/gpt-5.6-sol', true, '["openai/gpt-5.5"]'::jsonb),
    ('openai/gpt-5.6-terra', false, '[]'::jsonb),
    ('anthropic/claude-sonnet-4.6', false, '[]'::jsonb),
    ('anthropic/claude-opus-4.8', false, '[]'::jsonb),
    ('moonshotai/kimi-k2.6', false, '[]'::jsonb)
)
update public.model_pricing_rules as rules
set metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', policy.is_default,
      'replaces_model_ids', policy.replaces_model_ids
    ),
    updated_at = now()
from selection_policy as policy
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = policy.model;
```

- [ ] **Step 4: Run the focused migration test to verify GREEN**

Run:

```bash
pnpm test tests/hosted-model-selection-policy-migration.test.ts
```

Expected: 1 test file PASS.

- [ ] **Step 5: Apply migrations locally and verify exact persisted policy**

Run:

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -P pager=off -c "select model, metadata->'is_default' as is_default, metadata->'replaces_model_ids' as replaces_model_ids from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and enabled order by model;"
```

Expected: exactly five rows; only Sol is `true`; only Sol contains `["openai/gpt-5.5"]`; every other replacement array is `[]`.

- [ ] **Step 6: Commit the migration slice**

```bash
git add supabase/migrations/20260712123000_seed_hosted_model_selection_policy.sql tests/hosted-model-selection-policy-migration.test.ts
git commit -m "feat(models): seed hosted selection policy"
```

---

### Task 2: Validate per-model and whole-catalog selection policy

**Files:**
- Create: `lib/ai/hosted-model-selection-policy.ts`
- Create: `tests/hosted-model-selection-policy.test.ts`

**Interfaces:**
- Consumes: `Array<{ model: string; metadata: unknown }>` containing the complete enabled hosted catalog.
- Produces: `validateHostedModelSelectionPolicies(models): HostedModelSelectionValidation`, a discriminated result whose success contains `policiesByModelId: Map<string, HostedModelSelectionPolicy>` and whose failure contains one deterministic `reason`.

- [ ] **Step 1: Write failing tests for the valid policy and all invalid invariants**

Create `tests/hosted-model-selection-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  validateHostedModelSelectionPolicies,
} from "@/lib/ai/hosted-model-selection-policy";

type CatalogModel = { model: string; metadata: unknown };

function validCatalog(): CatalogModel[] {
  return [
    {
      model: "openai/gpt-5.6-sol",
      metadata: {
        is_default: true,
        replaces_model_ids: ["openai/gpt-5.5"],
      },
    },
    {
      model: "openai/gpt-5.6-terra",
      metadata: { is_default: false, replaces_model_ids: [] },
    },
    {
      model: "anthropic/claude-sonnet-4.6",
      metadata: { is_default: false, replaces_model_ids: [] },
    },
    {
      model: "anthropic/claude-opus-4.8",
      metadata: { is_default: false, replaces_model_ids: [] },
    },
    {
      model: "moonshotai/kimi-k2.6",
      metadata: { is_default: false, replaces_model_ids: [] },
    },
  ];
}

function withMetadata(
  catalog: CatalogModel[],
  modelId: string,
  metadata: unknown,
): CatalogModel[] {
  return catalog.map((model) =>
    model.model === modelId ? { ...model, metadata } : model,
  );
}

describe("validateHostedModelSelectionPolicies", () => {
  it("returns the exact explicit policy for the valid five-model catalog", () => {
    const result = validateHostedModelSelectionPolicies(validCatalog());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    expect([...result.policiesByModelId.entries()]).toEqual([
      [
        "openai/gpt-5.6-sol",
        {
          is_default: true,
          replaces_model_ids: ["openai/gpt-5.5"],
        },
      ],
      ["openai/gpt-5.6-terra", { is_default: false, replaces_model_ids: [] }],
      [
        "anthropic/claude-sonnet-4.6",
        { is_default: false, replaces_model_ids: [] },
      ],
      [
        "anthropic/claude-opus-4.8",
        { is_default: false, replaces_model_ids: [] },
      ],
      ["moonshotai/kimi-k2.6", { is_default: false, replaces_model_ids: [] }],
    ]);
  });

  it.each([
    [null, "openai/gpt-5.6-sol: metadata must be an object"],
    [
      { replaces_model_ids: ["openai/gpt-5.5"] },
      "openai/gpt-5.6-sol: is_default must be a boolean",
    ],
    [
      { is_default: true },
      "openai/gpt-5.6-sol: replaces_model_ids must be an array",
    ],
    [
      { is_default: true, replaces_model_ids: [""] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: [123] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: [" openai/gpt-5.5"] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: ["openai/gpt 5.5"] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: ["gpt-5.5"] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: ["woven:openai/gpt-5.5"] },
      "openai/gpt-5.6-sol: replacement IDs must not use the woven: prefix",
    ],
    [
      { is_default: true, replaces_model_ids: ["openai/gpt-5.6-sol"] },
      "openai/gpt-5.6-sol: a model cannot replace itself",
    ],
    [
      {
        is_default: true,
        replaces_model_ids: ["openai/gpt-5.5", "openai/gpt-5.5"],
      },
      "openai/gpt-5.6-sol: duplicate replacement ID openai/gpt-5.5",
    ],
  ] as const)("rejects invalid Sol metadata %#", (metadata, reason) => {
    expect(
      validateHostedModelSelectionPolicies(
        withMetadata(validCatalog(), "openai/gpt-5.6-sol", metadata),
      ),
    ).toEqual({ ok: false, reason });
  });

  it("rejects a catalog without a default", () => {
    const catalog = withMetadata(validCatalog(), "openai/gpt-5.6-sol", {
      is_default: false,
      replaces_model_ids: ["openai/gpt-5.5"],
    });

    expect(validateHostedModelSelectionPolicies(catalog)).toEqual({
      ok: false,
      reason: "expected exactly one default model, found 0",
    });
  });

  it("rejects multiple defaults", () => {
    const catalog = withMetadata(validCatalog(), "openai/gpt-5.6-terra", {
      is_default: true,
      replaces_model_ids: [],
    });

    expect(validateHostedModelSelectionPolicies(catalog)).toEqual({
      ok: false,
      reason: "expected exactly one default model, found 2",
    });
  });

  it("rejects replacing an enabled model", () => {
    const catalog = withMetadata(validCatalog(), "openai/gpt-5.6-sol", {
      is_default: true,
      replaces_model_ids: ["openai/gpt-5.6-terra"],
    });

    expect(validateHostedModelSelectionPolicies(catalog)).toEqual({
      ok: false,
      reason: "openai/gpt-5.6-sol: replacement ID openai/gpt-5.6-terra is enabled",
    });
  });

  it("rejects one retired ID claimed by two enabled models", () => {
    const catalog = withMetadata(validCatalog(), "openai/gpt-5.6-terra", {
      is_default: false,
      replaces_model_ids: ["openai/gpt-5.5"],
    });

    expect(validateHostedModelSelectionPolicies(catalog)).toEqual({
      ok: false,
      reason:
        "replacement ID openai/gpt-5.5 is claimed by openai/gpt-5.6-sol and openai/gpt-5.6-terra",
    });
  });
});
```

- [ ] **Step 2: Run the validator tests to verify RED**

Run:

```bash
pnpm test tests/hosted-model-selection-policy.test.ts
```

Expected: FAIL because `@/lib/ai/hosted-model-selection-policy` does not exist.

- [ ] **Step 3: Implement the pure fail-closed catalog validator**

Create `lib/ai/hosted-model-selection-policy.ts`:

```ts
export type HostedModelSelectionPolicy = {
  is_default: boolean;
  replaces_model_ids: string[];
};

export type HostedModelSelectionInput = {
  model: string;
  metadata: unknown;
};

export type HostedModelSelectionValidation =
  | {
      ok: true;
      policiesByModelId: Map<string, HostedModelSelectionPolicy>;
    }
  | { ok: false; reason: string };

function failure(reason: string): HostedModelSelectionValidation {
  return { ok: false, reason };
}

function isMetadataObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalBackendModelId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    return false;
  }

  const slash = value.indexOf("/");
  return !/\s/.test(value) && slash > 0 && slash < value.length - 1;
}

export function validateHostedModelSelectionPolicies(
  models: HostedModelSelectionInput[],
): HostedModelSelectionValidation {
  const policiesByModelId = new Map<string, HostedModelSelectionPolicy>();

  for (const model of models) {
    if (!isMetadataObject(model.metadata)) {
      return failure(`${model.model}: metadata must be an object`);
    }

    const isDefault = model.metadata.is_default;
    if (typeof isDefault !== "boolean") {
      return failure(`${model.model}: is_default must be a boolean`);
    }

    const rawReplacementIds = model.metadata.replaces_model_ids;
    if (!Array.isArray(rawReplacementIds)) {
      return failure(`${model.model}: replaces_model_ids must be an array`);
    }

    const replacementIds: string[] = [];
    const seen = new Set<string>();

    for (const rawReplacementId of rawReplacementIds) {
      if (!isCanonicalBackendModelId(rawReplacementId)) {
        return failure(
          `${model.model}: replacement IDs must be non-empty canonical strings`,
        );
      }
      if (rawReplacementId.startsWith("woven:")) {
        return failure(`${model.model}: replacement IDs must not use the woven: prefix`);
      }
      if (rawReplacementId === model.model) {
        return failure(`${model.model}: a model cannot replace itself`);
      }
      if (seen.has(rawReplacementId)) {
        return failure(`${model.model}: duplicate replacement ID ${rawReplacementId}`);
      }

      replacementIds.push(rawReplacementId);
      seen.add(rawReplacementId);
    }

    policiesByModelId.set(model.model, {
      is_default: isDefault,
      replaces_model_ids: replacementIds,
    });
  }

  const defaultCount = [...policiesByModelId.values()].filter(
    (policy) => policy.is_default,
  ).length;
  if (defaultCount !== 1) {
    return failure(`expected exactly one default model, found ${defaultCount}`);
  }

  const enabledModelIds = new Set(models.map((model) => model.model));
  const replacementOwners = new Map<string, string>();

  for (const [modelId, policy] of policiesByModelId) {
    for (const replacementId of policy.replaces_model_ids) {
      if (enabledModelIds.has(replacementId)) {
        return failure(`${modelId}: replacement ID ${replacementId} is enabled`);
      }

      const existingOwner = replacementOwners.get(replacementId);
      if (existingOwner) {
        return failure(
          `replacement ID ${replacementId} is claimed by ${existingOwner} and ${modelId}`,
        );
      }
      replacementOwners.set(replacementId, modelId);
    }
  }

  return { ok: true, policiesByModelId };
}
```

- [ ] **Step 4: Run the validator tests to verify GREEN**

Run:

```bash
pnpm test tests/hosted-model-selection-policy.test.ts
```

Expected: all validator cases PASS.

- [ ] **Step 5: Commit the validator slice**

```bash
git add lib/ai/hosted-model-selection-policy.ts tests/hosted-model-selection-policy.test.ts
git commit -m "feat(models): validate hosted selection policy"
```

---

### Task 3: Publish policy and fail before Gateway enrichment

**Files:**
- Modify: `app/api/v1/models/route.ts:1-86`
- Modify: `tests/model-catalog-route.test.ts:1-180`

**Interfaces:**
- Consumes: `validateHostedModelSelectionPolicies(models)` from Task 2 and the existing reasoning parser/Gateway enrichment functions.
- Produces: Top-level `is_default` and `replaces_model_ids` on every successful model; `500 invalid_model_catalog` with no Gateway calls on invalid policy.

- [ ] **Step 1: Update the test fixtures with valid explicit selection policy**

In `tests/model-catalog-route.test.ts`, extend `solMetadata`:

```ts
const solMetadata = {
  provider_model_id: "openai/gpt-5.6-sol",
  is_default: true,
  replaces_model_ids: ["openai/gpt-5.5"],
  supports_reasoning: true,
  supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
  default_reasoning_effort: "medium",
};
```

Replace the current `loadRoute` helper with one that exposes the Gateway mock:

```ts
async function loadRoute(
  metadata: unknown,
  gatewayCapabilities: Record<string, unknown> | null,
) {
  vi.doMock("@/lib/api/auth", () => ({
    requireApiAuth: vi.fn(async () => ({
      ok: true,
      auth: { user: { id: "user_1" } },
    })),
  }));
  vi.doMock("@/lib/billing/model-pricing", () => ({
    listHostedChatModels: vi.fn(async () => [model(metadata)]),
  }));
  const getModelCapabilities = vi.fn(async () => gatewayCapabilities);
  vi.doMock("@/lib/ai/model-capabilities", () => ({
    getModelCapabilities,
    applyMarkupToPriceUsd: vi.fn((price: number | null) => price),
  }));

  const { GET } = await import("@/app/api/v1/models/route");
  const response = await GET(new Request("https://example.test/api/v1/models"));
  return { response, getModelCapabilities };
}
```

Update existing calls from:

```ts
const response = await loadRoute(metadata, gatewayCapabilities);
```

to:

```ts
const { response } = await loadRoute(metadata, gatewayCapabilities);
```

For the invalid-reasoning test, keep valid policy fields while making only reasoning invalid:

```ts
{
  is_default: true,
  replaces_model_ids: ["openai/gpt-5.5"],
  supports_reasoning: true,
  supported_reasoning_efforts: ["low", "imaginary"],
  default_reasoning_effort: "low",
}
```

- [ ] **Step 2: Write failing endpoint assertions for top-level policy and fail-closed behavior**

In the successful authority test, extend the expected model object:

```ts
{
  id: "openai/gpt-5.6-sol",
  is_default: true,
  replaces_model_ids: ["openai/gpt-5.5"],
  capabilities: {
    context_length: 1_000_000,
    supports_reasoning: true,
    supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
    default_reasoning_effort: "medium",
    supports_tools: true,
  },
}
```

In the Gateway-failure test, add these exact top-level fields to the complete expected model:

```ts
is_default: true,
replaces_model_ids: ["openai/gpt-5.5"],
```

Replace the former null-metadata safe-reasoning route test with the fail-closed policy test:

```ts
it("rejects invalid selection policy before Gateway enrichment", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { response, getModelCapabilities } = await loadRoute(null, null);

  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({
    error: {
      message: "Hosted model catalog metadata is invalid.",
      type: "invalid_model_catalog",
      code: "invalid_model_catalog",
    },
  });
  expect(getModelCapabilities).not.toHaveBeenCalled();
  expect(consoleError).toHaveBeenCalledWith(
    "[model-catalog] invalid selection policy",
    { reason: "openai/gpt-5.6-sol: metadata must be an object" },
  );
});
```

- [ ] **Step 3: Run the route tests to verify RED**

Run:

```bash
pnpm test tests/model-catalog-route.test.ts
```

Expected: FAIL because successful models omit both top-level policy fields and null metadata still follows the reasoning-only safe fallback instead of failing before Gateway enrichment.

- [ ] **Step 4: Validate and serialize selection policy in the route**

Replace `app/api/v1/models/route.ts` with:

```ts
import {
  parseHostedReasoningCapabilities,
} from "@/lib/ai/hosted-reasoning-capabilities";
import {
  validateHostedModelSelectionPolicies,
} from "@/lib/ai/hosted-model-selection-policy";
import {
  applyMarkupToPriceUsd,
  getModelCapabilities,
} from "@/lib/ai/model-capabilities";
import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { listHostedChatModels } from "@/lib/billing/model-pricing";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const models = await listHostedChatModels();
    const selectionPolicy = validateHostedModelSelectionPolicies(models);

    if (!selectionPolicy.ok) {
      console.error("[model-catalog] invalid selection policy", {
        reason: selectionPolicy.reason,
      });
      return apiError(
        "Hosted model catalog metadata is invalid.",
        500,
        "invalid_model_catalog",
      );
    }

    const enriched = await Promise.all(
      models.map(async (model) => {
        const policy = selectionPolicy.policiesByModelId.get(model.model)!;
        const caps = await getModelCapabilities(model.model);
        const reasoning = parseHostedReasoningCapabilities(model.metadata);

        if (!reasoning.ok) {
          console.warn("[model-catalog] invalid reasoning metadata", {
            modelId: model.model,
            reason: reasoning.reason,
          });
        }

        return {
          id: model.model,
          object: "model" as const,
          created: 0,
          owned_by: "woven",
          display_name: model.display_name,
          is_default: policy.is_default,
          replaces_model_ids: policy.replaces_model_ids,
          capabilities: {
            context_length: caps?.context_length ?? null,
            input_modalities: caps?.input_modalities ?? [],
            output_modalities: caps?.output_modalities ?? [],
            ...reasoning.value,
            supports_tools: caps?.supports_tools ?? false,
            supports_vision: caps?.supports_vision ?? false,
            supports_files: caps?.supports_files ?? false,
          },
          pricing: caps
            ? {
                input_per_mtok_usd: applyMarkupToPriceUsd(
                  caps.pricing_input_per_mtok_usd,
                  model.markup_bps,
                ),
                output_per_mtok_usd: applyMarkupToPriceUsd(
                  caps.pricing_output_per_mtok_usd,
                  model.markup_bps,
                ),
                cached_input_per_mtok_usd: applyMarkupToPriceUsd(
                  caps.pricing_cached_input_per_mtok_usd,
                  model.markup_bps,
                ),
                markup_bps: model.markup_bps,
              }
            : null,
        };
      }),
    );

    return Response.json({
      object: "list",
      data: enriched,
    });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Unable to list models.",
      500,
      "internal_server_error",
    );
  }
}
```

- [ ] **Step 5: Run all focused policy/catalog tests to verify GREEN**

Run:

```bash
pnpm test tests/model-catalog-route.test.ts tests/hosted-model-selection-policy.test.ts tests/hosted-model-selection-policy-migration.test.ts tests/hosted-reasoning-capabilities.test.ts tests/hosted-reasoning-efforts-migration.test.ts
```

Expected: all focused test files PASS. Existing invalid reasoning metadata still returns a model with the safe reasoning fallback because its selection policy is valid.

- [ ] **Step 6: Run the complete repository gates**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: complete Vitest suite PASS, Next.js production build PASS with `/api/v1/models` dynamic and `/pricing` static, and no whitespace errors.

- [ ] **Step 7: Commit the endpoint slice**

```bash
git add app/api/v1/models/route.ts tests/model-catalog-route.test.ts
git commit -m "feat(models): publish hosted selection policy"
```

---

## Production Verification and Coordinated Harness Rollout

- [ ] Apply the reasoning and selection-policy migrations before deploying the updated route.
- [ ] Call authenticated `GET /api/v1/models`; verify exactly one model has `is_default: true`, that model is Sol, and only Sol declares `openai/gpt-5.5` in `replaces_model_ids`.
- [ ] Confirm Sol/Terra reasoning arrays/defaults remain exact and a temporary Gateway failure preserves both selection and reasoning policy while returning `pricing: null`.
- [ ] Smoke-test one non-streaming Sol and Terra request and verify reservation settlement and ledger charges.
- [ ] Ship the coordinated Harness patch only after the live backend contract is present.
- [ ] In Harness, retain existing live selections; otherwise apply a unique live replacement claim; otherwise use the sole live default. Block automatic Woven selection for missing or contradictory live policy.
- [ ] Confirm static/cached policy cannot drive automatic selection, while BYOK's independent local GPT-5.5-to-Sol migration remains intact.
