# Hosted Reasoning Effort Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `GET /api/v1/models` publish the exact backend-reviewed reasoning effort array and default for every enabled hosted chat model, without inferring tiers from Gateway's generic reasoning flag.

**Architecture:** Store the reviewed reasoning contract in each chat model's `model_pricing_rules.metadata`, parse it through one pure strict validator, and merge it into the model catalog independently of live Gateway enrichment. Invalid metadata safely degrades only the reasoning controls, while a Gateway catalog failure preserves the backend-owned reasoning contract and nulls only live pricing/capability data.

**Tech Stack:** PostgreSQL/Supabase migrations, TypeScript 5, Next.js 16 App Router route handlers, Vitest 4, pnpm

**Docs digest:** [`docs/superpowers/research/2026-07-12-hosted-reasoning-efforts-docs.md`](../research/2026-07-12-hosted-reasoning-efforts-docs.md)

## Global Constraints

- `model_pricing_rules.metadata` is authoritative for `supports_reasoning`, `supported_reasoning_efforts`, and `default_reasoning_effort`.
- Never infer effort levels from Gateway's `supports_reasoning` boolean or `supported_parameters` list.
- Allowed selectable values are `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, in that canonical increasing-effort order.
- `off` and provider-level `none` are not catalog effort values; Harness owns the separate Off state.
- A valid empty effort array can coexist with `supports_reasoning: true`; Kimi K2.6 is the current case.
- Missing or invalid metadata keeps the model available and publishes the safe reasoning fallback `false`, `[]`, `null` with a structured warning.
- Live Gateway enrichment remains authoritative for context, modalities, tools, vision, files, and pricing only.
- Do not add request-time rejection of unsupported effort values in this revision.
- Do not modify `woven-harness` from this repository; its consumer patch is coordinated separately.
- Use `pnpm`, preserve RED -> GREEN test evidence, and commit each independently reviewable task.
- Follow the installed Next.js 16 route-handler contract in `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`: keep the native `Request`/`Response.json` handler and existing `force-dynamic` setting.

## File Structure

- Create `supabase/migrations/20260712121000_seed_hosted_reasoning_efforts.sql` to seed the exact five-model reasoning contract without overwriting unrelated metadata.
- Create `tests/hosted-reasoning-efforts-migration.test.ts` to lock the model IDs, exact ordered arrays, defaults, JSON keys, and idempotent metadata merge.
- Create `lib/ai/hosted-reasoning-capabilities.ts` as the single pure parser and safe-degrade boundary for database reasoning metadata.
- Create `tests/hosted-reasoning-capabilities.test.ts` to cover valid non-empty/empty contracts and every invalid-combination class.
- Modify `app/api/v1/models/route.ts` to merge parsed backend reasoning data with optional live Gateway data.
- Create `tests/model-catalog-route.test.ts` to prove backend authority, Gateway-failure preservation, and structured invalid-metadata degradation.

---

### Task 1: Seed the exact five-model metadata contract

**Files:**
- Create: `supabase/migrations/20260712121000_seed_hosted_reasoning_efforts.sql`
- Create: `tests/hosted-reasoning-efforts-migration.test.ts`

**Interfaces:**
- Consumes: Existing `public.model_pricing_rules.metadata jsonb` rows and the five enabled model IDs established by prior migrations.
- Produces: Metadata keys `supports_reasoning`, `supported_reasoning_efforts`, and `default_reasoning_effort` for Sol, Terra, Sonnet 4.6, Opus 4.8, and Kimi K2.6.

- [ ] **Step 1: Write the failing migration contract test**

Create `tests/hosted-reasoning-efforts-migration.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712121000_seed_hosted_reasoning_efforts.sql",
);

