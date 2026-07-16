# Kimi K3 Hosted Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Immediately replace Kimi K2.6 with Kimi K3 as the sole default Woven-credits chat model, publish the exact K3 rate and capability contract, preserve saved-session migration, and prove production execution and billing.

**Architecture:** A single idempotent Supabase migration upserts `moonshotai/kimi-k3`, makes it the sole enabled default, declares K2.6 as its retired predecessor, and disables the historical K2.6 row without deleting it. The existing backend-owned catalog and request authorization stay generic. Public pricing and SEO copy ship in the same web release. A separate Harness patch consumes the backend successor policy, removes the stale static K2.6 current-model constant, and adds only a 1M fallback for K3; it is independently reviewable and does not block the hosted cutover.

**Tech Stack:** PostgreSQL/Supabase migrations, Next.js 16.2.3, TypeScript, Vitest 4.1.9, pnpm 11.9.0, Swift/XCTest, Node test runner, Git/GitHub CLI, Vercel AI Gateway, Vercel Git deployments

**Approved design:** [`docs/superpowers/specs/2026-07-17-kimi-k3-hosted-cutover-design.md`](../specs/2026-07-17-kimi-k3-hosted-cutover-design.md)

**Docs digests:** [`docs/superpowers/research/2026-07-17-kimi-k3-hosted-cutover-docs.md`](../research/2026-07-17-kimi-k3-hosted-cutover-docs.md), [`docs/superpowers/research/2026-07-15-hosted-model-full-cutover-release-docs.md`](../research/2026-07-15-hosted-model-full-cutover-release-docs.md)

## Global constraints

- This is an immediate hosted-only cutover. Do not add Moonshot BYOK support.
- Exact new model ID: `moonshotai/kimi-k3`. Exact retired model ID: `moonshotai/kimi-k2.6`.
- K3 is the sole enabled default and claims `replaces_model_ids: ["moonshotai/kimi-k2.6"]`.
- K2.6 becomes disabled, non-default, and claims no retired IDs. Preserve its row and all historical jobs, usage, and ledger records.
- Do not add a K2.6 compatibility alias or request-time model rewrite. Direct K2.6 requests must fail with the existing `404 model_not_found` path.
- K3 reasoning is always-on/fixed: `supports_reasoning: true`, `supported_reasoning_efforts: []`, `default_reasoning_effort: null`.
- Live Gateway catalog and endpoint metadata are runtime truth: 1,000,000 context; 131,072 maximum output; text/image/file input; text output; tools, vision, files, reasoning; no advertised video input.
- Base Gateway rates are `$3.00/M` input, `$15.00/M` output, and `$0.30/M` cached input. With the standard 20% Woven markup, publish exactly `$3.60/M`, `$18.00/M`, `$0.36/M`, and no cache-write rate.
- Final enabled catalog remains exactly five rows: GPT-5.6 Sol, GPT-5.6 Terra, Claude Sonnet 5, Claude Opus 4.8, and Kimi K3.
- The existing successor claims for GPT-5.5, Sonnet 4.6, and Opus 4.7 remain unchanged.
- The Harness catalog remains backend-owned. Do not add a static `ChatModel.kimiK3` source constant.
- Before editing Next.js code, read `node_modules/next/dist/docs/01-app/02-guides/production-checklist.md`; Next.js APIs and conventions in this repo are not assumed from memory.
- Use RED -> GREEN for every behavior change. Never edit a migration after production records it; rollback is a new forward migration.
- Production Supabase project ref is exactly `rlhjpovwwsqdeklhnvfl`; canonical production origin is `https://www.woven.video`.
- Never print bearer tokens, Gateway keys, database passwords, Supabase service-role keys, or full environment files.

---

### Task 1: Add the atomic K3 forward migration

**Files:**
- Create: `tests/kimi-k3-migration.test.ts`
- Create: `supabase/migrations/20260717120000_rollout_kimi_k3.sql`

**Interfaces:**
- Writes `public.model_pricing_rules` for provider `vercel-ai-gateway`, operation `chat`.
- Produces one enabled K3 rule and one disabled historical K2.6 rule without touching unrelated models or replacing unrelated metadata.

- [ ] **Step 1: Write the failing migration source-contract test**

Create `tests/kimi-k3-migration.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260717120000_rollout_kimi_k3.sql",
);

describe("Kimi K3 cutover migration", () => {
  it("atomically enables K3 as the K2.6 successor and disables K2.6", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "'vercel-ai-gateway', 'moonshotai/kimi-k3', 'chat', 'Kimi K3', 2000, 1, 50000, true",
    );
    expect(normalized).toContain(
      "'provider_model_id', 'moonshotai/kimi-k3'",
    );
    expect(normalized).toContain("'supports_reasoning', true");
    expect(normalized).toContain("'supported_reasoning_efforts', '[]'::jsonb");
    expect(normalized).toContain("'default_reasoning_effort', null");
    expect(normalized).toContain("'is_default', true");
    expect(normalized).toContain(
      "'replaces_model_ids', '[\"moonshotai/kimi-k2.6\"]'::jsonb",
    );
    expect(normalized).toContain("metadata = coalesce(rules.metadata, '{}'::jsonb) || excluded.metadata");
    expect(normalized).toContain("set enabled = false");
    expect(normalized).toContain("'is_default', false");
    expect(normalized).toContain("'replaces_model_ids', '[]'::jsonb");
    expect(normalized).toContain(
      "where rules.provider = 'vercel-ai-gateway' and rules.operation = 'chat' and rules.model = 'moonshotai/kimi-k2.6'",
    );
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/metadata\s*=\s*excluded\.metadata/i);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run tests/kimi-k3-migration.test.ts
```

Expected: one failed test because `20260717120000_rollout_kimi_k3.sql` does not exist.

- [ ] **Step 3: Add the exact idempotent migration**

Create `supabase/migrations/20260717120000_rollout_kimi_k3.sql`:

```sql
-- Replace Kimi K2.6 with Kimi K3 as the sole hosted default while preserving
-- historical rows and unrelated provider, reasoning, and selection metadata.

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
  'moonshotai/kimi-k3',
  'chat',
  'Kimi K3',
  2000,
  1,
  50000,
  true,
  jsonb_build_object(
    'provider_model_id', 'moonshotai/kimi-k3',
    'supports_reasoning', true,
    'supported_reasoning_efforts', '[]'::jsonb,
    'default_reasoning_effort', null,
    'is_default', true,
    'replaces_model_ids', '["moonshotai/kimi-k2.6"]'::jsonb
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

update public.model_pricing_rules as rules
set enabled = false,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', false,
      'replaces_model_ids', '[]'::jsonb
    ),
    updated_at = now()
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = 'moonshotai/kimi-k2.6';
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/kimi-k3-migration.test.ts
```

Expected: one passing test.

- [ ] **Step 5: Commit the migration slice**

Run:

