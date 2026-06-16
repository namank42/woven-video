# Monthly-first pricing framing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe every user-facing price surface to lead with `$8.25/mo` while keeping `$99/yr` legibly disclosed — a pure copy/display change, no billing logic touched.

**Architecture:** Edit string literals and JSX text in 4 files. Pricing cards swap which number is the hero (`$8.25 /mo` large, `billed annually at $99/yr` beneath). Prose/metadata adopt the canonical line `$8.25/mo, billed annually ($99/yr)`. The schema.org `price` field and the active-subscriber status line stay at `$99` on purpose.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind. Edits are to existing markup/strings only — no new APIs.

**Docs digest:** none — no external deps (string/JSX edits to existing components).

**Spec:** `docs/superpowers/specs/2026-06-16-monthly-first-pricing-design.md`

**Branch:** `pricing-monthly-first` (already created; spec already committed).

**Canonical strings:**
- Card hero: `$8.25` + unit `/mo`; sub-line: `billed annually at $99/yr`
- Prose: `…then $8.25/mo, billed annually ($99/yr)…`

**Acceptable residual `$99` after all edits (do NOT change these):**
- `components/account/subscription-cta.tsx:73` — active-subscriber status (`$99/year · renews …`)
- `app/page.tsx` — schema.org `price: "99.00"` field (must equal the real charge)
- `.env.example` — Stripe price comments (describe the Stripe price, not UI copy)

**A note on testing:** this change has no unit-testable logic — it is display copy. The "test" for each task is a `rg` assertion that the new string is present and the old one gone, plus `pnpm lint` on the edited file. A full `pnpm build` (which type-checks) runs once in the final task.

---

### Task 1: Homepage — `app/page.tsx`

**Files:**
- Modify: `app/page.tsx` (5 edits: pricing card, hero feature card body, 2 FAQ answers, schema.org description text)

- [ ] **Step 1: Swap the pricing card hero/sub-line (lines ~496–503)**

Before:
```tsx
                <span className="text-6xl font-semibold tracking-[-0.04em] md:text-7xl">
                  $99
                </span>
                <span className="text-sm text-background/70">/year</span>
              </div>
              <p className="text-sm text-background/70">
                $8.25/mo, billed annually
              </p>
```

After:
```tsx
                <span className="text-6xl font-semibold tracking-[-0.04em] md:text-7xl">
                  $8.25
                </span>
                <span className="text-sm text-background/70">/mo</span>
              </div>
              <p className="text-sm text-background/70">
                billed annually at $99/yr
              </p>
```

- [ ] **Step 2: Reframe the hero feature card body (line ~89)**

Before:
```tsx
    body: "Try Woven free for 7 days, then $99/year — cancel anytime. Bring your own Anthropic and OpenAI keys, sign in with ChatGPT for GPT-5+ on your existing plan, or run Woven-hosted models on a prepaid balance — same lineup, no key juggling.",
```

After:
```tsx
    body: "Try Woven free for 7 days, then $8.25/mo, billed annually ($99/yr) — cancel anytime. Bring your own Anthropic and OpenAI keys, sign in with ChatGPT for GPT-5+ on your existing plan, or run Woven-hosted models on a prepaid balance — same lineup, no key juggling.",
```

- [ ] **Step 3: Reframe FAQ "How much does Woven cost?" (line ~114)**

Before:
```tsx
    a: "Woven is a 7-day free trial, then $99/year — cancel anytime, card required. It includes $5 in hosted credits. Bring your own provider keys, sign in with ChatGPT (GPT-5+ on your existing plan), or top up a prepaid balance for Woven-hosted models.",
```

After:
```tsx
    a: "Woven is a 7-day free trial, then $8.25/mo, billed annually ($99/yr) — cancel anytime, card required. It includes $5 in hosted credits. Bring your own provider keys, sign in with ChatGPT (GPT-5+ on your existing plan), or top up a prepaid balance for Woven-hosted models.",
```

- [ ] **Step 4: Reframe FAQ "Do I need a Woven account?" (line ~126)**

Before:
```tsx
    a: "Yes. Sign in once with Google and start a 7-day free trial ($99/year after). Then run with your own Anthropic and OpenAI keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.",
```

After:
```tsx
    a: "Yes. Sign in once with Google and start a 7-day free trial ($8.25/mo, billed annually — $99/yr after). Then run with your own Anthropic and OpenAI keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.",
```

- [ ] **Step 5: Reframe the schema.org `description` text (line ~178) — leave `price: "99.00"` untouched**

Before:
```tsx
    description:
      "Woven is the AI Video Editor. A native macOS app to script, edit, and assemble short-form video by asking. Try free for 7 days, then $99/year; bring your own provider keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.",
```

