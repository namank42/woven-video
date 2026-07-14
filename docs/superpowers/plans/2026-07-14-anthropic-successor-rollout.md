# Anthropic Successor Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Sonnet 5 to Woven Credits, retire Sonnet 4.6, and publish the missing Sonnet and Opus replacement claims while preserving Kimi as the sole default.

**Architecture:** One new idempotent Supabase migration atomically upserts Sonnet 5 with its complete reasoning and selection metadata, disables Sonnet 4.6, and adds Opus 4.7 to Opus 4.8's replacement array. The existing catalog validator and route remain data-driven; contract fixtures prove the final five-model policy. Static pricing data presents both the dated launch and standard Sonnet 5 rates without affecting Gateway-cost settlement.

**Tech Stack:** PostgreSQL/Supabase migrations, TypeScript, Vitest, Next.js 16 Route Handlers and static server components

**Docs digests:**
- [`docs/superpowers/research/2026-07-14-claude-sonnet-5-rollout-docs.md`](../research/2026-07-14-claude-sonnet-5-rollout-docs.md)
- [`docs/superpowers/research/2026-07-12-nextjs-model-catalog-route-docs.md`](../research/2026-07-12-nextjs-model-catalog-route-docs.md)

## Global Constraints

- `moonshotai/kimi-k2.6` remains the only enabled model with `is_default: true`.
- `anthropic/claude-sonnet-5` replaces only `anthropic/claude-sonnet-4.6`.
- `anthropic/claude-opus-4.8` replaces only `anthropic/claude-opus-4.7`.
- `openai/gpt-5.6-sol` retains `replaces_model_ids: ["openai/gpt-5.5"]`.
- Sonnet 4.6 is disabled, not deleted, and no request-time model alias is added.
- Sonnet 5 exposes `low`, `medium`, `high`, `xhigh`, and `max` in canonical order with `high` as default.
- Use `markup_bps = 2000`, `minimum_charge_usd_micros = 1`, and `reserve_amount_usd_micros = 50000` for Sonnet 5.
- Public Sonnet 5 rates show the introductory period through August 31, 2026 and the standard period from September 1, 2026.
- Use `pnpm` for JavaScript and TypeScript verification.
- Do not deploy the retirement migration until the compatible Harness release reaches acceptable adoption.

---

### Task 1: Add the atomic Anthropic successor migration

**Files:**
- Create: `tests/anthropic-successor-migration.test.ts`
- Create: `supabase/migrations/20260714120000_rollout_claude_sonnet_5.sql`

**Interfaces:**
- Consumes: `public.model_pricing_rules` and the metadata contract validated by `validateHostedModelSelectionPolicies()` and `parseHostedReasoningCapabilities()`.
- Produces: one enabled Sonnet 5 row, one disabled Sonnet 4.6 row, and the final Opus 4.8 replacement metadata.

- [ ] **Step 1: Write the failing migration source-contract test**

Create `tests/anthropic-successor-migration.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260714120000_rollout_claude_sonnet_5.sql",
);

describe("Anthropic successor migration", () => {
  it("adds Sonnet 5, retires Sonnet 4.6, and declares the Opus successor", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain("insert into public.model_pricing_rules as rules");
    expect(normalized).toContain("'vercel-ai-gateway', 'anthropic/claude-sonnet-5', 'chat', 'Claude Sonnet 5', 2000, 1, 50000, true");
    expect(normalized).toContain("'provider_model_id', 'anthropic/claude-sonnet-5'");
    expect(normalized).toContain("'supports_reasoning', true");
    expect(normalized).toContain(
      "'supported_reasoning_efforts', '[\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]'::jsonb",
    );
    expect(normalized).toContain("'default_reasoning_effort', 'high'");
    expect(normalized).toContain("'is_default', false");
    expect(normalized).toContain(
      "'replaces_model_ids', '[\"anthropic/claude-sonnet-4.6\"]'::jsonb",
    );
    expect(normalized).toContain(
      "metadata = coalesce(rules.metadata, '{}'::jsonb) || excluded.metadata",
    );
    expect(normalized).toContain(
      "set enabled = false, updated_at = now() where provider = 'vercel-ai-gateway' and model = 'anthropic/claude-sonnet-4.6' and operation = 'chat'",
    );
    expect(normalized).toContain(
      "'replaces_model_ids', '[\"anthropic/claude-opus-4.7\"]'::jsonb",
    );
    expect(normalized).toContain(
      "where rules.provider = 'vercel-ai-gateway' and rules.model = 'anthropic/claude-opus-4.8' and rules.operation = 'chat'",
    );
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/metadata\s*=\s*excluded\.metadata\s*[,;]/i);
  });
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```bash
pnpm exec vitest run tests/anthropic-successor-migration.test.ts
```

Expected: FAIL because `20260714120000_rollout_claude_sonnet_5.sql` does not exist.

- [ ] **Step 3: Create the minimal idempotent migration**

Create `supabase/migrations/20260714120000_rollout_claude_sonnet_5.sql`:

```sql
-- Roll out Claude Sonnet 5 and complete backend-owned Anthropic retirement policy.