```bash
git add tests/kimi-k3-migration.test.ts supabase/migrations/20260717120000_rollout_kimi_k3.sql
git diff --cached --check
git commit -m "feat(models): cut over to Kimi K3"
```

---

### Task 2: Publish the exact backend catalog contract

**Files:**
- Modify: `tests/hosted-model-selection-policy.test.ts`
- Modify: `tests/model-catalog-route.test.ts`
- Modify: `tests/model-pricing.test.ts`
- Create: `tests/chat-completions-model-policy.test.ts`
- Verify unchanged: `app/api/v1/models/route.ts`
- Verify unchanged: `lib/billing/model-pricing.ts`

**Interfaces:**
- `GET /api/v1/models` publishes K3 as the sole default and K2.6 successor.
- The generic enabled-row query omits disabled K2.6; the generic route enriches K3 with live Gateway capabilities and pricing.

- [ ] **Step 1: Change selection-policy fixtures to the approved K3 contract**

In `tests/hosted-model-selection-policy.test.ts`, replace the K2.6 entry in `validCatalog()` with:

```ts
{
  model: "moonshotai/kimi-k3",
  metadata: {
    is_default: true,
    replaces_model_ids: ["moonshotai/kimi-k2.6"],
  },
},
```

Change the exact expected map entry to:

```ts
[
  "moonshotai/kimi-k3",
  {
    is_default: true,
    replaces_model_ids: ["moonshotai/kimi-k2.6"],
  },
],
```

Change the zero-default test to call `withMetadata(validCatalog(), "moonshotai/kimi-k3", ...)`.

- [ ] **Step 2: Change the full route fixture and add an exact K3 enrichment assertion**

In the first test in `tests/model-catalog-route.test.ts`, replace the K2.6 catalog entry with:

```ts
catalogModel("moonshotai/kimi-k3", "Kimi K3", {
  provider_model_id: "moonshotai/kimi-k3",
  is_default: true,
  replaces_model_ids: ["moonshotai/kimi-k2.6"],
  supports_reasoning: true,
  supported_reasoning_efforts: [],
  default_reasoning_effort: null,
}),
```

Replace the expected K2.6 policy object with:

```ts
{
  id: "moonshotai/kimi-k3",
  is_default: true,
  replaces_model_ids: ["moonshotai/kimi-k2.6"],
},
```

Add this test after the full-catalog test:

```ts
it("publishes K3 live capabilities with fixed reasoning controls", async () => {
  const kimiMetadata = {
    provider_model_id: "moonshotai/kimi-k3",
    is_default: true,
    replaces_model_ids: ["moonshotai/kimi-k2.6"],
    supports_reasoning: true,
    supported_reasoning_efforts: [],
    default_reasoning_effort: null,
  };
  const kimi = catalogModel("moonshotai/kimi-k3", "Kimi K3", kimiMetadata);
  const { response } = await loadRoute(kimiMetadata, {
    context_length: 1_000_000,
    input_modalities: ["text", "image", "file"],
    output_modalities: ["text"],
    supports_reasoning: true,
    supports_tools: true,
    supports_vision: true,
    supports_files: true,
    pricing_input_per_mtok_usd: 3,
    pricing_output_per_mtok_usd: 15,
    pricing_cached_input_per_mtok_usd: 0.3,
  }, [kimi]);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    data: [
      {
        id: "moonshotai/kimi-k3",
        display_name: "Kimi K3",
        is_default: true,
        replaces_model_ids: ["moonshotai/kimi-k2.6"],
        capabilities: {
          context_length: 1_000_000,
          input_modalities: ["text", "image", "file"],
          output_modalities: ["text"],
          supports_reasoning: true,
          supported_reasoning_efforts: [],
          default_reasoning_effort: null,
          supports_tools: true,
          supports_vision: true,
          supports_files: true,
        },
        pricing: {
          input_per_mtok_usd: 3,
          output_per_mtok_usd: 15,
          cached_input_per_mtok_usd: 0.3,
          markup_bps: 2_000,
        },
      },
    ],
  });
});
```

The route test deliberately mocks `applyMarkupToPriceUsd` as identity; Task 3 owns the exact user-facing marked-up numbers and the production smoke verifies the live marked-up catalog.

- [ ] **Step 3: Run the changed generic-contract tests**

Run:

```bash
pnpm exec vitest run \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-catalog-route.test.ts
```

Expected: the tests pass after fixture/test edits because Task 1 changes the catalog data and the route logic is intentionally generic. If they fail, fix only a demonstrated generic contract defect; do not add model-specific route branches.

- [ ] **Step 4: Add a direct-lookup regression test for the enabled-row boundary**

In `tests/model-pricing.test.ts`, import `getHostedChatModel` alongside `listHostedChatModels`, then add:

```ts
it("requires an exact enabled row for a direct hosted model lookup", async () => {
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn(() => query);
  mocks.createSupabaseAdminClient.mockReturnValue({ from });

  await expect(getHostedChatModel("moonshotai/kimi-k2.6")).resolves.toBeNull();

  expect(from).toHaveBeenCalledWith("model_pricing_rules");
  expect(query.eq.mock.calls).toEqual([
    ["provider", "vercel-ai-gateway"],
    ["operation", "chat"],
    ["model", "moonshotai/kimi-k2.6"],
    ["enabled", true],
  ]);
  expect(maybeSingle).toHaveBeenCalledOnce();
});
```

- [ ] **Step 5: Verify the generic direct-request boundary**

Run:

```bash
pnpm exec vitest run tests/model-pricing.test.ts
rg -n '\.eq\("enabled", true\)|getHostedChatModel\(' lib/billing/model-pricing.ts app/api/v1/chat/completions/route.ts
```

Expected: tests pass; both list and direct lookup constrain `enabled = true`; the chat route resolves the enabled pricing row before invoking Gateway. No production file changes are expected.

- [ ] **Step 6: Add the chat-route execution and retired-model test**

