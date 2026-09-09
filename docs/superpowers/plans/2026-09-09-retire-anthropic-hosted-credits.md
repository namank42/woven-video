# Retire Anthropic Hosted Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Apply risk-based implementer continuity and review checkpoints; task numbering alone does not require a fresh worker or reviewer. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Anthropic models from Woven credits (catalog, admission, pricing page, product copy) while preserving all rows and history for a flag-flip bring-back.

**Architecture:** One flag-flip migration over `model_pricing_rules` (no app-code change: the existing `enabled`/`catalog_visible` filters implement both the catalog hide and the metering block), plus static pricing-page and product-copy updates with vitest coverage.

**Tech Stack:** Next.js route handlers, Supabase Postgres (`model_pricing_rules`), vitest, pnpm.

**Docs digest:** none — no external deps.

## Global Constraints

- Migration file MUST be `supabase/migrations/20260909120000_disable_anthropic_hosted_chat.sql` with the exact SQL in Task 1 (flag flips only; never `DELETE FROM model_pricing_rules`).
- `openai/gpt-5.6-luna` remains the sole hosted default; the migration sets `is_default = false` on Anthropic rows only and never names Luna.
- Retired Anthropic requests return 404 `model_not_found` with no job row and no charge; never silently substitute another model.
- Bring-back stays a flag flip: rows, pricing, markup, and metadata are preserved.
- Out of scope: the landing-page/keyword corpus (`lib/seo/landing-pages.ts`, `lib/seo/keywords.ts`, `lib/seo/hubs.ts`, `lib/seo/internal-links.ts`, `lib/seo/schema.ts`), historical usage records, non-chat operations, `docs/superpowers` history, `app/terms/page.tsx` (dormant legal conditional).
- Package manager is pnpm (`pnpm vitest ...`, never npm). All commands run from the `woven-video` repo root.
- Independent review required before merge (billing boundary). Backend ships before the harness BYOK removal.

---

### Task 1: Disable Anthropic chat rules

**Outcome:** All `anthropic/*` chat rules are disabled and catalog-hidden; the living billing doc lists the post-retirement lineup.

**Risk and evidence:** Billing/admission boundary. Strict TDD on the migration SQL text (RED: new test fails, file missing; GREEN: SQL satisfies every assertion) plus a route-level 404 regression with the rule lookup mocked to miss. Regression batch: catalog/billing suites. Review: independent reviewer (billing boundary).

**Files:**
- Create: `supabase/migrations/20260909120000_disable_anthropic_hosted_chat.sql`
- Create: `tests/anthropic-retirement-migration.test.ts`
- Modify: `docs/billing-architecture.md` (chat-model list and hosted-flow example id)

**Interfaces:**
- Consumes: `model_pricing_rules` columns (`provider`, `model`, `operation`, `enabled`, `catalog_visible`, `metadata`); `validateHostedModelSelectionPolicies` from `@/lib/ai/hosted-model-selection-policy`; `POST` from `@/app/api/v1/chat/completions/route`.
- Produces: the migration filename above (deploy applies it). No code interface for later tasks.

- [ ] **Step 1: Establish the selected evidence**

Create `tests/anthropic-retirement-migration.test.ts` with this exact content:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateHostedModelSelectionPolicies } from "@/lib/ai/hosted-model-selection-policy";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260909120000_disable_anthropic_hosted_chat.sql",
);

describe("anthropic retirement migration", () => {
  it("disables and hides every anthropic chat rule without touching Luna", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "set enabled = false, catalog_visible = false",
    );
    expect(normalized).toContain(
      "metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object( 'is_default', false )",
    );
    expect(normalized).toContain(
      "where provider = 'vercel-ai-gateway' and operation = 'chat' and model like 'anthropic/%'",
    );
    expect(sql).not.toContain("openai/gpt-5.6-luna");
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
  });

  it("leaves a valid selection policy with Luna as the sole default", () => {
    const visible = [
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
        model: "openai/gpt-5.6-luna",
        metadata: { is_default: true, replaces_model_ids: [] },
      },
    ];

    const result = validateHostedModelSelectionPolicies(visible);

    expect(result.ok).toBe(true);
  });
});

