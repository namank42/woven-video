# Kimi Hosted Default Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `moonshotai/kimi-k2.6` the sole Woven Credits default while keeping GPT-5.6 Sol as the sole declared successor to `openai/gpt-5.5`.

**Architecture:** Correct the pending, unreleased selection-policy seed migration so the database remains the only source of hosted default and replacement metadata. Update the migration, validator, and route contract tests to encode the final five-model policy; the existing validator and model route require no runtime implementation change because they already publish validated database metadata.

**Tech Stack:** PostgreSQL/Supabase migrations, TypeScript, Vitest, Next.js 16 Route Handlers

**Docs digest:** [`docs/superpowers/research/2026-07-12-nextjs-model-catalog-route-docs.md`](../research/2026-07-12-nextjs-model-catalog-route-docs.md)

## Global Constraints

- `moonshotai/kimi-k2.6` is the only model with `is_default: true`.
- `openai/gpt-5.6-sol` has `is_default: false` and retains `replaces_model_ids: ["openai/gpt-5.5"]`.
- Terra, Sonnet, and Opus remain non-default with empty replacement arrays.
- Do not add a request-time GPT-5.5 compatibility alias; GPT-5.5 remains absent from `/api/v1/models` and unsupported by hosted chat admission.
- Keep selection policy database-owned. Do not add a route constant, ordering fallback, or Harness-specific ID.
- Modify the pending unreleased migration directly; do not add a corrective migration.
- Use `pnpm` for all JavaScript and TypeScript verification.

---

### Task 1: Correct the hosted selection-policy contract

**Files:**
- Modify: `tests/hosted-model-selection-policy-migration.test.ts`
- Modify: `tests/hosted-model-selection-policy.test.ts`
- Modify: `tests/model-catalog-route.test.ts`
- Modify: `supabase/migrations/20260712123000_seed_hosted_model_selection_policy.sql`

**Interfaces:**
- Consumes: `validateHostedModelSelectionPolicies(models)` from `lib/ai/hosted-model-selection-policy.ts` and `GET(request)` from `app/api/v1/models/route.ts`.
- Produces: the exact persisted metadata policy and the corresponding top-level `is_default` and `replaces_model_ids` response fields.

- [ ] **Step 1: Change the migration contract test to require Kimi as the sole default**

In `tests/hosted-model-selection-policy-migration.test.ts`, rename the test and replace the two affected row expectations:

```ts
it("seeds Kimi as the sole default and Sol as the GPT-5.5 successor", () => {
  expect(existsSync(migrationPath)).toBe(true);

  const sql = readFileSync(migrationPath, "utf8");
  const normalized = sql.replace(/\s+/g, " ");

  expect(normalized).toContain(
    "('openai/gpt-5.6-sol', false, '[\"openai/gpt-5.5\"]'::jsonb)",
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
    "('moonshotai/kimi-k2.6', true, '[]'::jsonb)",
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
```

- [ ] **Step 2: Update the validator's canonical five-model fixture**

In `tests/hosted-model-selection-policy.test.ts`, replace `validCatalog()` with the exact final
five-model fixture:

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
      model: "anthropic/claude-sonnet-4.6",
      metadata: { is_default: false, replaces_model_ids: [] },
    },
    {
      model: "anthropic/claude-opus-4.8",
      metadata: { is_default: false, replaces_model_ids: [] },
    },
    {
      model: "moonshotai/kimi-k2.6",
      metadata: { is_default: true, replaces_model_ids: [] },
    },
  ];
}
```

Update the exact policy-map assertion to match:

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
    "anthropic/claude-sonnet-4.6",
    { is_default: false, replaces_model_ids: [] },
  ],
  [
    "anthropic/claude-opus-4.8",
    { is_default: false, replaces_model_ids: [] },
  ],
  ["moonshotai/kimi-k2.6", { is_default: true, replaces_model_ids: [] }],
]);
```

Adjust the catalog-level invalid cases so they still exercise zero and two defaults under the new canonical fixture:

```ts
it("rejects a catalog without a default", () => {
  const catalog = withMetadata(validCatalog(), "moonshotai/kimi-k2.6", {
    is_default: false,
    replaces_model_ids: [],
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
```

Keep Sol non-default in the enabled-replacement test:

```ts
const catalog = withMetadata(validCatalog(), "openai/gpt-5.6-sol", {
  is_default: false,
  replaces_model_ids: ["openai/gpt-5.6-terra"],
});
```

- [ ] **Step 3: Add a route acceptance test for the exact default/replacement split**

In `tests/model-catalog-route.test.ts`, allow `loadRoute` to accept an optional catalog while preserving existing callers:

```ts
async function loadRoute(
  metadata: unknown,
  gatewayCapabilities: Record<string, unknown> | null,
  catalog = [model(metadata)],
) {
  vi.doMock("@/lib/api/auth", () => ({
    requireApiAuth: vi.fn(async () => ({
      ok: true,
      auth: { user: { id: "user_1" } },
    })),
  }));
  vi.doMock("@/lib/billing/model-pricing", () => ({
    listHostedChatModels: vi.fn(async () => catalog),
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

Add this test before the reasoning-capability cases:

```ts
it("publishes Kimi as the sole default while Sol retains the GPT-5.5 replacement", async () => {
  const sol = model({
    ...solMetadata,
    is_default: false,
  });
  const kimi = {
    ...model({
      provider_model_id: "moonshotai/kimi-k2.6",
      is_default: true,
      replaces_model_ids: [],
      supports_reasoning: true,
      supported_reasoning_efforts: [],
      default_reasoning_effort: null,
    }),
    id: "rule_kimi",
    model: "moonshotai/kimi-k2.6",
    display_name: "Kimi K2.6",
  };

  const { response } = await loadRoute(solMetadata, null, [sol, kimi]);
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
      id: "moonshotai/kimi-k2.6",
      is_default: true,
      replaces_model_ids: [],
    },
  ]);
  expect(
    body.data.filter((entry: { is_default: boolean }) => entry.is_default),
  ).toHaveLength(1);
});
```

- [ ] **Step 4: Run focused tests and confirm the migration contract is red**

Run:

```bash
pnpm exec vitest run \
  tests/hosted-model-selection-policy-migration.test.ts \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-catalog-route.test.ts
```

Expected: the migration contract test fails because the SQL still seeds Sol as default. The validator and route tests pass because their inputs explicitly describe the corrected policy.

- [ ] **Step 5: Correct the pending selection-policy migration**

In `supabase/migrations/20260712123000_seed_hosted_model_selection_policy.sql`, replace the `values` block with:

```sql
  values
    ('openai/gpt-5.6-sol', false, '["openai/gpt-5.5"]'::jsonb),
    ('openai/gpt-5.6-terra', false, '[]'::jsonb),
    ('anthropic/claude-sonnet-4.6', false, '[]'::jsonb),
    ('anthropic/claude-opus-4.8', false, '[]'::jsonb),
    ('moonshotai/kimi-k2.6', true, '[]'::jsonb)
```

Do not change the metadata merge expression or provider/operation filters.

- [ ] **Step 6: Run focused tests and confirm they are green**

Run the same focused command from Step 4.

Expected: all three test files pass.

- [ ] **Step 7: Reset the local database and verify exact persisted policy**

Run:

```bash
supabase db reset
```

Expected: all migrations apply successfully.

Then run:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -x -c "select model, metadata->'is_default' as is_default, metadata->'replaces_model_ids' as replaces_model_ids from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and enabled = true order by model;"
```

Expected: exactly five enabled hosted chat rows; Kimi is the only `true` value; Sol alone contains `["openai/gpt-5.5"]`.

- [ ] **Step 8: Run whole-branch verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all tests pass, the Next.js build succeeds, and `git diff --check` prints nothing.

- [ ] **Step 9: Commit the implementation**

```bash
git add \
  tests/hosted-model-selection-policy-migration.test.ts \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-catalog-route.test.ts \
  supabase/migrations/20260712123000_seed_hosted_model_selection_policy.sql
git commit -m "fix(models): make Kimi the hosted default"
```