insert into public.model_pricing_rules as rules (
  provider,
  model,
  operation,
  display_name,
  markup_bps,
  minimum_charge_usd_micros,
  reserve_amount_usd_micros,
  enabled,
  metadata
)
values (
  'vercel-ai-gateway',
  'anthropic/claude-sonnet-5',
  'chat',
  'Claude Sonnet 5',
  2000,
  1,
  50000,
  true,
  jsonb_build_object(
    'provider_model_id', 'anthropic/claude-sonnet-5',
    'supports_reasoning', true,
    'supported_reasoning_efforts', '["low", "medium", "high", "xhigh", "max"]'::jsonb,
    'default_reasoning_effort', 'high',
    'is_default', false,
    'replaces_model_ids', '["anthropic/claude-sonnet-4.6"]'::jsonb
  )
)
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    enabled = true,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.model_pricing_rules
set enabled = false,
    updated_at = now()
where provider = 'vercel-ai-gateway'
  and model = 'anthropic/claude-sonnet-4.6'
  and operation = 'chat';

update public.model_pricing_rules as rules
set metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', false,
      'replaces_model_ids', '["anthropic/claude-opus-4.7"]'::jsonb
    ),
    updated_at = now()
where rules.provider = 'vercel-ai-gateway'
  and rules.model = 'anthropic/claude-opus-4.8'
  and rules.operation = 'chat';
```

- [ ] **Step 4: Run the migration test and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/anthropic-successor-migration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the migration**

```bash
git add \
  tests/anthropic-successor-migration.test.ts \
  supabase/migrations/20260714120000_rollout_claude_sonnet_5.sql