Create `tests/chat-completions-model-policy.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiAuth: vi.fn(),
  licenseGateResponse: vi.fn(),
  getHostedChatModel: vi.fn(),
  gatewayChatCompletionsUrl: vi.fn(),
  gatewayAuthorizationHeader: vi.fn(),
  lookupGatewayGeneration: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireApiAuth: mocks.requireApiAuth,
}));
vi.mock("@/lib/api/license", () => ({
  licenseGateResponse: mocks.licenseGateResponse,
}));
vi.mock("@/lib/billing/model-pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/model-pricing")>();
  return { ...actual, getHostedChatModel: mocks.getHostedChatModel };
});
vi.mock("@/lib/ai/vercel-gateway", () => ({
  gatewayChatCompletionsUrl: mocks.gatewayChatCompletionsUrl,
  gatewayAuthorizationHeader: mocks.gatewayAuthorizationHeader,
  lookupGatewayGeneration: mocks.lookupGatewayGeneration,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

import { POST } from "@/app/api/v1/chat/completions/route";

const kimiK3Rule = {
  id: "rule_kimi_k3",
  provider: "vercel-ai-gateway",
  model: "moonshotai/kimi-k3",
  operation: "chat",
  display_name: "Kimi K3",
  markup_bps: 2_000,
  minimum_charge_usd_micros: 1,
  reserve_amount_usd_micros: 50_000,
  enabled: true,
  metadata: {
    is_default: true,
    replaces_model_ids: ["moonshotai/kimi-k2.6"],
  },
};

function createAdmin() {
  const single = vi.fn(async () => ({ data: { id: "job_1" }, error: null }));
  const select = vi.fn(() => ({ single }));
  const generationJobInsert = vi.fn(() => ({ select }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const generationJobUpdate = vi.fn(() => ({ eq: updateEq }));
  const usageInsert = vi.fn(async () => ({ error: null }));
  const from = vi.fn((table: string) => {
    if (table === "generation_jobs") {
      return { insert: generationJobInsert, update: generationJobUpdate };
    }
    if (table === "usage_events") {
      return { insert: usageInsert };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  const rpc = vi.fn(
    async (_name: string, _args: Record<string, unknown>) => ({ error: null }),
  );

  return {
    admin: { from, rpc },
    generationJobInsert,
    usageInsert,
    rpc,
  };
}

function request(model: string) {
  return new Request("https://example.test/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 32,
      stream: false,
    }),
  });
}

describe("hosted chat model policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.requireApiAuth.mockResolvedValue({
      ok: true,
      auth: { user: { id: "user_1" }, supabase: {} },
    });
    mocks.licenseGateResponse.mockResolvedValue(null);
    mocks.gatewayChatCompletionsUrl.mockReturnValue(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
    );
    mocks.gatewayAuthorizationHeader.mockReturnValue("Bearer test-key");
    mocks.lookupGatewayGeneration.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("executes K3 under its exact ID and settles Gateway cost", async () => {
    const admin = createAdmin();
    mocks.createSupabaseAdminClient.mockReturnValue(admin.admin);
    mocks.getHostedChatModel.mockResolvedValue(kimiK3Rule);
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "generation_1",
          model: "moonshotai/kimi-k3",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: "ok" },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_cost: "0.0001",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await POST(request("moonshotai/kimi-k3"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-woven-job-id")).toBe("job_1");
    expect(body.model).toBe("moonshotai/kimi-k3");
    expect(mocks.getHostedChatModel).toHaveBeenCalledWith("moonshotai/kimi-k3");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const gatewayBody = JSON.parse(
      String(mocks.fetch.mock.calls[0]?.[1]?.body),
    );
    expect(gatewayBody).toMatchObject({
      model: "moonshotai/kimi-k3",
      providerOptions: { gateway: { sort: "ttft" } },
    });
    expect(admin.generationJobInsert).toHaveBeenCalledOnce();
    expect(admin.usageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: "job_1",
        model: "moonshotai/kimi-k3",
        raw_provider_cost: 0.0001,
        charged_amount_usd_micros: 120,
      }),
    );
    expect(admin.rpc.mock.calls.map(([name]) => name)).toEqual([
      "reserve_balance",
      "settle_balance_reservation",
    ]);
    expect(admin.rpc.mock.calls[1]?.[1]).toMatchObject({
      p_job_id: "job_1",
      p_final_cost_usd_micros: 120,
    });
  });

  it("rejects disabled K2.6 before Gateway, job creation, or billing", async () => {
    mocks.getHostedChatModel.mockResolvedValue(null);

    const response = await POST(request("moonshotai/kimi-k2.6"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "Hosted model is not enabled: moonshotai/kimi-k2.6",
        type: "model_not_found",
        code: "model_not_found",
      },
    });
    expect(mocks.getHostedChatModel).toHaveBeenCalledWith(
      "moonshotai/kimi-k2.6",
    );
    expect(mocks.gatewayChatCompletionsUrl).not.toHaveBeenCalled();
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the complete local API contract slice**

Run:

```bash
pnpm exec vitest run \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-catalog-route.test.ts \
  tests/model-pricing.test.ts \
  tests/chat-completions-model-policy.test.ts
```

Expected: all four files pass. The K3 test proves exact-ID Gateway forwarding plus reservation/settlement; the K2.6 test proves rejection before Gateway, job creation, or billing.

- [ ] **Step 8: Commit the catalog and request-contract tests**

Run:

```bash
git add \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-catalog-route.test.ts \
  tests/model-pricing.test.ts \
  tests/chat-completions-model-policy.test.ts
git diff --cached --check
git commit -m "test(models): cover Kimi K3 catalog contract"
```

---

### Task 3: Publish exact K3 pricing and current-model copy

**Files:**
- Modify: `tests/pricing-page-rates.test.ts`
- Modify: `tests/seo-faqs.test.ts`
- Modify: `lib/pricing-page-rates.ts`
- Modify: `lib/seo/faqs.ts`
- Modify: `docs/billing-architecture.md`

**Interfaces:**
- Static `/pricing` data shows exact Woven-charged K3 rates.
- Homepage/SEO model copy names K3 and no longer markets K2.6 as current.

- [ ] **Step 1: Read the repo’s installed Next.js production guide**

Run:

```bash
sed -n '1,260p' node_modules/next/dist/docs/01-app/02-guides/production-checklist.md
```

Expected: the local Next.js 16.2.3 guide is read before changing static application data.

- [ ] **Step 2: Write failing exact pricing and SEO assertions**

In `tests/pricing-page-rates.test.ts`, change the final expected model name to `"Kimi K3"`, then add:

```ts
expect(chatModelRates.find((rate) => rate.name === "Kimi K3")).toEqual({
  name: "Kimi K3",
  modelId: "moonshotai/kimi-k3",
  input: "$3.60/M",
  output: "$18.00/M",
  cacheRead: "$0.36/M",
  cacheWrite: "—",
});
expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
  "moonshotai/kimi-k2.6",
);
```

In `tests/seo-faqs.test.ts`, replace the positive K2.6 assertion with:

```ts
expect(answer).toContain("Kimi K3");
expect(answer).not.toContain("Kimi K2.6");
```

- [ ] **Step 3: Run the two tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/pricing-page-rates.test.ts tests/seo-faqs.test.ts
```

Expected: failures show the current K2.6 row/copy.

- [ ] **Step 4: Replace the public pricing row**

In `lib/pricing-page-rates.ts`, replace the K2.6 object with:

```ts
{
  name: "Kimi K3",
  modelId: "moonshotai/kimi-k3",
  input: "$3.60/M",
  output: "$18.00/M",
  cacheRead: "$0.36/M",
  cacheWrite: "—",
},
```

- [ ] **Step 5: Update current-model prose**

In `lib/seo/faqs.ts`, change the hosted lineup sentence to:

```ts
a: "Use Claude Sonnet 5, Claude Opus 4.8, GPT-5.6 Sol, GPT-5.6 Terra, and Kimi K3 with Woven-hosted credits. You can also bring your own Anthropic and OpenAI keys or sign in with ChatGPT for GPT-5+ on your existing plan. See the pricing page for per-model rates.",
```