describe("hosted reasoning effort metadata migration", () => {
  it("seeds the exact reviewed contract for every enabled hosted chat model", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('openai/gpt-5.6-sol', '[\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]'::jsonb, 'medium')",
    );
    expect(normalized).toContain(
      "('openai/gpt-5.6-terra', '[\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]'::jsonb, 'medium')",
    );
    expect(normalized).toContain(
      "('anthropic/claude-sonnet-4.6', '[\"low\", \"medium\", \"high\", \"max\"]'::jsonb, 'high')",
    );
    expect(normalized).toContain(
      "('anthropic/claude-opus-4.8', '[\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]'::jsonb, 'high')",
    );
    expect(normalized).toContain(
      "('moonshotai/kimi-k2.6', '[]'::jsonb, null)",
    );
    expect(normalized).toContain("'supports_reasoning', true");
    expect(normalized).toContain("'supported_reasoning_efforts', contract.efforts");
    expect(normalized).toContain("'default_reasoning_effort', contract.default_effort");
    expect(normalized).toContain("coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(");
    expect(normalized).toContain("rules.provider = 'vercel-ai-gateway'");
    expect(normalized).toContain("rules.operation = 'chat'");
    expect(sql).not.toMatch(/metadata\s*=\s*jsonb_build_object/i);
  });
});
```

- [ ] **Step 2: Run the migration test to verify RED**

Run:

```bash
pnpm test tests/hosted-reasoning-efforts-migration.test.ts
```

Expected: FAIL because `20260712121000_seed_hosted_reasoning_efforts.sql` does not exist.

- [ ] **Step 3: Add the immutable idempotent migration**

Create `supabase/migrations/20260712121000_seed_hosted_reasoning_efforts.sql`:

```sql
-- Publish reviewed, model-specific reasoning controls through GET /api/v1/models.
-- Gateway exposes only generic reasoning support, so exact selectable tiers and
-- defaults live in model_pricing_rules.metadata.

with reasoning_contract(model, efforts, default_effort) as (
  values
    ('openai/gpt-5.6-sol', '["low", "medium", "high", "xhigh", "max"]'::jsonb, 'medium'),
    ('openai/gpt-5.6-terra', '["low", "medium", "high", "xhigh", "max"]'::jsonb, 'medium'),
    ('anthropic/claude-sonnet-4.6', '["low", "medium", "high", "max"]'::jsonb, 'high'),
    ('anthropic/claude-opus-4.8', '["low", "medium", "high", "xhigh", "max"]'::jsonb, 'high'),
    ('moonshotai/kimi-k2.6', '[]'::jsonb, null)
)
update public.model_pricing_rules as rules
set metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'supports_reasoning', true,
      'supported_reasoning_efforts', contract.efforts,
      'default_reasoning_effort', contract.default_effort
    ),
    updated_at = now()
from reasoning_contract as contract
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = contract.model;
```

- [ ] **Step 4: Run the focused migration test to verify GREEN**

Run:

```bash
pnpm test tests/hosted-reasoning-efforts-migration.test.ts
```

Expected: 1 test file PASS.

- [ ] **Step 5: Apply all migrations locally and verify exact persisted JSON**

Run:

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -P pager=off -c "select model, metadata->'supports_reasoning' as supports_reasoning, metadata->'supported_reasoning_efforts' as efforts, metadata->'default_reasoning_effort' as default_effort from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and enabled order by model;"
```

Expected: exactly five enabled rows. Sol/Terra show `low, medium, high, xhigh, max` and `medium`; Sonnet shows `low, medium, high, max` and `high`; Opus shows `low, medium, high, xhigh, max` and `high`; Kimi shows `[]` and JSON `null`.

- [ ] **Step 6: Commit the migration slice**

```bash
git add supabase/migrations/20260712121000_seed_hosted_reasoning_efforts.sql tests/hosted-reasoning-efforts-migration.test.ts
git commit -m "feat(models): seed hosted reasoning efforts"
```

---

### Task 2: Add the pure metadata validator and safe fallback

**Files:**
- Create: `lib/ai/hosted-reasoning-capabilities.ts`
- Create: `tests/hosted-reasoning-capabilities.test.ts`

**Interfaces:**
- Consumes: `Record<string, unknown>` from `ModelPricingRule.metadata`.
- Produces: `parseHostedReasoningCapabilities(metadata): HostedReasoningParseResult`, where both success and failure contain a complete snake_case wire value and failure additionally contains a deterministic `reason`.

- [ ] **Step 1: Write failing parser tests for valid and invalid contracts**