git commit -m "feat(models): roll out Claude Sonnet 5"
```

---

### Task 2: Encode the final five-model catalog contract

**Files:**
- Modify: `tests/hosted-model-selection-policy.test.ts`
- Modify: `tests/model-catalog-route.test.ts`

**Interfaces:**
- Consumes: the migration metadata from Task 1, `validateHostedModelSelectionPolicies(models)`, and `GET(request)` from `app/api/v1/models/route.ts`.
- Produces: regression coverage for Kimi's default, all three successor claims, and Sonnet 5 reasoning metadata in `/api/v1/models`.

- [ ] **Step 1: Update the validator's canonical catalog fixture**

In `tests/hosted-model-selection-policy.test.ts`, replace `validCatalog()` with:

```ts
function validCatalog(): CatalogModel[] {
  return [
    {
      model: "openai/gpt-5.6-sol",
      metadata: {
        is_default: false,
        replaces_model_ids: ["openai/gpt-5.5"],
      },
    },
    {
      model: "openai/gpt-5.6-terra",
      metadata: { is_default: false, replaces_model_ids: [] },
    },
    {
      model: "anthropic/claude-sonnet-5",
      metadata: {
        is_default: false,
        replaces_model_ids: ["anthropic/claude-sonnet-4.6"],
      },
    },
    {
      model: "anthropic/claude-opus-4.8",
      metadata: {
        is_default: false,
        replaces_model_ids: ["anthropic/claude-opus-4.7"],
      },
    },
    {
      model: "moonshotai/kimi-k2.6",
      metadata: { is_default: true, replaces_model_ids: [] },
    },
  ];
}
```

Replace the exact policy-map assertion with:

```ts
expect([...result.policiesByModelId.entries()]).toEqual([
  [
    "openai/gpt-5.6-sol",
    {
      is_default: false,
      replaces_model_ids: ["openai/gpt-5.5"],
    },
  ],
  ["openai/gpt-5.6-terra", { is_default: false, replaces_model_ids: [] }],
  [
    "anthropic/claude-sonnet-5",
    {
      is_default: false,
      replaces_model_ids: ["anthropic/claude-sonnet-4.6"],
    },
  ],
  [
    "anthropic/claude-opus-4.8",
    {
      is_default: false,
      replaces_model_ids: ["anthropic/claude-opus-4.7"],
    },
  ],
  ["moonshotai/kimi-k2.6", { is_default: true, replaces_model_ids: [] }],
]);
```

The existing zero-default, multiple-default, enabled-replacement, duplicate-claim, and malformed-row
tests continue to operate on this fixture without production changes.

- [ ] **Step 2: Add a reusable route-test catalog model helper**

In `tests/model-catalog-route.test.ts`, add after `model()`:

```ts
function catalogModel(
  id: string,
  displayName: string,
  metadata: Record<string, unknown>,
) {
  return {
    ...model(metadata),
    id: `rule_${id.replaceAll(/[^a-z0-9]+/gi, "_")}`,
    model: id,
    display_name: displayName,
  };
}
```

- [ ] **Step 3: Replace the two-model selection route test with the full contract**

Replace `publishes Kimi as the sole default while Sol retains the GPT-5.5 replacement` with:

```ts
it("publishes the exact default, successor, and Sonnet reasoning contract", async () => {
  const catalog = [
    catalogModel("openai/gpt-5.6-sol", "GPT-5.6 Sol", {
      ...solMetadata,
      is_default: false,
    }),
    catalogModel("openai/gpt-5.6-terra", "GPT-5.6 Terra", {
      provider_model_id: "openai/gpt-5.6-terra",
      is_default: false,
      replaces_model_ids: [],
      supports_reasoning: true,
      supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
      default_reasoning_effort: "medium",
    }),
    catalogModel("anthropic/claude-sonnet-5", "Claude Sonnet 5", {
      provider_model_id: "anthropic/claude-sonnet-5",
      is_default: false,
      replaces_model_ids: ["anthropic/claude-sonnet-4.6"],
      supports_reasoning: true,
      supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
      default_reasoning_effort: "high",
    }),
    catalogModel("anthropic/claude-opus-4.8", "Claude Opus 4.8", {
      provider_model_id: "anthropic/claude-opus-4.8",
      is_default: false,
      replaces_model_ids: ["anthropic/claude-opus-4.7"],
      supports_reasoning: true,
      supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
      default_reasoning_effort: "high",
    }),
    catalogModel("moonshotai/kimi-k2.6", "Kimi K2.6", {
      provider_model_id: "moonshotai/kimi-k2.6",
      is_default: true,
      replaces_model_ids: [],
      supports_reasoning: true,
      supported_reasoning_efforts: [],
      default_reasoning_effort: null,
    }),
  ];

  const { response } = await loadRoute(solMetadata, null, catalog);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(
    body.data.map(
      (entry: {
        id: string;
        is_default: boolean;
        replaces_model_ids: string[];
      }) => ({
        id: entry.id,
        is_default: entry.is_default,
        replaces_model_ids: entry.replaces_model_ids,
      }),
    ),
  ).toEqual([
    {
      id: "openai/gpt-5.6-sol",
      is_default: false,
      replaces_model_ids: ["openai/gpt-5.5"],
    },
    {
      id: "openai/gpt-5.6-terra",
      is_default: false,
      replaces_model_ids: [],
    },
    {
      id: "anthropic/claude-sonnet-5",
      is_default: false,
      replaces_model_ids: ["anthropic/claude-sonnet-4.6"],
    },
    {
      id: "anthropic/claude-opus-4.8",
      is_default: false,
      replaces_model_ids: ["anthropic/claude-opus-4.7"],
    },
    {
      id: "moonshotai/kimi-k2.6",
      is_default: true,
      replaces_model_ids: [],
    },
  ]);
  expect(
    body.data.filter((entry: { is_default: boolean }) => entry.is_default),
  ).toHaveLength(1);
  expect(
    body.data.find(
      (entry: { id: string }) => entry.id === "anthropic/claude-sonnet-5",
    )?.capabilities,
  ).toMatchObject({
    supports_reasoning: true,
    supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
    default_reasoning_effort: "high",
  });
  expect(body.data.map((entry: { id: string }) => entry.id)).not.toContain(
    "anthropic/claude-sonnet-4.6",
  );
});
```

- [ ] **Step 4: Run the focused catalog tests**

Run:

```bash
pnpm exec vitest run \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-catalog-route.test.ts
```

Expected: PASS. The route and validator already consume metadata generically, so this task adds
contract coverage without a runtime implementation change.

- [ ] **Step 5: Commit the catalog contract tests**

```bash
git add \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-catalog-route.test.ts
git commit -m "test(models): cover Anthropic successor policy"
```

---

### Task 3: Publish dated Sonnet 5 public rates

**Files:**
- Modify: `lib/pricing-page-rates.ts`
- Modify: `app/pricing/page.tsx`
- Modify: `tests/pricing-page-rates.test.ts`
- Modify: `tests/pricing-page-source.test.ts`

**Interfaces:**
- Consumes: verified provider prices from the research digest and the existing `ChatRateValue` secondary-rate rendering.
- Produces: a Sonnet 5 static rate entry with `rateLabel?: string`, introductory values, and standard values in `higherTier`.

- [ ] **Step 1: Write the failing pricing-data assertions**

In `tests/pricing-page-rates.test.ts`, update the expected chat-model names and add exact Sonnet 5
assertions:

```ts
expect(chatModelRates.map((rate) => rate.name)).toEqual([
  "Claude Sonnet 5",
  "Claude Opus 4.8",
  "GPT-5.6 Sol",
  "GPT-5.6 Terra",
  "Kimi K2.6",
]);

expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
  "anthropic/claude-sonnet-4.6",
);

expect(chatModelRates.find((rate) => rate.name === "Claude Sonnet 5")).toEqual({
  name: "Claude Sonnet 5",
  modelId: "anthropic/claude-sonnet-5",
  rateLabel: "Intro through Aug 31, 2026",
  input: "$2.40/M",
  output: "$12.00/M",
  cacheRead: "$0.24/M",
  cacheWrite: "$3.00/M",
  higherTier: {
    threshold: "From Sep 1, 2026",
    input: "$3.60/M",
    output: "$18.00/M",
    cacheRead: "$0.36/M",
    cacheWrite: "$4.50/M",
  },
});
```

Remove the obsolete assertion that the Sonnet 4.6 entry lacks `higherTier`.

In `tests/pricing-page-source.test.ts`, add:

```ts
it("renders optional dated rate labels on desktop and mobile", async () => {
  const pageSource = await readFile("app/pricing/page.tsx", "utf8");

  expect(pageSource.split("model.rateLabel ?")).toHaveLength(3);
  expect(pageSource.split("{model.rateLabel}")).toHaveLength(3);
});
```

- [ ] **Step 2: Run pricing tests and verify RED**

Run:

```bash
pnpm exec vitest run \
  tests/pricing-page-rates.test.ts \
  tests/pricing-page-source.test.ts