After:
```tsx
    description:
      "Woven is the AI Video Editor. A native macOS app to script, edit, and assemble short-form video by asking. Try free for 7 days, then $8.25/mo, billed annually ($99/yr); bring your own provider keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.",
```

- [ ] **Step 6: Verify the file**

Run: `rg -n '\$99/year|\$99 ?/year|>\s*\$99\s*<|/year' app/page.tsx`
Expected: **no matches** (the only remaining `99` is `price: "99.00"`, which won't match these patterns).

Run: `rg -n '\$8\.25|billed annually at \$99/yr' app/page.tsx`
Expected: matches at the card (`$8.25`, `billed annually at $99/yr`) plus the 3 prose mentions of `$8.25/mo, billed annually ($99/yr)`.

Run: `pnpm lint`
Expected: PASS (no new errors).

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git commit -m "feat(marketing): homepage leads with \$8.25/mo (was \$99/year)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pricing page — `app/pricing/page.tsx`

**Files:**
- Modify: `app/pricing/page.tsx` (3 edits: meta description, pricing card, CTA band)

- [ ] **Step 1: Reframe the page meta description (line ~22)**

Before:
```tsx
    "Woven is a native macOS AI video editor. Try free for 7 days, then $99/year — cancel anytime. Includes $5 in hosted credits. Run any model your way: bring your own Anthropic/OpenAI keys, sign in with ChatGPT, or top up Woven-hosted credits at published per-model rates.",
```

After:
```tsx
    "Woven is a native macOS AI video editor. Try free for 7 days, then $8.25/mo, billed annually ($99/yr) — cancel anytime. Includes $5 in hosted credits. Run any model your way: bring your own Anthropic/OpenAI keys, sign in with ChatGPT, or top up Woven-hosted credits at published per-model rates.",
```

- [ ] **Step 2: Swap the pricing card hero/sub-line (lines ~212–218)**

Before:
```tsx
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-semibold tracking-tight">$99</span>
              <span className="text-sm text-muted-foreground">/year</span>
            </div>
            <p className="text-sm text-muted-foreground">
              $8.25/mo, billed annually
            </p>
```

After:
```tsx
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-semibold tracking-tight">$8.25</span>
              <span className="text-sm text-muted-foreground">/mo</span>
            </div>
            <p className="text-sm text-muted-foreground">
              billed annually at $99/yr
            </p>
```

- [ ] **Step 3: Reframe the bottom CTA band (line ~491)**

Before:
```tsx
          Then $99/year, cancel anytime. $5 in hosted credits to start.
```

After:
```tsx
          Then $8.25/mo, billed annually ($99/yr). Cancel anytime. $5 in hosted credits to start.
```

- [ ] **Step 4: Verify the file**

Run: `rg -n '\$99/year|\$99 ?/year|>\$99<|/year' app/pricing/page.tsx`
Expected: **no matches**.

Run: `rg -n '\$8\.25|billed annually at \$99/yr|billed annually \(\$99/yr\)' app/pricing/page.tsx`
Expected: matches at the card (`$8.25`, `billed annually at $99/yr`), the meta description, and the CTA band.

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/pricing/page.tsx
git commit -m "feat(marketing): pricing page leads with \$8.25/mo (was \$99/year)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Site / OG metadata — `app/layout.tsx`

**Files:**
- Modify: `app/layout.tsx` (1 edit: `siteDescription`, lines ~20–21)

- [ ] **Step 1: Reframe `siteDescription`**

Before:
```tsx
const siteDescription =
  "Woven is the AI Video Editor. A native macOS app to script, edit, and assemble short-form video by asking. Try free for 7 days, then $99/year; bring your own provider keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.";
```

After:
```tsx
const siteDescription =
  "Woven is the AI Video Editor. A native macOS app to script, edit, and assemble short-form video by asking. Try free for 7 days, then $8.25/mo, billed annually ($99/yr); bring your own provider keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.";
```

- [ ] **Step 2: Verify the file**

Run: `rg -n '\$99/year|/year' app/layout.tsx`
Expected: **no matches**.

Run: `rg -n 'billed annually \(\$99/yr\)' app/layout.tsx`
Expected: 1 match.

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(marketing): site/OG description leads with \$8.25/mo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: In-app account surfaces — `components/account/subscription-cta.tsx`

**Files:**
- Modify: `components/account/subscription-cta.tsx` (2 edits: trial status line ~68, trial card lines ~136–143). **Do NOT change the active-subscriber line at ~73.**

- [ ] **Step 1: Reframe the trial status description (line ~68)**

Before:
```tsx
          : `Free until ${trialDay ?? "soon"}, then $99/year. Cancel anytime before then.`
```

After:
```tsx
          : `Free until ${trialDay ?? "soon"}, then $8.25/mo, billed annually ($99/yr). Cancel anytime before then.`
```

- [ ] **Step 2: Swap the in-app trial card hero/sub-line (lines ~136–143)**

Before:
```tsx
            <span className="font-heading text-4xl font-medium tracking-tight tabular-nums">
              $99
            </span>
            <span className="text-sm text-muted-foreground">/year</span>
          </div>
          <span className="text-sm text-muted-foreground">
            $8.25/mo, billed annually
          </span>
```

After:
```tsx
            <span className="font-heading text-4xl font-medium tracking-tight tabular-nums">
              $8.25
            </span>
            <span className="text-sm text-muted-foreground">/mo</span>
          </div>
          <span className="text-sm text-muted-foreground">
            billed annually at $99/yr
          </span>
```

- [ ] **Step 3: Verify the file — exactly ONE intentional `$99/year` remains**

Run: `rg -n '\$99/year' components/account/subscription-cta.tsx`
Expected: **exactly 1 match** — line ~73, `$99/year · renews ${renewDay ?? "annually"}.` (the active-subscriber line, intentionally unchanged).

Run: `rg -n '\$8\.25|billed annually at \$99/yr|billed annually \(\$99/yr\)' components/account/subscription-cta.tsx`
Expected: matches at the trial status line and the trial card (`$8.25`, `billed annually at $99/yr`).

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/account/subscription-cta.tsx
git commit -m "feat(account): in-app trial card/status lead with \$8.25/mo

Active-subscriber status keeps \$99/year (accurate for converted users).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification & PR

**Files:** none (verification only)

- [ ] **Step 1: Repo-wide residual check**

Run: `rg -n '\$99/year|\$99 ?/year' app components`
Expected: **exactly 1 match** — `components/account/subscription-cta.tsx:73` (active-subscriber line). Any other match is a miss; go fix it.

- [ ] **Step 2: Confirm schema price is intact**

Run: `rg -n 'price: "99.00"' app/page.tsx`
Expected: 1 match (unchanged — structured-data price must equal the real charge).

- [ ] **Step 3: Confirm `$8.25/mo, billed annually` (the old sub-line wording) is fully gone from cards**

Run: `rg -n '\$8\.25/mo, billed annually' app components`
Expected: matches ONLY inside prose lines that read `$8.25/mo, billed annually ($99/yr)` (i.e. always followed by `($99/yr)`). The three card sub-lines must now read `billed annually at $99/yr`, not the old `$8.25/mo, billed annually`. Spot-check each card hit.

- [ ] **Step 4: Full build (type-checks the edited TSX)**

Run: `pnpm build`
Expected: build succeeds, no type errors.

- [ ] **Step 5 (optional but recommended): Visual check**

Run: `pnpm dev`, then open `http://localhost:3000` (homepage card), `http://localhost:3000/pricing` (pricing card + CTA band), and the account page trial card. Confirm `$8.25` is the large hero number with `billed annually at $99/yr` directly beneath on all three cards.

- [ ] **Step 6: Push and open PR (only on user go-ahead)**

```bash
git push -u origin pricing-monthly-first
gh pr create --title "feat(marketing): lead pricing with \$8.25/mo (billed annually, \$99/yr)" \
  --body "Reframes all user-facing price surfaces to lead with \$8.25/mo while keeping \$99/yr legibly disclosed. Display-only — no billing/Stripe changes. schema.org price and active-subscriber status stay \$99/yr on purpose. Spec: docs/superpowers/specs/2026-06-16-monthly-first-pricing-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Do NOT merge (`--admin` or otherwise) — open for review only.

---

## Self-Review

**Spec coverage:** All 10 spec edits mapped to tasks (homepage card + 2 FAQ + hero card → Task 1; pricing card + meta + CTA band → Task 2; site description → Task 3; trial card + trial status → Task 4). The two "deliberately NOT changed" items (schema `price`, active-sub line) are explicitly guarded in Tasks 1, 4, 5. **One addition beyond the spec's explicit list:** the schema.org `description` *text* at `app/page.tsx:178` (Task 1 Step 5) — required to honor the spec's "everywhere, consistently" intent and avoid a stray `$99/year`; the structured `price` field stays `99.00`.

**Placeholder scan:** No TBD/TODO; every step shows exact before/after and exact commands.

**Type consistency:** Edits are to string/JSX text only — no new identifiers, signatures, or types introduced. Card markup structure (span/span/p) is preserved in all three cards; only text content changes.