In `docs/billing-architecture.md`, replace only the current hosted model list’s K2.6 entry with K3. Keep historical migration references unchanged.

- [ ] **Step 6: Run GREEN and the stale-current-copy scan**

Run:

```bash
pnpm exec vitest run tests/pricing-page-rates.test.ts tests/seo-faqs.test.ts
rg -n "Kimi K2\.6|moonshotai/kimi-k2\.6" \
  lib app docs/billing-architecture.md \
  tests/pricing-page-rates.test.ts tests/seo-faqs.test.ts
```

Expected: both tests pass. The scan may find the retired ID only in intentional runtime/history code; it must not find current public marketing or pricing copy.

- [ ] **Step 7: Commit the public release slice**

Run:

```bash
git add \
  tests/pricing-page-rates.test.ts \
  tests/seo-faqs.test.ts \
  lib/pricing-page-rates.ts \
  lib/seo/faqs.ts \
  docs/billing-architecture.md
git diff --cached --check
git commit -m "feat(pricing): publish Kimi K3 rates"
```

---

### Task 4: Prove the backend cutover locally and freeze it

**Files:**
- Verify: complete `woven-video` worktree
- Record during execution: `.superpowers/sdd/kimi-k3-hosted-cutover-release-report.md` (ignored evidence)

**Interfaces:**
- Proves migration execution, idempotency, exact five-row catalog, tests, and production build before any remote mutation.

- [ ] **Step 1: Run focused contract tests**

Run:

```bash
pnpm exec vitest run \
  tests/kimi-k3-migration.test.ts \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-pricing.test.ts \
  tests/model-catalog-route.test.ts \
  tests/chat-completions-model-policy.test.ts \
  tests/pricing-page-rates.test.ts \
  tests/seo-faqs.test.ts
```

Expected: all seven files pass.

- [ ] **Step 2: Reset the local database and query exact state**

Run:

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -v ON_ERROR_STOP=1 -x -c "select model, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, metadata->'is_default' as is_default, metadata->'replaces_model_ids' as replaces_model_ids, metadata->'supported_reasoning_efforts' as supported_reasoning_efforts, metadata->>'default_reasoning_effort' as default_reasoning_effort from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' order by enabled desc, model; select count(*) as enabled_rows, count(*) filter (where metadata->'is_default' = 'true'::jsonb) as enabled_defaults from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and enabled = true;"
```

Expected:

- exactly five enabled rows;
- exactly one enabled default, `moonshotai/kimi-k3`;
- K3 has markup `2000`, minimum `1`, reserve `50000`, fixed reasoning, and replacement `moonshotai/kimi-k2.6`;
- K2.6 remains present but is disabled, non-default, and has `[]` replacements;
- the other four enabled models and their three successor claims are unchanged.

- [ ] **Step 3: Replay the forward migration twice and prove idempotency**

Run:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260717120000_rollout_kimi_k3.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260717120000_rollout_kimi_k3.sql
```

Repeat Task 4 Step 2’s query. Expected: identical state and no duplicate row.

- [ ] **Step 4: Run full test and build gates**

Run:

```bash
pnpm test
pnpm build
git diff --check
git status --short --branch
```

Expected: all tests pass; the Next production build compiles, type-checks, and generates static pages; diff check is silent; branch is clean.

- [ ] **Step 5: Freeze the backend release SHA**

Run:

```bash
RELEASE_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$RELEASE_SHA"
```

Record the SHA, exact test counts, build result, local catalog query, and date/time in `.superpowers/sdd/kimi-k3-hosted-cutover-release-report.md` using `apply_patch`. Do not create the report with shell redirection.

---

### Task 5: Patch Harness compatibility without hardcoding K3

**Files in `/Users/naman/projects/woven-harness`:**
- Modify: `Tests/WovenHarnessTests/HostedModelCatalogFixtures.swift`
- Modify: `Tests/WovenHarnessTests/HostedModelCatalogTests.swift`
- Modify: `Tests/WovenHarnessTests/ModelCatalogStoreTests.swift`
- Modify: `Tests/WovenHarnessTests/ChatSessionModelReconcilerTests.swift`
- Modify: `Tests/WovenHarnessTests/ModelAccessTests.swift`
- Modify: `Sources/WovenHarness/Models/ChatModel.swift`
- Modify: `Sidecar/src/models/windows.ts`
- Modify: `Sidecar/src/models/windows.test.ts`
- Verify unchanged: `Sidecar/src/models/index.ts`

**Interfaces:**
- Fresh/default hosted selection resolves to live catalog K3.
- Saved `moonshotai/kimi-k2.6` and `woven:moonshotai/kimi-k2.6` selections reconcile to K3 via backend successor metadata.
- K3 gets a 1M compaction fallback when no catalog hint is present; K2 retains 262K historical fallback.
- BYOK still exposes no Moonshot model.

This task is a separate Harness branch and review gate. With subagent-driven execution it may run independently; with inline execution, defer it until Task 9 is complete and proceed directly from Task 4 to Task 6. It may land after the backend cutover and must not delay Tasks 6-10.

- [ ] **Step 1: Start from a clean isolated Harness branch**

Run:

```bash
cd /Users/naman/projects/woven-harness
git status --short --branch
git fetch origin main
git switch -c fix/kimi-k3-hosted-compat origin/main
```

If the Harness worktree is not clean, do not overwrite user work. Create a native git worktree from `origin/main` instead.

- [ ] **Step 2: Update test fixtures and expectations first**

In `HostedModelCatalogFixtures.swift`, replace the final fixture with:

```swift
hostedModelEntry(
    id: "moonshotai/kimi-k3",
    displayName: "Kimi K3",
    isDefault: true,
    replaces: ["moonshotai/kimi-k2.6"],
    supportsReasoning: true,
    efforts: [],
    defaultEffort: nil,
    contextLength: 1_000_000
),
```

Update the Kimi lookup and assertions in `HostedModelCatalogTests.swift` to K3, including context `1_000_000`, fixed reasoning, and replacement K2.6. Add:

```swift
XCTAssertEqual(
    catalog.replacement(forRetiredID: "moonshotai/kimi-k2.6")?.id,
    "moonshotai/kimi-k3"
)
```

Update `ModelCatalogStoreTests.swift` to expect `moonshotai/kimi-k3` as the default.

Update current-default expectations in `ChatSessionModelReconcilerTests.swift` from K2.6 to K3. In `testRestoredWovenReplacementAndDefaultFallbackUseResolvedDefaults`, make the cases array exactly:

```swift
let cases: [(savedID: String, expectedID: String, expectedReasoning: ReasoningEffort)] = [
    ("openai/gpt-5.5", "openai/gpt-5.6-sol", .medium),
    ("moonshotai/kimi-k2.6", "moonshotai/kimi-k3", .off),
    ("woven:moonshotai/kimi-k2.6", "moonshotai/kimi-k3", .off),
    ("provider/removed", "moonshotai/kimi-k3", .off),
]
```