Create `tests/hosted-reasoning-capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseHostedReasoningCapabilities } from "@/lib/ai/hosted-reasoning-capabilities";

const safeFallback = {
  supports_reasoning: false,
  supported_reasoning_efforts: [],
  default_reasoning_effort: null,
};

describe("parseHostedReasoningCapabilities", () => {
  it("accepts an exact ordered effort array and a member default", () => {
    expect(
      parseHostedReasoningCapabilities({
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
        default_reasoning_effort: "medium",
      }),
    ).toEqual({
      ok: true,
      value: {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
        default_reasoning_effort: "medium",
      },
    });
  });

  it("accepts reasoning support without granular tiers", () => {
    expect(
      parseHostedReasoningCapabilities({
        supports_reasoning: true,
        supported_reasoning_efforts: [],
        default_reasoning_effort: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        supports_reasoning: true,
        supported_reasoning_efforts: [],
        default_reasoning_effort: null,
      },
    });
  });

  it("accepts a fully disabled reasoning contract", () => {
    expect(
      parseHostedReasoningCapabilities({
        supports_reasoning: false,
        supported_reasoning_efforts: [],
        default_reasoning_effort: null,
      }),
    ).toEqual({ ok: true, value: safeFallback });
  });

  it.each([
    [{}, "supports_reasoning must be a boolean"],
    [
      { supports_reasoning: true },
      "supported_reasoning_efforts must be an array",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "none"],
        default_reasoning_effort: "low",
      },
      "supported_reasoning_efforts contains unsupported value: none",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "low"],
        default_reasoning_effort: "low",
      },
      "supported_reasoning_efforts contains duplicate value: low",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["high", "medium"],
        default_reasoning_effort: "high",
      },
      "supported_reasoning_efforts must use canonical order",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "high"],
        default_reasoning_effort: null,
      },
      "non-empty supported_reasoning_efforts requires a member default_reasoning_effort",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "high"],
        default_reasoning_effort: "medium",
      },
      "non-empty supported_reasoning_efforts requires a member default_reasoning_effort",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: [],
        default_reasoning_effort: "high",
      },
      "empty supported_reasoning_efforts requires a null default_reasoning_effort",
    ],
    [
      {
        supports_reasoning: false,
        supported_reasoning_efforts: ["low"],
        default_reasoning_effort: "low",
      },
      "supports_reasoning false requires empty efforts and a null default",
    ],
  ] as const)("safe-degrades invalid metadata %#", (metadata, reason) => {
    expect(parseHostedReasoningCapabilities(metadata)).toEqual({
      ok: false,
      value: safeFallback,
      reason,
    });
  });
});
```

- [ ] **Step 2: Run the parser test to verify RED**

Run:

```bash
pnpm test tests/hosted-reasoning-capabilities.test.ts
```

Expected: FAIL because `@/lib/ai/hosted-reasoning-capabilities` does not exist.

- [ ] **Step 3: Implement the strict pure parser**

Create `lib/ai/hosted-reasoning-capabilities.ts`:

```ts
export const HOSTED_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type HostedReasoningEffort = (typeof HOSTED_REASONING_EFFORTS)[number];

export type HostedReasoningCapabilities = {
  supports_reasoning: boolean;
  supported_reasoning_efforts: HostedReasoningEffort[];
  default_reasoning_effort: HostedReasoningEffort | null;
};

export type HostedReasoningParseResult =
  | { ok: true; value: HostedReasoningCapabilities }
  | { ok: false; value: HostedReasoningCapabilities; reason: string };

const effortOrder = new Map<HostedReasoningEffort, number>(
  HOSTED_REASONING_EFFORTS.map((effort, index) => [effort, index]),
);

function failure(reason: string): HostedReasoningParseResult {
  return {
    ok: false,
    value: {
      supports_reasoning: false,
      supported_reasoning_efforts: [],
      default_reasoning_effort: null,
    },
    reason,
  };
}

function isHostedReasoningEffort(value: unknown): value is HostedReasoningEffort {
  return typeof value === "string" && effortOrder.has(value as HostedReasoningEffort);
}

export function parseHostedReasoningCapabilities(
  metadata: Record<string, unknown>,
): HostedReasoningParseResult {
  const supportsReasoning = metadata.supports_reasoning;
  if (typeof supportsReasoning !== "boolean") {
    return failure("supports_reasoning must be a boolean");
  }

  const rawEfforts = metadata.supported_reasoning_efforts;
  if (!Array.isArray(rawEfforts)) {
    return failure("supported_reasoning_efforts must be an array");
  }

  const efforts: HostedReasoningEffort[] = [];
  const seen = new Set<HostedReasoningEffort>();
  let priorOrder = -1;

  for (const rawEffort of rawEfforts) {
    if (!isHostedReasoningEffort(rawEffort)) {
      return failure(
        `supported_reasoning_efforts contains unsupported value: ${String(rawEffort)}`,
      );
    }
    if (seen.has(rawEffort)) {
      return failure(`supported_reasoning_efforts contains duplicate value: ${rawEffort}`);
    }

    const order = effortOrder.get(rawEffort)!;
    if (order <= priorOrder) {
      return failure("supported_reasoning_efforts must use canonical order");
    }

    efforts.push(rawEffort);
    seen.add(rawEffort);
    priorOrder = order;
  }

  const defaultEffort = metadata.default_reasoning_effort;

  if (!supportsReasoning && (efforts.length > 0 || defaultEffort !== null)) {
    return failure("supports_reasoning false requires empty efforts and a null default");
  }

  if (efforts.length === 0 && defaultEffort !== null) {
    return failure("empty supported_reasoning_efforts requires a null default_reasoning_effort");
  }

  if (
    efforts.length > 0 &&
    (!isHostedReasoningEffort(defaultEffort) || !seen.has(defaultEffort))
  ) {
    return failure(
      "non-empty supported_reasoning_efforts requires a member default_reasoning_effort",
    );
  }

  return {
    ok: true,
    value: {
      supports_reasoning: supportsReasoning,
      supported_reasoning_efforts: efforts,
      default_reasoning_effort: isHostedReasoningEffort(defaultEffort) ? defaultEffort : null,
    },
  };
}
```

- [ ] **Step 4: Run the parser test to verify GREEN**

Run:

```bash
pnpm test tests/hosted-reasoning-capabilities.test.ts
```

Expected: all parser cases PASS.

- [ ] **Step 5: Run TypeScript/build validation for the new public types**

Run:

```bash
pnpm build
```

Expected: Next.js production build PASS with no TypeScript error from the parser or test imports.

- [ ] **Step 6: Commit the parser slice**

```bash
git add lib/ai/hosted-reasoning-capabilities.ts tests/hosted-reasoning-capabilities.test.ts
git commit -m "feat(models): validate hosted reasoning metadata"
```

---

### Task 3: Publish backend reasoning metadata through the model endpoint

**Files:**
- Modify: `app/api/v1/models/route.ts:1-74`
- Create: `tests/model-catalog-route.test.ts`

**Interfaces:**
- Consumes: `parseHostedReasoningCapabilities(model.metadata)` from Task 2 and optional `ModelCapabilities` from `getModelCapabilities(model.model)`.
- Produces: Each catalog item's `capabilities` object always contains `supports_reasoning`, `supported_reasoning_efforts`, and `default_reasoning_effort`; live-only values use neutral fallbacks when Gateway enrichment is unavailable, while `pricing` remains `null`.

- [ ] **Step 1: Write failing route tests for backend authority and safe degradation**

