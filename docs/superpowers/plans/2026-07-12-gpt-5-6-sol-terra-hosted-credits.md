# GPT-5.6 Sol and Terra Hosted Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GPT-5.5 with GPT-5.6 Sol and GPT-5.6 Terra across the Woven Credits database catalog, public pricing, and current hosted-model copy so Harness discovers and can bill both new models through the existing API.

**Architecture:** Add two explicit enabled `model_pricing_rules` rows and disable GPT-5.5 in one immutable migration; the existing DB-driven model and chat routes require no changes. Extend the static chat-pricing data with an optional higher tier, render it in the synchronous Next.js pricing page, and align current FAQ and billing documentation.

**Tech Stack:** Supabase/PostgreSQL migrations, Next.js 16.2.3 App Router, React 19.2.4 Server Components, TypeScript 5.9.3, Tailwind CSS 4, Vitest 4.1.9, pnpm 11.

**Docs digest:** `docs/superpowers/research/2026-07-12-gpt-5-6-sol-terra-docs.md`

## Global Constraints

- Work only in `woven-video`; do not modify `woven-harness`.
- Add `openai/gpt-5.6-sol` and `openai/gpt-5.6-terra`; do not add GPT-5.6 Luna.
- Disable `openai/gpt-5.5` without deleting or aliasing it.
- Use `markup_bps = 2000`, minimum charge `1` USD micro, Sol reserve `100000` USD micros, and Terra reserve `50000` USD micros.
- Keep `GET /api/v1/models` and `POST /api/v1/chat/completions` unchanged; enabled pricing rows are their existing source of truth.
- Keep `/api/v1/models` pricing scalar and base-tier-only; do not add Gateway tier arrays to the response.
- Publish both base and over-272K-input-token Woven rates on `/pricing`.
- Keep `app/pricing/page.tsx` a synchronous Server Component with no `"use client"` and no runtime pricing fetch.
- Do not rewrite historical specs, plans, changelog entries, `docs/landing-page-archive.md`, or ChatGPT/Codex GPT-5.5 references.
- Use pnpm commands only and preserve RED -> GREEN evidence for every behavior change.

## File Map

- Create `supabase/migrations/20260712120000_add_gpt_5_6_sol_terra.sql`: seed Sol/Terra and retire GPT-5.5.
- Create `tests/gpt-5-6-sol-terra-migration.test.ts`: immutable migration contract.
- Modify `lib/pricing-page-rates.ts`: typed higher-tier pricing and Sol/Terra public rows.
- Modify `tests/pricing-page-rates.test.ts`: exact public lineup and rates.
- Modify `app/pricing/page.tsx`: render base and higher-tier values on desktop and mobile.
- Modify `tests/pricing-page-source.test.ts`: static Server Component and two-layout tier-rendering contract.
- Modify `lib/seo/faqs.ts`: current Woven Credits lineup.
- Modify `tests/seo-faqs.test.ts`: current lineup assertions.
- Modify `docs/billing-architecture.md`: maintained hosted-chat model list.

---

### Task 1: Seed the billable Sol and Terra catalog

**Files:**
- Create: `tests/gpt-5-6-sol-terra-migration.test.ts`
- Create: `supabase/migrations/20260712120000_add_gpt_5_6_sol_terra.sql`

**Interfaces:**
- Consumes: unique `model_pricing_rules(provider, model, operation)` rows and the existing `enabled` catalog boundary.
- Produces: enabled `vercel-ai-gateway` chat rows for `openai/gpt-5.6-sol` and `openai/gpt-5.6-terra`; disabled historical row for `openai/gpt-5.5`.

- [ ] **Step 1: Write the failing migration contract test**