describe("retired anthropic admission", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/api/license");
    vi.doUnmock("@/lib/billing/model-pricing");
    vi.doUnmock("@/lib/supabase/admin");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns 404 model_not_found without touching the database", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/billing/model-pricing", async (importOriginal) => ({
      ...((await importOriginal()) as Record<string, unknown>),
      getHostedChatModel: vi.fn(async () => null),
    }));
    const createSupabaseAdminClient = vi.fn(() => {
      throw new Error("retired model must not touch the database");
    });
    vi.doMock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

    const { POST } = await import("@/app/api/v1/chat/completions/route");
    const response = await POST(
      new Request("https://example.test/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "anthropic/claude-sonnet-5",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("model_not_found");
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Capture RED**

Run: `pnpm vitest run tests/anthropic-retirement-migration.test.ts`

Expected: the migration-SQL test FAILS (`existsSync` is false — file does not exist yet). The selection-policy and 404 tests pass: they characterize behavior that must hold before and after (validator accepts the post-retirement shape; a rule miss already 404s before any DB touch).

- [ ] **Step 3: Write minimal implementation**

Create `supabase/migrations/20260909120000_disable_anthropic_hosted_chat.sql` with this exact content:

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

No app-code change: `listHostedChatModels` already filters both flags (catalog hide) and `getHostedChatModel` already filters `enabled`, so `POST /api/v1/chat/completions` 404s before job creation (metering block). The `operation = 'chat'` scope is complete: every `anthropic/%` seed in migration history uses `operation = 'chat'`, and the media-rule migrations reference no Anthropic ids — so no enabled `anthropic/%` rule remains for any operation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/anthropic-retirement-migration.test.ts`

Expected: all 3 tests PASS.

- [ ] **Step 5: Update the billing doc and run the affected regression batch**

In `docs/billing-architecture.md`, replace the "Current hosted chat models" list (the five bullets starting `- \`anthropic/claude-sonnet-5\``) with:

```markdown
- `openai/gpt-5.6-sol`
- `openai/gpt-5.6-terra`
- `openai/gpt-5.6-luna`
- `moonshotai/kimi-k3` (legacy compatibility only)
```

In the same file, in the "Hosted LLM Flow" paragraph, replace the example id `anthropic/claude-sonnet-5` with `openai/gpt-5.6-luna`.

Run:

```bash
pnpm vitest run tests/anthropic-retirement-migration.test.ts tests/model-pricing.test.ts tests/model-catalog-route.test.ts tests/hosted-model-selection-policy.test.ts tests/hosted-model-selection-policy-migration.test.ts tests/model-catalog-visibility-migration.test.ts tests/anthropic-successor-migration.test.ts tests/chat-model-removal-migration.test.ts
```

Expected: every suite passes. `tests/model-catalog-route.test.ts` keeps its Anthropic fixtures (mocked route-shape data, still valid); historical migration tests are untouched.

Manual: not applicable (no visible change in this task).

- [ ] **Step 6: Review at the selected boundary and commit**

Independent review (billing boundary), then:

```bash
git add supabase/migrations/20260909120000_disable_anthropic_hosted_chat.sql tests/anthropic-retirement-migration.test.ts docs/billing-architecture.md
git commit -m "feat(billing): retire Anthropic hosted chat models"
```

### Task 2: Pricing page and product copy

**Outcome:** The pricing page shows no Anthropic rates, and no shipped page promises BYOK chat keys.

**Risk and evidence:** Static content risk. Strict TDD on the rates data (updated test RED against the current lib, GREEN after) plus new negative copy assertions. Regression batch: pricing/homepage/offer suites. Manual: render `/pricing` and `/`. Review: same independent reviewer as Task 1 (one billing-boundary review may cover both tasks if implemented back-to-back; otherwise review per task).

**Files:**
- Modify: `lib/pricing-page-rates.ts` (delete the two `anthropic/*` objects)
- Modify: `tests/pricing-page-rates.test.ts` (names array, Sonnet block, new negative assertions)
- Modify: `tests/homepage-copy.test.ts` (new negative case)
- Modify: `tests/pricing-page-source.test.ts` (new negative case)
- Modify: `app/pricing/page.tsx` (meta description, license bullets, "Use your own keys" note)
- Modify: `app/page.tsx` (hero body, license bullet)
- Modify: `components/account/subscription-offer.ts` (bullet constant)
- Modify: `tests/billing/subscription-offer.test.ts` (three expected bullets)

**Interfaces:**
- Consumes: `chatModelRates` shape from Task context (unchanged type; two fewer entries).
- Produces: nothing for later tasks. Deploy verification (Step 5) confirms the live catalog.

- [ ] **Step 1: Establish the selected evidence**

In `tests/pricing-page-rates.test.ts`, change the names array to:

```ts
expect(chatModelRates.map((rate) => rate.name)).toEqual([
  "GPT-5.6 Sol",
  "GPT-5.6 Terra",
  "GPT-5.6 Luna",
]);
```

(Upstream `14c1720` already removed the Kimi K3 rate entry and asserts its absence; this task only removes the two Anthropic entries.)

Delete the `chatModelRates.find((rate) => rate.name === "Claude Sonnet 5")` `toEqual` block. After the existing `anthropic/claude-haiku-4.5` negative assertion, add:

```ts
expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
  "anthropic/claude-sonnet-5",
);
expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
  "anthropic/claude-opus-4.8",
);
```

In `tests/homepage-copy.test.ts`, add:

```ts
it("does not promise BYOK chat keys", () => {
  expect(homepageSource).not.toContain("Bring your own Anthropic");
});
```

In `tests/pricing-page-source.test.ts`, add:

```ts
it("does not promise BYOK chat keys", async () => {
  const pageSource = await readFile("app/pricing/page.tsx", "utf8");

  expect(pageSource).not.toContain("Bring your own Anthropic");
  expect(pageSource).not.toContain("bring your own Anthropic/OpenAI keys");
  expect(pageSource).not.toContain("Use your own keys");
});
```

In `tests/billing/subscription-offer.test.ts`, replace all three occurrences of the expected bullet `"Bring your own Anthropic and OpenAI keys, or sign in with ChatGPT"` with `"Sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan"` (em dash, matching existing copy).

- [ ] **Step 2: Capture RED**

Run:

```bash
pnpm vitest run tests/pricing-page-rates.test.ts tests/homepage-copy.test.ts tests/pricing-page-source.test.ts tests/billing/subscription-offer.test.ts
```

Expected: FAILURES in all four files — the names-array mismatch, the new negative copy assertions, and the three offer bullets. (Deleting the Sonnet `toEqual` block cannot itself fail; the failures come from the changed and added assertions.)

- [ ] **Step 3: Write minimal implementation**

`lib/pricing-page-rates.ts`: delete the two objects in `chatModelRates` whose `modelId` starts with `anthropic/` (the `Claude Sonnet 5` and `Claude Opus 4.8` entries, currently lines 37–60). Keep order of the rest.

`app/pricing/page.tsx`:
- Meta description: `Run any model your way: bring your own Anthropic/OpenAI keys, sign in with ChatGPT, or top up Woven-hosted credits at published per-model rates.` becomes `Run any model your way: sign in with ChatGPT, or top up Woven-hosted credits at published per-model rates.`
- `licenseBullets`: delete the `"Bring your own Anthropic and OpenAI keys",` line; change `"Or sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan",` to `"Sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan",`.
- `NoteCard` titled `"Use your own keys"`: retitle to `"Two ways to run models"` and replace its body with: `Your license covers the full app. Sign in with ChatGPT to use GPT-5+ on your existing plan, or top up Woven-hosted credits for Woven-hosted models.`

`app/page.tsx`:
- Hero body: `Try Woven free for 3 days, then $8.25/mo, billed annually ($99/yr) — cancel anytime. Bring your own Anthropic and OpenAI keys, sign in with ChatGPT for GPT-5+ on your existing plan, or run Woven-hosted models on a prepaid balance.` becomes `Try Woven free for 3 days, then $8.25/mo, billed annually ($99/yr) — cancel anytime. Sign in with ChatGPT for GPT-5+ on your existing plan, or run Woven-hosted models on a prepaid balance.`
- Delete the `<BulletItem inverse>` block containing `Bring your own Anthropic and OpenAI keys`; change the following bullet `Or sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan` to `Sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan`.

`components/account/subscription-offer.ts`: rename `bringYourOwnKeysBullet` to `chatGPTBullet` with value `"Sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan"`, and update its three uses.

Explicitly untouched: `app/terms/page.tsx` (dormant legal conditional), `lib/seo/*`, `tests/seo-faqs.test.ts`, `tests/model-catalog-route.test.ts`, historical migration tests.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm vitest run tests/pricing-page-rates.test.ts tests/pricing-page-source.test.ts tests/homepage-copy.test.ts tests/billing/subscription-offer.test.ts tests/billing/trial-copy-source.test.ts
```

Expected: all suites PASS.

- [ ] **Step 5: Deploy verification and manual check**

Deploy through the normal backend release process. Then verify the live catalog (needs a valid user Bearer [REDACTED] in `WOVEN_API_TOKEN` and the API base in `WOVEN_API_BASE_URL`):

```bash
curl -s -H "Authorization: Bearer $WOVEN_API_TOKEN" "$WOVEN_API_BASE_URL/models" | grep -o '"id":"[^"]*"' | sort -u
```

Expected: the id list contains no `anthropic/` entry.

Manual: run `pnpm dev`, open `http://localhost:3000/pricing` and `http://localhost:3000`. Expected: no Claude rows in the chat rates table, no BYOK-key bullets, no "Use your own keys" note.

- [ ] **Step 6: Review at the selected boundary and commit**

Independent review (may be combined with Task 1), then:

```bash
git add lib/pricing-page-rates.ts tests/pricing-page-rates.test.ts tests/homepage-copy.test.ts tests/pricing-page-source.test.ts app/pricing/page.tsx app/page.tsx components/account/subscription-offer.ts tests/billing/subscription-offer.test.ts
git commit -m "feat(billing): drop Anthropic rates and BYOK-key product copy"
```

### Task 3: SEO/FAQ and headline follow-up

**Outcome:** No rendered page (`/` or `/pricing`, including SEO answer-first blocks and FAQs) promises BYOK keys or lists Anthropic as hosted. FAQ item counts are unchanged (questions are repurposed, never deleted — JSON-LD shape stable).

**Risk and evidence:** Static content risk with an SEO dimension. Strict TDD on the FAQ/constant assertions (RED pre-fix, GREEN after). Regression batch: FAQ, copy, pricing, and trial suites. Manual: render `/` + `/pricing`. Review: independent reviewer (billing-adjacent pricing claims).

**Files:**
- Modify: `lib/seo/constants.ts` (`SITE_DESCRIPTION_LONG`, `ANSWER_FIRST_PRICING`, `SITE_CONTENT_UPDATED`)
- Modify: `lib/seo/faqs.ts` (home: cost, models, ChatGPT, rates, keys Q/A, trial answers; pricing: trial, credits, keys Q/A answers)
- Modify: `app/page.tsx` (KeyIcon card eyebrow/title, Multimodal card body)
- Modify: `tests/seo-faqs.test.ts` (lineup test, rates test, new constants block)
- Modify: `tests/homepage-copy.test.ts` (new headline negative case)
- Explicitly UNCHANGED: `lib/seo/landing-pages.ts`, `lib/seo/keywords.ts`, `lib/seo/hubs.ts`, `lib/seo/internal-links.ts`, `lib/seo/schema.ts`, `app/terms/page.tsx`

**Interfaces:**
- Consumes: Tasks 1–2 (committed).
- Produces: nothing further. Deploy verification (live catalog curl) happens after the normal backend release, covering all three tasks.

- [ ] **Step 1: Establish the selected evidence**

In `tests/seo-faqs.test.ts`, change the lineup test to:

```ts
it("keeps the hosted model lineup aligned with the curated catalog", () => {
  const answer = homepageFaqs.find((faq) => faq.q === "Which models can I use?")?.a;

  expect(answer).toContain("GPT-5.6 Sol");
  expect(answer).toContain("GPT-5.6 Terra");
  expect(answer).toContain("GPT-5.6 Luna");
  expect(answer).not.toContain("Claude Sonnet 5");
  expect(answer).not.toContain("Claude Opus 4.8");
  expect(answer).not.toContain("Kimi K3");
  expect(answer).not.toContain("Kimi K2.6");
  expect(answer).not.toContain("GPT-5.5");
  expect(answer).not.toContain("Claude Haiku 4.5");
  expect(answer).not.toContain("Grok 4.3");
  expect(homepageFaqs.map((faq) => faq.a).join("\n")).not.toContain(
    "Claude Sonnet 4.6",
  );
});
```

Replace the dated-Sonnet-rates test with:

```ts
it("links hosted rates to the pricing table instead of duplicating them", () => {
  const answer = homepageFaqs.find(
    (faq) => faq.q === "How much do hosted AI models cost?",
  )?.a;

  expect(answer).toContain("woven.video/pricing");
  expect(answer).not.toContain("Claude Sonnet 5");
  expect(answer).not.toContain("$2.40/M");
});
```

Append a constants block (new import of `@/lib/seo/constants` at the top):

```ts
describe("SEO answer-first copy", () => {
  it("does not promise BYOK keys", () => {
    for (const copy of [ANSWER_FIRST_PRICING, SITE_DESCRIPTION_LONG]) {
      expect(copy).not.toContain("bring your own");
    }
  });

  it("stamps the copy date for this change", () => {
    expect(SITE_CONTENT_UPDATED).toBe("2026-09-09");
  });
});
```

In `tests/homepage-copy.test.ts`, add:

```ts
it("does not promise BYOK chat keys in headlines", () => {
  expect(homepageSource).not.toContain("Your keys, or ours");
  expect(homepageSource).not.toContain("Your keys, ChatGPT");
});
```

- [ ] **Step 2: Capture RED**

Run:

```bash
pnpm vitest run tests/seo-faqs.test.ts tests/homepage-copy.test.ts
```

Expected: FAILURES — the lineup test finds Claude names, the rates test finds the Sonnet sentence, the constants block finds BYOK copy and the old date stamp, the headline test finds the card copy.

- [ ] **Step 3: Write minimal implementation**

`lib/seo/constants.ts`:
- `SITE_DESCRIPTION_LONG`: `...($99/yr); bring your own provider keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.` becomes `...($99/yr); sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.`
- `ANSWER_FIRST_PRICING`: `...from $5; you can also bring your own Anthropic/OpenAI keys or sign in with ChatGPT.` becomes `...from $5; you can also sign in with ChatGPT.`
- `SITE_CONTENT_UPDATED`: `"2026-06-23"` becomes `"2026-09-09"` (its own contract: bump on material marketing-copy changes).

`lib/seo/faqs.ts` (home):
- Cost answer: `It includes $5 in hosted credits. Bring your own provider keys, sign in with ChatGPT (GPT-5+ on your existing plan), or top up a prepaid balance for Woven-hosted models.` becomes `It includes $5 in hosted credits. Sign in with ChatGPT (GPT-5+ on your existing plan), or top up a prepaid balance for Woven-hosted models.`
- Models answer becomes: `Use GPT-5.6 Sol, GPT-5.6 Terra, and GPT-5.6 Luna with Woven-hosted credits. You can also sign in with ChatGPT for GPT-5+ on your existing plan. See the pricing page for per-model rates.`
- ChatGPT answer: `...no separate OpenAI API key required. You can also bring your own OpenAI key or use Woven-hosted models.` becomes `...no separate OpenAI API key required. You can also use Woven-hosted models.`
- Rates answer becomes: `Hosted models are billed per token from your prepaid balance — see woven.video/pricing for the full rate table. Auto captions are $0.10/min.`
- Keys Q/A: question becomes `Do I need my own provider keys?`, answer becomes `No. Sign in with ChatGPT for GPT-5+ on your existing plan, or top up a prepaid balance for Woven-hosted models — no provider keys required.`
- Trial answer: `...plus $5 in Woven-hosted credits. Bring your own keys, sign in with ChatGPT, or use the included credits. $0 due today...` becomes `...plus $5 in Woven-hosted credits. Sign in with ChatGPT, or use the included credits. $0 due today...`

`lib/seo/faqs.ts` (pricing):
- Trial answer: `...plus $5 in Woven-hosted credits. Bring your own Anthropic/OpenAI keys, sign in with ChatGPT, or use the included credits.` becomes `...plus $5 in Woven-hosted credits. Sign in with ChatGPT, or use the included credits.`
- Credits answer: `...only needed for Woven-hosted models. You can use your own API keys or ChatGPT sign-in without topping up.` becomes `...only needed for Woven-hosted models. You can use ChatGPT sign-in without topping up.`
- Keys Q/A: question becomes `Do I need my own API keys?`, answer becomes `No. Your subscription covers the full app — sign in with ChatGPT or use Woven-hosted models on a prepaid balance.`

`app/page.tsx`:
- KeyIcon card: `eyebrow: "Your keys, or ours"` becomes `eyebrow: "Two ways to run"`; `title: "Your keys, ChatGPT, or Woven-hosted."` becomes `title: "ChatGPT or Woven-hosted."` (body already fixed in Task 2).
- Multimodal card body: `...or compare across them. Then point Claude or GPT at any file in your project to analyze or transform.` becomes `...or compare across them. Then point GPT or a hosted model at any file in your project to analyze or transform.`

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm vitest run tests/seo-faqs.test.ts tests/homepage-copy.test.ts tests/pricing-page-source.test.ts tests/pricing-page-rates.test.ts tests/billing/subscription-offer.test.ts tests/billing/trial-copy-source.test.ts
```

Expected: all suites PASS.

- [ ] **Step 5: Manual check**

Run `pnpm dev`, open `http://localhost:3000/` and `http://localhost:3000/pricing`. Expected: FAQs show the new copy (no BYOK-key answers, no Claude rates/model lists), the feature card reads "Two ways to run / ChatGPT or Woven-hosted.", no "Your keys" headline remains.

- [ ] **Step 6: Review at the selected boundary and commit**

Independent review (billing-adjacent pricing claims), then:

```bash
git add lib/seo/constants.ts lib/seo/faqs.ts app/page.tsx tests/seo-faqs.test.ts tests/homepage-copy.test.ts
git commit -m "feat(web): remove BYOK and Anthropic claims from SEO and headlines"
```