This proves both canonical and `woven:` saved K2.6 IDs reconcile through the backend successor claim.

- [ ] **Step 3: Localize the retired static model to tests**

At the top of `ModelAccessTests.swift`, add a test-only helper:

```swift
private extension ChatModel {
    static let historicalKimiK26 = ChatModel(
        id: "moonshotai/kimi-k2.6",
        provider: .moonshot,
        modelID: "kimi-k2.6",
        wovenModelID: "woven:moonshotai/kimi-k2.6",
        shortTitle: "Kimi K2.6",
        menuTitle: "Kimi K2.6",
        icon: "sparkle"
    )
}
```

In the same full-catalog test, add this degraded-enrichment assertion after the existing Sonnet capability assertion:

```ts
expect(
  body.data.find(
    (entry: { id: string }) => entry.id === "moonshotai/kimi-k3",
  )?.capabilities,
).toMatchObject({
  context_length: null,
  supports_reasoning: true,
  supported_reasoning_efforts: [],
  default_reasoning_effort: null,
});
```

This proves that a live enrichment failure does not erase K3's backend-owned fixed reasoning policy.

Replace `ChatModel.kimiK26` and `.kimiK26` uses in this test file with `.historicalKimiK26`. Change the hosted catalog lookup to K3. Keep the API-key override case historical. Replace the old exact Kimi absence assertion with:

```swift
XCTAssertFalse(ids.contains(where: { $0.hasPrefix("moonshotai/") }))
```

In `Sources/WovenHarness/Models/ChatModel.swift`, remove the `static let kimiK26` block. Do not add a K3 static constant.

- [ ] **Step 4: Write the failing K3 context-window test**

In `Sidecar/src/models/windows.test.ts`, change the non-Claude test to:

```ts
test("non-Claude windows are unchanged", () => {
  assert.equal(contextWindowFor("gpt-5"), 1_000_000);
  assert.equal(contextWindowFor("moonshotai/kimi-k3"), 1_000_000);
  assert.equal(contextWindowFor("woven:moonshotai/kimi-k3"), 1_000_000);
  assert.equal(contextWindowFor("kimi-k2.6"), 262_000);
  assert.equal(contextWindowFor("totally-unknown-model"), 128_000);
});
```

Run:

```bash
cd /Users/naman/projects/woven-harness/Sidecar
node --import tsx --test src/models/windows.test.ts
```

Expected: K3 assertions fail with actual `262000` because the broad current Moonshot matcher catches them.

- [ ] **Step 5: Add ordered K3 and K2 fallback rules**

In `Sidecar/src/models/windows.ts`, replace the existing Moonshot entry with:

```ts
// Moonshot — Kimi K3 is 1M; historical K2 family remains 262k.
{ match: ["kimi-k3", "moonshotai/kimi-k3"], window: 1_000_000 },
{ match: ["kimi-k2", "moonshotai/kimi-k2"], window: 262_000 },
```

Do not retain the broad `moonshotai/kimi` matcher because it would classify future Kimi models as K2.

- [ ] **Step 6: Run focused Harness GREEN gates**

Run:

```bash
cd /Users/naman/projects/woven-harness
xcodebuild test -scheme WovenHarness -destination 'platform=macOS' \
  -only-testing:WovenHarnessTests/HostedModelCatalogTests \
  -only-testing:WovenHarnessTests/ModelCatalogStoreTests \
  -only-testing:WovenHarnessTests/ChatSessionModelReconcilerTests \
  -only-testing:WovenHarnessTests/ModelAccessTests
cd Sidecar
node --import tsx --test src/models/windows.test.ts src/models/index.test.ts
pnpm typecheck
```

Expected: all selected Swift suites and Sidecar tests pass; TypeScript emits no errors.

- [ ] **Step 7: Verify BYOK and hardcoding boundaries**

Run:

```bash
rg -n "kimiK26|static let kimiK3|moonshotai/kimi-k3" \
  Sources/WovenHarness Sidecar/src/models \
  Tests/WovenHarnessTests
rg -n "moonshot|kimi" Sidecar/src/models/index.ts Sidecar/src/models/index.test.ts
```

Expected: no production Swift static Kimi model; K3 appears only in backend-driven fixtures/tests and the Sidecar fallback; Moonshot/Kimi remains rejected or absent from BYOK model exposure.

- [ ] **Step 8: Run complete Harness gates and commit**

Run:

```bash
cd /Users/naman/projects/woven-harness
xcodebuild test -scheme WovenHarness -destination 'platform=macOS'
cd Sidecar
pnpm test
pnpm build
cd ..
git diff --check
git add \
  Tests/WovenHarnessTests/HostedModelCatalogFixtures.swift \
  Tests/WovenHarnessTests/HostedModelCatalogTests.swift \
  Tests/WovenHarnessTests/ModelCatalogStoreTests.swift \
  Tests/WovenHarnessTests/ChatSessionModelReconcilerTests.swift \
  Tests/WovenHarnessTests/ModelAccessTests.swift \
  Sources/WovenHarness/Models/ChatModel.swift \
  Sidecar/src/models/windows.ts \
  Sidecar/src/models/windows.test.ts
git diff --cached --check
git commit -m "fix(models): align hosted Kimi K3 compatibility"
```

Expected: all gates pass. Push and review this branch independently; do not couple its merge to the backend release PR.

---

### Task 6: Prepare and prove a forward rollback branch

**Files on separate rollback branch:**
- Create: `tests/kimi-k3-rollback-migration.test.ts`
- Create: `supabase/migrations/20260717123000_rollback_kimi_k3.sql`

**Interfaces:**
- Disables K3 and restores K2.6 as the sole default.
- K2.6 claims K3 as its retired predecessor so saved K3 sessions reconcile after rollback.
- Remains unmerged unless a production stop condition requires it.

- [ ] **Step 1: Create an isolated rollback worktree from the frozen release SHA**

Run from the backend release worktree:

```bash
RELEASE_SHA="$(git rev-parse HEAD)"
git worktree add \
  -b rollback/kimi-k3-hosted-cutover \
  /Users/naman/projects/woven-video/.worktrees/rollback-kimi-k3-hosted-cutover \
  "$RELEASE_SHA"
```

If the branch or directory exists, inspect it instead of deleting or overwriting it.

- [ ] **Step 2: Write the failing rollback source-contract test**

Create `tests/kimi-k3-rollback-migration.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260717123000_rollback_kimi_k3.sql",
);

describe("Kimi K3 rollback migration", () => {
  it("restores K2.6 as default while preserving both rows", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('moonshotai/kimi-k3', false, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('moonshotai/kimi-k2.6', true, true, '[\"moonshotai/kimi-k3\"]'::jsonb)",
    );
    expect(normalized.match(/, true, true, /g)).toHaveLength(1);
    expect(normalized).toContain("rules.provider = 'vercel-ai-gateway'");
    expect(normalized).toContain("rules.operation = 'chat'");
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/metadata\s*=\s*jsonb_build_object/i);
  });
});
```