Create `tests/gpt-5-6-sol-terra-migration.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712120000_add_gpt_5_6_sol_terra.sql",
);

describe("GPT-5.6 Sol and Terra migration", () => {
  it("adds the two hosted models and disables GPT-5.5 without deleting it", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('vercel-ai-gateway', 'openai/gpt-5.6-sol', 'chat', 'GPT-5.6 Sol', 2000, 1, 100000, jsonb_build_object('provider_model_id', 'openai/gpt-5.6-sol'))",
    );
    expect(normalized).toContain(
      "('vercel-ai-gateway', 'openai/gpt-5.6-terra', 'chat', 'GPT-5.6 Terra', 2000, 1, 50000, jsonb_build_object('provider_model_id', 'openai/gpt-5.6-terra'))",
    );
    expect(normalized).toContain(
      "on conflict (provider, model, operation) do update",
    );
    expect(normalized).toContain("enabled = true");
    expect(normalized).toContain(
      "where provider = 'vercel-ai-gateway' and operation = 'chat' and model = 'openai/gpt-5.5'",
    );
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm exec vitest run tests/gpt-5-6-sol-terra-migration.test.ts
```

Expected: FAIL because `20260712120000_add_gpt_5_6_sol_terra.sql` does not exist.

- [ ] **Step 3: Add the immutable migration**

Create `supabase/migrations/20260712120000_add_gpt_5_6_sol_terra.sql`:

```sql
-- Add GPT-5.6 Sol and Terra to Woven Credits and retire GPT-5.5.
-- Live capabilities and base pricing are enriched from Vercel AI Gateway;
-- final billing continues to settle from Gateway-reported generation cost.

insert into public.model_pricing_rules (
  provider,
  model,
  operation,
  display_name,
  markup_bps,
  minimum_charge_usd_micros,
  reserve_amount_usd_micros,
  metadata
)
values
  (
    'vercel-ai-gateway',
    'openai/gpt-5.6-sol',
    'chat',
    'GPT-5.6 Sol',
    2000,
    1,
    100000,
    jsonb_build_object('provider_model_id', 'openai/gpt-5.6-sol')
  ),
  (
    'vercel-ai-gateway',
    'openai/gpt-5.6-terra',
    'chat',
    'GPT-5.6 Terra',
    2000,
    1,
    50000,
    jsonb_build_object('provider_model_id', 'openai/gpt-5.6-terra')
  )
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    metadata = excluded.metadata,
    enabled = true;

-- Keep the GPT-5.5 row for historical jobs and usage events, but remove it
-- from GET /api/v1/models and reject new chat requests for it.
update public.model_pricing_rules
set enabled = false
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and model = 'openai/gpt-5.5';
```

- [ ] **Step 4: Run migration tests to verify GREEN**

Run:

```bash
pnpm exec vitest run tests/gpt-5-6-sol-terra-migration.test.ts tests/chat-model-removal-migration.test.ts
```

Expected: both test files PASS.

- [ ] **Step 5: Commit the catalog change**

```bash
git add tests/gpt-5-6-sol-terra-migration.test.ts supabase/migrations/20260712120000_add_gpt_5_6_sol_terra.sql
git commit -m "feat(billing): add Sol and Terra hosted models"
```

---

### Task 2: Publish exact base and long-context rates

**Files:**
- Modify: `tests/pricing-page-rates.test.ts:11-38`
- Modify: `lib/pricing-page-rates.ts:1-59`

**Interfaces:**
- Consumes: reviewed Gateway rates from `docs/superpowers/research/2026-07-12-gpt-5-6-sol-terra-docs.md`.
- Produces: `ChatModelRateTier` and optional `ChatModelRate.higherTier`; Sol/Terra static pricing rows used by `ChatModelsTable` in Task 3.

- [ ] **Step 1: Replace the hosted-chat pricing test with failing exact expectations**

In `tests/pricing-page-rates.test.ts`, replace the first `it(...)` block with:

```ts
  it("keeps the hosted chat model rate rows available", () => {
    expect(chatModelRates.map((rate) => rate.name)).toEqual([
      "Claude Sonnet 4.6",
      "Claude Opus 4.8",
      "GPT-5.6 Sol",
      "GPT-5.6 Terra",
      "Kimi K2.6",
    ]);

    expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
      "openai/gpt-5.5",
    );
    expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
      "anthropic/claude-haiku-4.5",
    );
    expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
      "xai/grok-4.3",
    );
    expect(
      chatModelRates.find((rate) => rate.name === "Claude Sonnet 4.6"),
    ).not.toHaveProperty("higherTier");

    expect(chatModelRates.find((rate) => rate.name === "GPT-5.6 Sol")).toEqual({
      name: "GPT-5.6 Sol",
      modelId: "openai/gpt-5.6-sol",
      input: "$6.00/M",
      output: "$36.00/M",
      cacheRead: "$0.60/M",
      cacheWrite: "$7.50/M",
      higherTier: {
        threshold: ">272K",
        input: "$12.00/M",
        output: "$54.00/M",
        cacheRead: "$1.20/M",
        cacheWrite: "$15.00/M",
      },
    });

    expect(chatModelRates.find((rate) => rate.name === "GPT-5.6 Terra")).toEqual({
      name: "GPT-5.6 Terra",
      modelId: "openai/gpt-5.6-terra",
      input: "$3.00/M",
      output: "$18.00/M",
      cacheRead: "$0.30/M",
      cacheWrite: "$3.75/M",
      higherTier: {
        threshold: ">272K",
        input: "$6.00/M",
        output: "$27.00/M",
        cacheRead: "$0.60/M",
        cacheWrite: "$7.50/M",
      },
    });
  });
```

- [ ] **Step 2: Run the pricing data test to verify RED**

Run:

```bash
pnpm exec vitest run tests/pricing-page-rates.test.ts
```

Expected: FAIL because the array still contains GPT-5.5 and has no Sol/Terra rows.

- [ ] **Step 3: Add the tier type and replace the GPT-5.5 row**

Replace the chat pricing types and `chatModelRates` declaration at the top of `lib/pricing-page-rates.ts` with:

```ts
export type ChatModelRateTier = {
  threshold: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

export type ChatModelRate = {
  name: string;
  modelId: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  higherTier?: ChatModelRateTier;
};

export type FeatureRate = {
  name: string;
  description: string;
  rate: string;
  reference: string;
};

export type MediaModelRate = {
  name: string;
  capability: string;
  modelIds: string[];
  rate: string;
  notes: string;
};

// Public Woven rates after hosted markup. Keep this aligned with model_pricing_rules.
export const chatModelRates: ChatModelRate[] = [
  {
    name: "Claude Sonnet 4.6",
    modelId: "anthropic/claude-sonnet-4.6",
    input: "$3.60/M",
    output: "$18.00/M",
    cacheRead: "$0.36/M",
    cacheWrite: "$4.50/M",
  },
  {
    name: "Claude Opus 4.8",
    modelId: "anthropic/claude-opus-4.8",
    input: "$6.00/M",
    output: "$30.00/M",
    cacheRead: "$0.60/M",
    cacheWrite: "$7.50/M",
  },
  {
    name: "GPT-5.6 Sol",
    modelId: "openai/gpt-5.6-sol",
    input: "$6.00/M",
    output: "$36.00/M",
    cacheRead: "$0.60/M",
    cacheWrite: "$7.50/M",
    higherTier: {
      threshold: ">272K",
      input: "$12.00/M",
      output: "$54.00/M",
      cacheRead: "$1.20/M",
      cacheWrite: "$15.00/M",
    },
  },
  {
    name: "GPT-5.6 Terra",
    modelId: "openai/gpt-5.6-terra",
    input: "$3.00/M",
    output: "$18.00/M",
    cacheRead: "$0.30/M",
    cacheWrite: "$3.75/M",
    higherTier: {
      threshold: ">272K",
      input: "$6.00/M",
      output: "$27.00/M",
      cacheRead: "$0.60/M",
      cacheWrite: "$7.50/M",
    },
  },
  {
    name: "Kimi K2.6",
    modelId: "moonshotai/kimi-k2.6",
    input: "$1.14/M",
    output: "$4.80/M",
    cacheRead: "$0.19/M",
    cacheWrite: "—",
  },
];
```

Leave `mediaModelRates` and `featureRates` unchanged below this block.

- [ ] **Step 4: Run the pricing data test to verify GREEN**

Run:

```bash
pnpm exec vitest run tests/pricing-page-rates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the pricing data change**

```bash
git add tests/pricing-page-rates.test.ts lib/pricing-page-rates.ts
git commit -m "feat(pricing): publish Sol and Terra rates"
```

---

### Task 3: Render long-context tiers without client JavaScript

**Files:**
- Modify: `tests/pricing-page-source.test.ts`
- Modify: `app/pricing/page.tsx:225-330`

**Interfaces:**
- Consumes: `ChatModelRate.higherTier?: ChatModelRateTier` from Task 2.
- Produces: synchronous `ChatRateValue` rendering used for every chat rate on desktop and mobile.

- [ ] **Step 1: Add a failing source contract for both layouts**

Append this test inside `describe("pricing page source", ...)` in `tests/pricing-page-source.test.ts`:

```ts
  it("renders optional long-context rates on desktop and mobile", async () => {
    const pageSource = await readFile("app/pricing/page.tsx", "utf8");

    expect(pageSource).toContain("function ChatRateValue");
    expect(pageSource).toContain(
      "Higher tiers apply when input exceeds 272K tokens.",
    );

    for (const field of ["input", "output", "cacheRead", "cacheWrite"]) {
      expect(
        pageSource.split(`higherTier={model.higherTier?.${field}}`),
      ).toHaveLength(3);
    }

    expect(pageSource).not.toMatch(/["']use client["']/);
  });
```

The split length of `3` proves each field appears exactly twice: once in the desktop table and once in the mobile card.

- [ ] **Step 2: Run the source test to verify RED**

Run:

```bash
pnpm exec vitest run tests/pricing-page-source.test.ts
```

Expected: FAIL because `ChatRateValue` and the higher-tier props do not exist.

- [ ] **Step 3: Clarify the tier threshold in the chat-rate introduction**

In `app/pricing/page.tsx`, replace:

```tsx
description="Token pricing for hosted text models."
```

with:

```tsx
description="Token pricing for hosted text models. Higher tiers apply when input exceeds 272K tokens."
```

- [ ] **Step 4: Replace `ChatModelsTable` and add the shared value renderer**

Replace the existing `ChatModelsTable` function with:

```tsx
function ChatRateValue({
  value,
  higherTier,
  threshold,
}: {
  value: string;
  higherTier?: string;
  threshold?: string;
}) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span>{value}</span>
      {higherTier && threshold ? (
        <span className="text-xs text-muted-foreground">
          {threshold}: {higherTier}
        </span>
      ) : null}
    </span>
  );
}