```

Expected: FAIL because the data still contains Sonnet 4.6 and the page does not render
`model.rateLabel`.

- [ ] **Step 3: Add the optional rate label and exact Sonnet 5 data**

In `lib/pricing-page-rates.ts`, add the optional field to `ChatModelRate`:

```ts
export type ChatModelRate = {
  name: string;
  modelId: string;
  rateLabel?: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  higherTier?: ChatModelRateTier;
};
```

Replace the Sonnet 4.6 row with:

```ts
{
  name: "Claude Sonnet 5",
  modelId: "anthropic/claude-sonnet-5",
  rateLabel: "Intro through Aug 31, 2026",
  input: "$2.40/M",
  output: "$12.00/M",
  cacheRead: "$0.24/M",
  cacheWrite: "$3.00/M",
  higherTier: {
    threshold: "From Sep 1, 2026",
    input: "$3.60/M",
    output: "$18.00/M",
    cacheRead: "$0.36/M",
    cacheWrite: "$4.50/M",
  },
},
```

- [ ] **Step 4: Render the dated label in both pricing layouts**

In each model-identity block in `app/pricing/page.tsx`, immediately after the model ID `<code>`, add:

```tsx
{model.rateLabel ? (
  <span className="text-xs text-muted-foreground">
    {model.rateLabel}
  </span>
) : null}
```

Add it once in the desktop table row and once in the mobile card. Keep the existing `higherTier`
rendering so each rate column displays `From Sep 1, 2026: <standard rate>` below the introductory
value.

- [ ] **Step 5: Run pricing tests and verify GREEN**

Run the same focused command from Step 2.

Expected: both test files pass.

- [ ] **Step 6: Commit the public pricing update**

```bash
git add \
  lib/pricing-page-rates.ts \
  app/pricing/page.tsx \
  tests/pricing-page-rates.test.ts \
  tests/pricing-page-source.test.ts
git commit -m "feat(pricing): publish Sonnet 5 rates"
```

---

### Task 4: Verify persisted state and the complete branch

**Files:**
- Verify only; no source changes expected.

**Interfaces:**
- Consumes: all commits from Tasks 1-3.
- Produces: database, unit-test, and production-build evidence required before the backend branch is ready for coordinated rollout.

- [ ] **Step 1: Reset the local database**

Run:

```bash
supabase db reset
```

Expected: every migration applies successfully, including
`20260714120000_rollout_claude_sonnet_5.sql`.

- [ ] **Step 2: Reapply the migration to verify idempotency**

Run:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260714120000_rollout_claude_sonnet_5.sql
```

Expected: the migration succeeds a second time without duplicate rows or constraint errors.

- [ ] **Step 3: Verify the exact enabled catalog and replacement metadata**

Run:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -x -c "select model, enabled, metadata->'is_default' as is_default, metadata->'replaces_model_ids' as replaces_model_ids, metadata->'supported_reasoning_efforts' as supported_reasoning_efforts, metadata->>'default_reasoning_effort' as default_reasoning_effort from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and model in ('openai/gpt-5.6-sol', 'openai/gpt-5.6-terra', 'anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.8', 'anthropic/claude-opus-4.7', 'moonshotai/kimi-k2.6') order by model;"
```

Expected:

- Sonnet 5 is enabled, non-default, replaces Sonnet 4.6, and has all five efforts with `high` default.
- Sonnet 4.6 is disabled.
- Opus 4.8 is enabled, non-default, and replaces Opus 4.7.
- Opus 4.7 is disabled.
- Sol retains the GPT-5.5 claim.
- Kimi is the only default.

- [ ] **Step 4: Run all focused contract tests**

Run:

```bash
pnpm exec vitest run \
  tests/anthropic-successor-migration.test.ts \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-catalog-route.test.ts \
  tests/pricing-page-rates.test.ts \
  tests/pricing-page-source.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Run whole-branch verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
git status --short --branch
```

Expected: the complete test suite passes, the Next.js production build succeeds, `git diff --check`
prints nothing, and the worktree is clean on `feat/gpt-5-6-sol-terra-credits`.

- [ ] **Step 6: Record the coordinated rollout gates in the handoff**

The completion handoff must state all of the following:

```text
- Release the compatible Harness build before deploying this backend migration.
- Wait for acceptable desktop adoption before retiring Sonnet 4.6.
- Smoke-test anthropic/claude-sonnet-5 through Vercel AI Gateway before deployment.
- After deployment, verify authenticated /api/v1/models, Sonnet 5 streaming chat, reservation and settlement, and expected Sonnet 4.6 model_not_found.
- If rollback is required, use a new migration that re-enables Sonnet 4.6, keeps Sonnet 5 enabled, and clears Sonnet 5's replacement claim.
```