- [ ] **Step 3: Verify RED, then add the forward rollback migration**

Run the test once and expect the missing-file failure. Then create `supabase/migrations/20260717123000_rollback_kimi_k3.sql`:

```sql
-- Forward-only emergency rollback for the Kimi K3 hosted cutover.
-- Restore K2.6 execution while preserving both model rows and all history.

with rollback_policy(model, enabled, is_default, replaces_model_ids) as (
  values
    ('moonshotai/kimi-k3', false, false, '[]'::jsonb),
    ('moonshotai/kimi-k2.6', true, true, '["moonshotai/kimi-k3"]'::jsonb)
)
update public.model_pricing_rules as rules
set enabled = policy.enabled,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', policy.is_default,
      'replaces_model_ids', policy.replaces_model_ids
    ),
    updated_at = now()
from rollback_policy as policy
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = policy.model;
```

- [ ] **Step 4: Prove rollback GREEN against a full local reset**

Run:

```bash
pnpm exec vitest run tests/kimi-k3-rollback-migration.test.ts
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -v ON_ERROR_STOP=1 -x -c "select model, enabled, metadata->'is_default' as is_default, metadata->'replaces_model_ids' as replaces_model_ids from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and model in ('moonshotai/kimi-k3', 'moonshotai/kimi-k2.6') order by model; select count(*) as enabled_rows, count(*) filter (where metadata->'is_default' = 'true'::jsonb) as enabled_defaults from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and enabled = true;"
```

Expected: K3 disabled; K2.6 enabled/default and replacing K3; five enabled rows total; exactly one default.

- [ ] **Step 5: Commit and push the unmerged rollback**

Run:

```bash
git add tests/kimi-k3-rollback-migration.test.ts supabase/migrations/20260717123000_rollback_kimi_k3.sql
git diff --cached --check
git commit -m "fix(models): prepare Kimi K3 rollback"
git push -u origin rollback/kimi-k3-hosted-cutover
```

Record the rollback SHA. Do not merge it and do not let its migration appear in the forward release branch.

---

### Task 7: Publish the backend PR and complete production preflight

**Files:**
- No source changes expected.
- Update ignored release report with PR, preview, Gateway, backup, and migration evidence.

**Interfaces:**
- Produces a green frozen PR, verified rollback SHA, exact one-migration dry-run, live Gateway proof, and explicit go/no-go.

- [ ] **Step 1: Push and create the backend release PR**

Run:

```bash
cd /Users/naman/projects/woven-video
git status --short --branch
git push -u origin feat/kimi-k3-hosted-cutover
gh pr create \
  --base main \
  --head feat/kimi-k3-hosted-cutover \
  --title "feat(models): cut over hosted Kimi K3" \
  --body $'## Summary\n- replace Kimi K2.6 with Kimi K3 for Woven credits\n- make K3 the sole backend-owned default and successor for saved K2.6 sessions\n- publish exact K3 pricing and capability metadata\n- keep Moonshot unavailable through BYOK\n\n## Verification\n- atomic migration source contract and idempotent local replay\n- exact five-row enabled catalog with one K3 default\n- focused and complete Vitest suites\n- Next.js production build\n- tested forward rollback branch\n\n## Release\nThe production migration applies immediately before this PR merges. Keep the PR unmerged until backup, dry-run, Gateway, auth, and rollback gates pass.'
```

- [ ] **Step 2: Wait for checks and verify the preview**

Run:

```bash
PR_NUMBER="$(gh pr view --json number --jq .number)"
gh pr checks "$PR_NUMBER" --watch
gh pr view "$PR_NUMBER" --json mergeable,reviewDecision,statusCheckRollup,url
```

Expected: all checks pass; Vercel preview succeeds; PR is mergeable and remains open. Verify preview `/pricing` shows K3 exact rates and no K2.6 current row; verify homepage FAQ says K3.

- [ ] **Step 3: Link only the exact production project and inspect history**

Run:

```bash
supabase link --project-ref rlhjpovwwsqdeklhnvfl
cat supabase/.temp/project-ref
supabase migration list --linked
supabase db push --linked --dry-run
```

Expected project ref: `rlhjpovwwsqdeklhnvfl`. Expected pending migration: exactly `20260717120000_rollout_kimi_k3.sql`, with no rollback or unrelated file. Stop on any remote-only entry, history mismatch, or extra pending migration.

- [ ] **Step 4: Verify a recent completed physical backup and capture pre-cutover rows**

Run:

```bash
supabase backups list --project-ref rlhjpovwwsqdeklhnvfl
```

Expected: newest physical backup is `COMPLETED` and less than 24 hours old.

In the production Supabase SQL Editor, run and save this read-only result privately:

```sql
select
  id, provider, model, operation, display_name, markup_bps,
  minimum_charge_usd_micros, reserve_amount_usd_micros,
  enabled, metadata, created_at, updated_at
from public.model_pricing_rules
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and model in ('moonshotai/kimi-k3', 'moonshotai/kimi-k2.6')
order by model;
```

Expected before cutover: K2.6 exists and is enabled/default; K3 does not exist or is not enabled/default. Stop if production is already in an unexpected partial state.

- [ ] **Step 5: Verify live Gateway metadata and a streaming tool call**

Run the following without printing the key:

```bash
node --env-file=/Users/naman/projects/woven-video/.env.local --input-type=module -e '
const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is missing");
const base = (process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1").replace(/\/$/, "");
const model = "moonshotai/kimi-k3";

const catalogResponse = await fetch(`${base}/models`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const catalog = await catalogResponse.json();
if (!catalogResponse.ok) throw new Error(`catalog failed: ${catalogResponse.status}`);
const catalogModel = catalog.data?.find((entry) => entry.id === model);
if (!catalogModel) throw new Error("K3 missing from Gateway catalog");
if (
  catalogModel.context_window !== 1_000_000 ||
  catalogModel.max_tokens !== 131_072 ||
  catalogModel.pricing?.input !== "0.000003" ||
  catalogModel.pricing?.output !== "0.000015" ||
  catalogModel.pricing?.input_cache_read !== "0.0000003"
) throw new Error("K3 catalog contract changed");

const metadataResponse = await fetch(`${base}/models/${model}/endpoints`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const metadata = await metadataResponse.json();
if (!metadataResponse.ok) throw new Error(`metadata failed: ${metadataResponse.status}`);
const endpointData = metadata.data;
const endpoint = endpointData?.endpoints?.[0];
if (
  endpointData?.id !== model ||
  JSON.stringify(endpointData.architecture?.input_modalities) !== JSON.stringify(["text", "image", "file"]) ||
  JSON.stringify(endpointData.architecture?.output_modalities) !== JSON.stringify(["text"]) ||
  endpoint?.context_length !== 1_000_000 ||
  endpoint?.max_completion_tokens !== 131_072 ||
  !endpoint?.supported_parameters?.includes("tools") ||
  !endpoint?.supported_parameters?.includes("tool_choice") ||
  !endpoint?.supported_parameters?.includes("reasoning")
) throw new Error("K3 endpoint contract changed");

const response = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Call ping once with value ok." }],
    tools: [{
      type: "function",
      function: {
        name: "ping",
        description: "Return a test value",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "ping" } },
    max_tokens: 128,
    stream: true,
    stream_options: { include_usage: true },
  }),
});
if (!response.ok) throw new Error(`chat failed: ${response.status} ${await response.text()}`);
const raw = await response.text();
const events = raw
  .split(/\r?\n/)
  .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
  .map((line) => JSON.parse(line.slice(6)));
const toolCalls = events.flatMap((event) => event.choices ?? [])
  .flatMap((choice) => choice.delta?.tool_calls ?? []);
const usage = events.map((event) => event.usage).find(Boolean);
const responseId = events.map((event) => event.id).find(Boolean);
if (!toolCalls.some((call) => call.function?.name === "ping")) throw new Error("missing ping tool call");
if (!usage || !responseId || !raw.includes("data: [DONE]")) throw new Error("missing usage, response id, or DONE");
console.log(JSON.stringify({
  model,
  catalogStatus: catalogResponse.status,
  metadataStatus: metadataResponse.status,
  contextWindow: catalogModel.context_window,
  maxTokens: catalogModel.max_tokens,
  inputModalities: endpointData.architecture.input_modalities,
  outputModalities: endpointData.architecture.output_modalities,
  chatStatus: response.status,
  responseId,
  toolNames: toolCalls.map((call) => call.function?.name).filter(Boolean),
  usage,
}));
'
```

Expected: catalog and endpoint metadata HTTP 200 with the exact context, max output, modalities, pricing, and supported-parameter contract; chat HTTP 200; response ID; one `ping` tool call; usage; `[DONE]`. Stop if K3 is unavailable, metadata changed, streaming fails, or tool use fails.

- [ ] **Step 6: Verify a funded authenticated production account**

Load a short-lived bearer token without echoing it:

```bash
read -r -s "WOVEN_PROD_SMOKE_BEARER_TOKEN?Production smoke bearer token: "
export WOVEN_PROD_SMOKE_BEARER_TOKEN
printf '\n'
curl -sS \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  https://www.woven.video/api/v1/billing/balance \
  | jq -e '.balance_usd_micros > 200000 and .license.active == true'
```

Expected: `true`.

- [ ] **Step 7: Explicit go/no-go**

Record release SHA, rollback SHA, PR/check state, preview URL, exact dry-run, recent backup, pre-cutover rows, Gateway proof, active license, and balance. Obtain explicit release-owner GO before Task 8. A missing or failed item is NO-GO.

---

### Task 8: Apply the atomic production database cutover

**Files:**
- Apply: `supabase/migrations/20260717120000_rollout_kimi_k3.sql`
- Do not apply: rollback migration

**Interfaces:**
- Changes production catalog behavior immediately, before the public web deploy.

- [ ] **Step 1: Reconfirm frozen state immediately before mutation**

Run:

```bash
git status --short --branch
git rev-parse HEAD
supabase db push --linked --dry-run
```

Expected: clean release branch; SHA equals frozen `RELEASE_SHA`; exactly one pending forward migration.

- [ ] **Step 2: Apply exactly the forward migration**

Run:

```bash
supabase db push --linked
```

Expected: only `20260717120000_rollout_kimi_k3.sql` applies successfully.

- [ ] **Step 3: Verify migration history and exact production catalog**

Run:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
```

Expected: local/remote history matches through `20260717120000`; dry-run reports no pending migration.

In production SQL Editor, run:

```sql
select
  model, display_name, markup_bps,
  minimum_charge_usd_micros, reserve_amount_usd_micros,
  enabled,
  metadata->'is_default' as is_default,
  metadata->'replaces_model_ids' as replaces_model_ids,
  metadata->'supported_reasoning_efforts' as supported_reasoning_efforts,
  metadata->>'default_reasoning_effort' as default_reasoning_effort
from public.model_pricing_rules
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
order by enabled desc, model;

select
  count(*) as enabled_rows,
  count(*) filter (where metadata->'is_default' = 'true'::jsonb) as enabled_defaults
from public.model_pricing_rules
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and enabled = true;
```

Expected: exact state from Task 4 Step 2. If it differs, stop before merging the PR and follow Task 10’s rollback decision.

---

### Task 9: Merge, deploy, and prove public/authenticated behavior

**Files:**
- No source changes expected.
- Update ignored release report with final deployment and smoke evidence.

**Interfaces:**
- Merge to `main` triggers the Git-connected Vercel production deployment.
- Proves public copy, authenticated catalog, K3 execution/settlement, and K2.6 rejection.

- [ ] **Step 1: Merge the frozen PR**

Run:

```bash
gh pr merge "$PR_NUMBER" --squash --delete-branch
gh pr view "$PR_NUMBER" --json state,mergedAt,mergeCommit,url
```

Expected: PR state `MERGED`. Record merge commit SHA.

- [ ] **Step 2: Wait for the production Vercel deployment**

Run:

```bash
MERGE_SHA="$(gh pr view "$PR_NUMBER" --json mergeCommit --jq .mergeCommit.oid)"
gh api "repos/namank42/woven-video/commits/$MERGE_SHA/status" \
  --jq '{state, deployments: [.statuses[] | select(.context == "Vercel") | {state, target_url, description}]}'
```

Poll until overall state and Vercel are `success`. Stop on failure; do not assume the merge is deployed.

- [ ] **Step 3: Verify canonical public pricing and SEO copy**

Run:

```bash
curl -sS https://www.woven.video/pricing | rg -n 'Kimi K3|\$3\.60/M|\$18\.00/M|\$0\.36/M'
curl -sS https://www.woven.video/pricing | rg -n "Kimi K2\.6" && false || true
curl -sS https://www.woven.video | rg -n "Kimi K3"
```

Expected: K3 and exact rates appear; K2.6 current pricing does not; homepage contains K3.

- [ ] **Step 4: Verify the authenticated catalog contract**

Run:

```bash
curl -sS \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  https://www.woven.video/api/v1/models \
  | jq -e '
    (.data | length) == 5 and
    ([.data[] | select(.is_default == true)] | length) == 1 and
    ([.data[].id] | sort) == ([
      "anthropic/claude-opus-4.8",
      "anthropic/claude-sonnet-5",
      "moonshotai/kimi-k3",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra"
    ] | sort) and
    (.data[] | select(.id == "moonshotai/kimi-k3") |
      .is_default == true and
      .replaces_model_ids == ["moonshotai/kimi-k2.6"] and
      .capabilities.context_length == 1000000 and
      .capabilities.supports_reasoning == true and
      .capabilities.supported_reasoning_efforts == [] and
      .capabilities.default_reasoning_effort == null and
      .capabilities.supports_tools == true and
      .capabilities.supports_vision == true and
      .capabilities.supports_files == true and
      .pricing.input_per_mtok_usd == 3.6 and
      .pricing.output_per_mtok_usd == 18 and
      .pricing.cached_input_per_mtok_usd == 0.36)
  '