Create `tests/model-catalog-route.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const solMetadata = {
  provider_model_id: "openai/gpt-5.6-sol",
  supports_reasoning: true,
  supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
  default_reasoning_effort: "medium",
};

function model(metadata: Record<string, unknown> = solMetadata) {
  return {
    id: "rule_1",
    provider: "vercel-ai-gateway",
    model: "openai/gpt-5.6-sol",
    operation: "chat",
    display_name: "GPT-5.6 Sol",
    markup_bps: 2_000,
    minimum_charge_usd_micros: 1,
    reserve_amount_usd_micros: 100_000,
    enabled: true,
    metadata,
  };
}

async function loadRoute(
  metadata: Record<string, unknown>,
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
  vi.doMock("@/lib/ai/model-capabilities", () => ({
    getModelCapabilities: vi.fn(async () => gatewayCapabilities),
    applyMarkupToPriceUsd: vi.fn((price: number | null) => price),
  }));

  const { GET } = await import("@/app/api/v1/models/route");
  return GET(new Request("https://example.test/api/v1/models"));
}

describe("hosted chat model catalog route", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/billing/model-pricing");
    vi.doUnmock("@/lib/ai/model-capabilities");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("publishes the database effort contract instead of Gateway's generic flag", async () => {
    const response = await loadRoute(solMetadata, {
      context_length: 1_000_000,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      supports_reasoning: false,
      supports_tools: true,
      supports_vision: true,
      supports_files: false,
      pricing_input_per_mtok_usd: 5,
      pricing_output_per_mtok_usd: 30,
      pricing_cached_input_per_mtok_usd: 0.5,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "list",
      data: [
        {
          id: "openai/gpt-5.6-sol",
          capabilities: {
            context_length: 1_000_000,
            supports_reasoning: true,
            supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
            default_reasoning_effort: "medium",
            supports_tools: true,
          },
          pricing: {
            input_per_mtok_usd: 5,
            output_per_mtok_usd: 30,
            cached_input_per_mtok_usd: 0.5,
            markup_bps: 2_000,
          },
        },
      ],
    });
  });

  it("preserves backend reasoning controls when Gateway enrichment fails", async () => {
    const response = await loadRoute(solMetadata, null);

    await expect(response.json()).resolves.toEqual({
      object: "list",
      data: [
        {
          id: "openai/gpt-5.6-sol",
          object: "model",
          created: 0,
          owned_by: "woven",
          display_name: "GPT-5.6 Sol",
          capabilities: {
            context_length: null,
            input_modalities: [],
            output_modalities: [],
            supports_reasoning: true,
            supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
            default_reasoning_effort: "medium",
            supports_tools: false,
            supports_vision: false,
            supports_files: false,
          },
          pricing: null,
        },
      ],
    });
  });

  it("warns and publishes the safe fallback for invalid metadata", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await loadRoute(
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "imaginary"],
        default_reasoning_effort: "low",
      },
      null,
    );

    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          capabilities: {
            supports_reasoning: false,
            supported_reasoning_efforts: [],
            default_reasoning_effort: null,
          },
        },
      ],
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "[model-catalog] invalid reasoning metadata",
      {
        modelId: "openai/gpt-5.6-sol",
        reason: "supported_reasoning_efforts contains unsupported value: imaginary",
      },
    );
  });
});
```

- [ ] **Step 2: Run the route tests to verify RED**

Run:

```bash
pnpm test tests/model-catalog-route.test.ts
```

Expected: FAIL because the endpoint still uses Gateway's `supports_reasoning`, omits the exact array/default, and returns `capabilities: null` on Gateway failure.

- [ ] **Step 3: Merge parsed reasoning data into every catalog response**

Replace `app/api/v1/models/route.ts` with:

```ts
import {
  parseHostedReasoningCapabilities,
} from "@/lib/ai/hosted-reasoning-capabilities";
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

    const enriched = await Promise.all(
      models.map(async (model) => {
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

- [ ] **Step 4: Run the focused route and parser tests to verify GREEN**

Run:

```bash
pnpm test tests/model-catalog-route.test.ts tests/hosted-reasoning-capabilities.test.ts tests/hosted-reasoning-efforts-migration.test.ts
```

Expected: all three focused test files PASS.

- [ ] **Step 5: Run the full repository gates**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: full Vitest suite PASS, Next.js 16 production build PASS, and no whitespace errors.

- [ ] **Step 6: Commit the endpoint slice**

```bash
git add app/api/v1/models/route.ts tests/model-catalog-route.test.ts
git commit -m "feat(models): publish exact reasoning efforts"
```

---

## Production Verification and Coordinated Rollout

- [ ] Deploy the new database migration and backend before the Harness consumer patch; the new response fields are additive.
- [ ] Call authenticated `GET /api/v1/models` and confirm the five enabled models expose the exact arrays/defaults from Task 1.
- [ ] Confirm a temporary Gateway enrichment failure leaves reasoning fields present while returning `pricing: null`.
- [ ] Ship the coordinated Harness patch that consumes `supported_reasoning_efforts` and `default_reasoning_effort` verbatim, removes its `[low, medium, high]` inference, adds Sol/Terra to static fallback, retires GPT-5.5, and maps a saved GPT-5.5 selection to Sol.
- [ ] Do not enable backend request-time effort rejection until active Harness versions no longer infer unsupported tiers.