function ChatModelsTable() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl ring-1 ring-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-6 py-4 font-medium">Model</th>
              <th className="px-6 py-4 text-right font-medium">Input</th>
              <th className="px-6 py-4 text-right font-medium">Output</th>
              <th className="px-6 py-4 text-right font-medium">Cache read</th>
              <th className="px-6 py-4 text-right font-medium">Cache write</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {chatModelRates.map((model) => (
              <tr key={model.modelId}>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {model.name}
                    </span>
                    <code className="font-mono text-xs text-muted-foreground">
                      {model.modelId}
                    </code>
                  </div>
                </td>
                <td className="px-6 py-4 text-right tabular-nums">
                  <ChatRateValue
                    value={model.input}
                    higherTier={model.higherTier?.input}
                    threshold={model.higherTier?.threshold}
                  />
                </td>
                <td className="px-6 py-4 text-right tabular-nums">
                  <ChatRateValue
                    value={model.output}
                    higherTier={model.higherTier?.output}
                    threshold={model.higherTier?.threshold}
                  />
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                  <ChatRateValue
                    value={model.cacheRead}
                    higherTier={model.higherTier?.cacheRead}
                    threshold={model.higherTier?.threshold}
                  />
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                  <ChatRateValue
                    value={model.cacheWrite}
                    higherTier={model.higherTier?.cacheWrite}
                    threshold={model.higherTier?.threshold}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {chatModelRates.map((model) => (
          <div
            key={model.modelId}
            className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{model.name}</span>
              <code className="font-mono text-xs text-muted-foreground">
                {model.modelId}
              </code>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Input</dt>
              <dd className="text-right tabular-nums">
                <ChatRateValue
                  value={model.input}
                  higherTier={model.higherTier?.input}
                  threshold={model.higherTier?.threshold}
                />
              </dd>
              <dt className="text-muted-foreground">Output</dt>
              <dd className="text-right tabular-nums">
                <ChatRateValue
                  value={model.output}
                  higherTier={model.higherTier?.output}
                  threshold={model.higherTier?.threshold}
                />
              </dd>
              <dt className="text-muted-foreground">Cache read</dt>
              <dd className="text-right tabular-nums">
                <ChatRateValue
                  value={model.cacheRead}
                  higherTier={model.higherTier?.cacheRead}
                  threshold={model.higherTier?.threshold}
                />
              </dd>
              <dt className="text-muted-foreground">Cache write</dt>
              <dd className="text-right tabular-nums">
                <ChatRateValue
                  value={model.cacheWrite}
                  higherTier={model.higherTier?.cacheWrite}
                  threshold={model.higherTier?.threshold}
                />
              </dd>
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
```

Do not add `"use client"`; the installed Next.js 16 guide confirms this synchronous static renderer should remain a Server Component.

- [ ] **Step 5: Run pricing tests to verify GREEN**

Run:

```bash
pnpm exec vitest run tests/pricing-page-source.test.ts tests/pricing-page-rates.test.ts
```

Expected: both test files PASS.

- [ ] **Step 6: Commit the pricing renderer**

```bash
git add tests/pricing-page-source.test.ts app/pricing/page.tsx
git commit -m "feat(pricing): show long-context model tiers"
```

---

### Task 4: Align current hosted-model copy

**Files:**
- Modify: `tests/seo-faqs.test.ts:6-17`
- Modify: `lib/seo/faqs.ts:39-42`
- Modify: `docs/billing-architecture.md:51-56`

**Interfaces:**
- Consumes: the enabled catalog lineup from Task 1.
- Produces: current public and maintained architecture copy naming Sol and Terra, while historical GPT-5.5 references remain untouched.

- [ ] **Step 1: Update the FAQ test to describe the new current lineup**

Replace the first test in `tests/seo-faqs.test.ts` with:

```ts
  it("keeps the hosted model lineup aligned with the curated catalog", () => {
    const answer = homepageFaqs.find((faq) => faq.q === "Which models can I use?")?.a;

    expect(answer).toContain("Claude Sonnet 4.6");
    expect(answer).toContain("Claude Opus 4.8");
    expect(answer).toContain("GPT-5.6 Sol");
    expect(answer).toContain("GPT-5.6 Terra");
    expect(answer).toContain("Kimi K2.6");
    expect(answer).not.toContain("GPT-5.5");
    expect(answer).not.toContain("Claude Haiku 4.5");
    expect(answer).not.toContain("Grok 4.3");
  });
```

- [ ] **Step 2: Run the FAQ test to verify RED**

Run:

```bash
pnpm exec vitest run tests/seo-faqs.test.ts
```

Expected: FAIL because the current answer still names GPT-5.5 and not Sol/Terra.

- [ ] **Step 3: Update the public FAQ answer**

In `lib/seo/faqs.ts`, replace the `Which models can I use?` answer with:

```ts
    a: "Use Claude Sonnet 4.6, Claude Opus 4.8, GPT-5.6 Sol, GPT-5.6 Terra, and Kimi K2.6 with Woven-hosted credits. You can also bring your own Anthropic and OpenAI keys or sign in with ChatGPT for GPT-5+ on your existing plan. See the pricing page for per-model rates.",
```

- [ ] **Step 4: Update the maintained billing architecture list**

In `docs/billing-architecture.md`, replace the current hosted chat list with:

```markdown
Current hosted chat models:

- `anthropic/claude-sonnet-4.6`
- `anthropic/claude-opus-4.8`
- `openai/gpt-5.6-sol`
- `openai/gpt-5.6-terra`
- `moonshotai/kimi-k2.6`
```

- [ ] **Step 5: Verify the focused copy and scope**

Run:

```bash
pnpm exec vitest run tests/seo-faqs.test.ts tests/pricing-page-rates.test.ts tests/pricing-page-source.test.ts tests/gpt-5-6-sol-terra-migration.test.ts
```

Expected: all four test files PASS.

Run:

```bash
rg -n "GPT-5\.5|openai/gpt-5\.5" lib app docs tests supabase/migrations
```

Expected: remaining matches are historical specs/plans, `docs/landing-page-archive.md`, the initial seed and retirement migration, the new negative assertions, or non-Woven-Credits context. There must be no current pricing row, hosted FAQ claim, or maintained billing-architecture list entry for GPT-5.5.

- [ ] **Step 6: Commit current model copy**

```bash
git add tests/seo-faqs.test.ts lib/seo/faqs.ts docs/billing-architecture.md
git commit -m "docs: update hosted model lineup"
```

---

### Task 5: Verify the complete change and deployment contract

**Files:**
- Verify only; no new source files.

**Interfaces:**
- Consumes: all deliverables from Tasks 1-4.
- Produces: test/build evidence, a locally applied migration, and post-deployment catalog/chat/ledger smoke evidence.

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: the complete Vitest suite passes with zero failures.

- [ ] **Step 2: Run the Next.js production build**

```bash
pnpm build
```

Expected: `next build` succeeds; `/pricing` compiles without a Client Component boundary or type error.

- [ ] **Step 3: Apply all migrations to a clean local database**

```bash
supabase db reset
```

Expected: reset completes and applies `20260712120000_add_gpt_5_6_sol_terra.sql` without SQL errors.

- [ ] **Step 4: Query the local catalog rows**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select model, display_name, markup_bps, reserve_amount_usd_micros, enabled from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and model in ('openai/gpt-5.5', 'openai/gpt-5.6-sol', 'openai/gpt-5.6-terra') order by model;"
```

Expected:

```text
openai/gpt-5.5       | GPT-5.5       | 2000 | 100000 | f
openai/gpt-5.6-sol   | GPT-5.6 Sol   | 2000 | 100000 | t
openai/gpt-5.6-terra | GPT-5.6 Terra | 2000 |  50000 | t
```

- [ ] **Step 5: Verify the final diff and commit state**

```bash
git status --short
git log --oneline --max-count=5
```

Expected: the worktree is clean and the feature commits for catalog, pricing data, tier rendering, and copy are present.

- [ ] **Step 6: After deployment, smoke the authenticated model catalog**

Set `WOVEN_BEARER_TOKEN` to a test user's Supabase access token, then run:

```bash
curl -sS https://woven.video/api/v1/models \
  -H "Authorization: Bearer $WOVEN_BEARER_TOKEN" \
  | jq '{ids: [.data[].id], new_models: [.data[] | select(.id == "openai/gpt-5.6-sol" or .id == "openai/gpt-5.6-terra") | {id, capabilities, pricing}]}'
```

Expected: `ids` contains Sol and Terra, does not contain `openai/gpt-5.5`, and both `new_models` entries have non-null `capabilities` and `pricing`.

- [ ] **Step 7: After deployment, smoke one small turn through each model**

```bash
for model in openai/gpt-5.6-sol openai/gpt-5.6-terra; do
  slug="${model##*/}"
  curl -sS -D "/tmp/${slug}.headers" -o "/tmp/${slug}.json" \
    https://woven.video/api/v1/chat/completions \
    -H "Authorization: Bearer $WOVEN_BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK.\"}],\"stream\":false,\"max_tokens\":16}"
  jq '{model, finish_reason: .choices[0].finish_reason, text: .choices[0].message.content}' "/tmp/${slug}.json"
  rg -i "^x-woven-job-id:" "/tmp/${slug}.headers"
done
```

Expected: both responses name the requested model, contain a completed choice, and return an `x-woven-job-id` header.

- [ ] **Step 8: Verify production settlement for both smoke jobs**

Copy the two `x-woven-job-id` values into `SOL_JOB_ID` and `TERRA_JOB_ID`, set `SUPABASE_DB_URL` to the production read connection, and run:

```bash
psql "$SUPABASE_DB_URL" -c "select gj.id, gj.model, gj.status, gj.reserved_amount_usd_micros, gj.final_cost_usd_micros, ue.charged_amount_usd_micros from public.generation_jobs gj join public.usage_events ue on ue.job_id = gj.id where gj.id in ('$SOL_JOB_ID', '$TERRA_JOB_ID') order by gj.model;"
```

Expected: two rows, both `status = 'succeeded'`, both final and charged costs are non-null and positive, and `charged_amount_usd_micros` equals `final_cost_usd_micros` for each job.