```

Expected: `true`. If Gateway transiently fails enrichment, the route may publish null live pricing/capability fields; retry once, then treat persistent failure as a release failure.

- [ ] **Step 5: Record balance, execute K3 through Woven, and capture job ID**

Run:

```bash
BEFORE_BALANCE="$(curl -sS -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" https://www.woven.video/api/v1/billing/balance | jq -r .balance_usd_micros)"
printf '%s\n' "$BEFORE_BALANCE"

curl -sS -D /private/tmp/kimi-k3-smoke-headers.txt \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k3","messages":[{"role":"user","content":"Reply with exactly: ok"}],"max_tokens":32,"stream":false}' \
  https://www.woven.video/api/v1/chat/completions \
  | tee /private/tmp/kimi-k3-smoke-body.json \
  | jq -e '.choices | length > 0'

K3_JOB_ID="$(awk 'BEGIN{IGNORECASE=1} /^x-woven-job-id:/ {gsub("\r", "", $2); print $2}' /private/tmp/kimi-k3-smoke-headers.txt)"
printf '%s\n' "$K3_JOB_ID"
```

Expected: HTTP success body with a choice and non-empty Woven job ID. The temp files contain no bearer token because curl headers do not echo request authorization.

- [ ] **Step 6: Prove K2.6 is rejected before Gateway/job creation**

Run:

```bash
curl -sS -D /private/tmp/kimi-k2-6-rejection-headers.txt \
  -o /private/tmp/kimi-k2-6-rejection-body.json \
  -w '%{http_code}\n' \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k2.6","messages":[{"role":"user","content":"Reply with exactly: ok"}],"max_tokens":8,"stream":false}' \
  https://www.woven.video/api/v1/chat/completions
jq -e '.error.code == "model_not_found"' /private/tmp/kimi-k2-6-rejection-body.json
rg -ni '^x-woven-job-id:' /private/tmp/kimi-k2-6-rejection-headers.txt && false || true
```

Expected: HTTP `404`, error code `model_not_found`, and no job ID header.

- [ ] **Step 7: Verify exact billing settlement and unit conversion**

Run:

```bash
AFTER_BALANCE="$(curl -sS -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" https://www.woven.video/api/v1/billing/balance | jq -r .balance_usd_micros)"
printf '%s\n' "$AFTER_BALANCE"
```

In production SQL Editor, query by the recorded `K3_JOB_ID`:

```sql
select id, user_id, status, provider, model, operation,
       reserved_amount_usd_micros, actual_amount_usd_micros,
       provider_request_id, error_code, created_at, completed_at
from public.generation_jobs
where id = '<K3_JOB_ID>';

select generation_job_id, provider, model, operation,
       input_units, output_units, raw_provider_cost_usd,
       markup_bps, charged_amount_usd_micros, metadata, created_at
from public.usage_events
where generation_job_id = '<K3_JOB_ID>';

select generation_job_id, kind, amount_usd_micros,
       balance_after_usd_micros, idempotency_key, created_at
from public.credit_ledger_entries
where generation_job_id = '<K3_JOB_ID>'
order by created_at;
```

Expected:

- job is settled/completed for `moonshotai/kimi-k3`;
- usage row records non-negative input/output units and positive raw provider cost;
- `markup_bps = 2000`;
- charged micros equal the repository’s provider-cost-to-micros conversion after 20% markup and minimum-charge rules;
- reservation and settlement ledger entries use unique idempotency keys;
- `BEFORE_BALANCE - AFTER_BALANCE` equals the final charged micros, allowing for no concurrent test-account spend;
- the K2.6 rejection created no new generation job or usage event.

- [ ] **Step 8: Close the release report**

Record migration version, merge/deploy SHA and URL, public copy proof, authenticated catalog JSON summary, K3 job ID, balances, usage/ledger unit checks, K2.6 rejection, and final PASS/FAIL. Unset the token:

```bash
unset WOVEN_PROD_SMOKE_BEARER_TOKEN
```

---

### Task 10: Stop conditions and forward rollback

**Files:**
- Emergency apply only: `supabase/migrations/20260717123000_rollback_kimi_k3.sql` from `rollback/kimi-k3-hosted-cutover`

**Interfaces:**
- Restores K2.6 as the sole default and K3 successor without destructive history changes.

- [ ] **Step 1: Use the stop matrix**

Stop the forward sequence for any of these conditions:

- Gateway no longer recognizes K3 or streaming/tool calls fail persistently;
- production migration history or dry-run differs from the exact expected list;
- no recent completed physical backup;
- K3 is not the sole default after migration;
- authenticated catalog omits K3, advertises the wrong successor/reasoning contract, or keeps K2.6 enabled;
- Woven K3 execution fails, does not settle, or bills with incorrect units/markup;
- K2.6 remains executable or creates a job;
- deployment fails or public rates are wrong.

- [ ] **Step 2: Choose web rollback versus database rollback deliberately**

If only the web deploy/public copy is broken and the backend route still serves the correct K3 catalog and execution, use Vercel’s prior-production rollback path and fix forward in code. If K3 execution/catalog/billing is broken, apply the prepared database rollback first so users regain an executable default.

- [ ] **Step 3: Apply the tested forward database rollback if authorized**

From the rollback worktree, after explicit release-owner approval:

```bash
cd /Users/naman/projects/woven-video/.worktrees/rollback-kimi-k3-hosted-cutover
supabase link --project-ref rlhjpovwwsqdeklhnvfl
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
```

Expected dry-run before mutation: exactly `20260717123000_rollback_kimi_k3.sql`. After apply, verify K2.6 enabled/default/replacing K3, K3 disabled/non-default, exactly five enabled models, one default, and no pending migration.

- [ ] **Step 4: Verify rollback execution and preserve evidence**

Repeat the authenticated catalog and execution checks with K2.6 as current and K3 rejected. Preserve failed forward job IDs, logs, billing rows, migration versions, and deployment SHA. Open a corrective PR; never edit either recorded migration.

## Completion criteria

The cutover is complete only when:

- production has exactly five enabled hosted chat models and K3 is the sole default;
- saved K2.6 sessions have a backend successor path to K3;
- direct K2.6 requests return `404 model_not_found` without a job;
- `/pricing` and SEO copy publish K3 with exact `$3.60/M`, `$18.00/M`, `$0.36/M`, `—` rates;
- a real authenticated K3 request completes and its job, usage, reservation, settlement, markup, micros conversion, idempotency, and balance delta are verified;
- the tested rollback remains available or was applied and verified;
- the Harness compatibility branch is tracked separately and has not introduced a static hosted K3 model or Moonshot BYOK support.
