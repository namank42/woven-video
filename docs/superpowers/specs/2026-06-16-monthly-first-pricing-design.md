# Monthly-first pricing framing — design

**Date:** 2026-06-16
**Status:** Approved for planning
**Type:** Copy / display reframe (no billing changes)

## Problem

The Woven subscription is $99/year with a 7-day card trial. Every pricing surface
leads with the big number `$99 /year` and shows `$8.25/mo, billed annually` as a small
supporting line. Since enforcement went live (2026-06-03) conversions have been 0.

`$99` up front reads as expensive. A smaller monthly number anchors cheaper, even though
the actual charge is unchanged.

## Goal

Make the price *feel* cheap by leading with `$8.25/mo` on every surface, while keeping the
real annual charge (`$99/yr`) honestly and legibly disclosed. This is a pure display/copy
reframe — **annual billing and the 7-day card trial are untouched.**

`$8.25/mo` is exactly `$99 ÷ 12`, so the monthly figure is accurate (no rounding fudge).

## Decisions (locked)

1. **Display reframe only.** No new monthly Stripe price, no checkout/webhook changes.
   Billing remains a single annual $99 charge after a 7-day trial.
2. **Clear & legible disclosure.** `$8.25/mo` is the hero; `billed annually at $99/yr` sits
   directly beneath in normal, readable text (not greyed-out, not hidden until checkout).
   This is the difference between smart framing and an FTC drip-pricing problem — and it
   avoids a nasty surprise at the Stripe checkout step.
3. **Everywhere, consistently.** All cards + CTA band + FAQ + hero feature card + meta /
   OG descriptions reframe to monthly-first. Two deliberate exceptions (below).

## Canonical strings (single source of truth)

**Pricing cards (3):** swap prominence — do not add or remove elements.
```
$8.25  /mo                      ← hero (was: $99  /year)
billed annually at $99/yr       ← sub-line (was: $8.25/mo, billed annually)
```

**Prose / trial line** (FAQ, hero feature card, CTA band, meta + OG descriptions, in-app
trial status):
```
…7-day free trial, then $8.25/mo, billed annually ($99/yr) — cancel anytime.
```
The literal `$99/yr` stays in **every** prose mention, per the clear-disclosure decision.

## Change list (11 edits)

### Pricing cards — prominence swap

| # | File:line | Before | After |
|---|-----------|--------|-------|
| 1 | `app/page.tsx:496–502` | `$99` / `/year` + sub `$8.25/mo, billed annually` | `$8.25` / `/mo` + sub `billed annually at $99/yr` |
| 2 | `app/pricing/page.tsx:213–218` | `$99` / `/year` + sub `$8.25/mo, billed annually` | `$8.25` / `/mo` + sub `billed annually at $99/yr` |
| 3 | `components/account/subscription-cta.tsx:136–143` | `$99` / `/year` + sub `$8.25/mo, billed annually` | `$8.25` / `/mo` + sub `billed annually at $99/yr` |

For each card the markup keeps its existing shape: the large `<span>` becomes `$8.25`, the
unit `<span>` becomes `/mo`, and the sub `<p>`/`<span>` becomes `billed annually at $99/yr`.

### Prose / metadata — monthly-first canonical line

| # | File:line | Before | After |
|---|-----------|--------|-------|
| 4 | `app/page.tsx:89` (hero feature card body) | `Try Woven free for 7 days, then $99/year — cancel anytime. Bring your own…` | `Try Woven free for 7 days, then $8.25/mo, billed annually ($99/yr) — cancel anytime. Bring your own…` |
| 5 | `app/page.tsx:114` (FAQ "How much does Woven cost?") | `Woven is a 7-day free trial, then $99/year — cancel anytime, card required.…` | `Woven is a 7-day free trial, then $8.25/mo, billed annually ($99/yr) — cancel anytime, card required.…` |
| 6 | `app/page.tsx:126` (FAQ "Do I need an account?") | `…start a 7-day free trial ($99/year after).…` | `…start a 7-day free trial ($8.25/mo, billed annually — $99/yr after).…` |
| 7 | `app/pricing/page.tsx:22` (page meta description) | `Try free for 7 days, then $99/year — cancel anytime.…` | `Try free for 7 days, then $8.25/mo, billed annually ($99/yr) — cancel anytime.…` |
| 8 | `app/pricing/page.tsx:491` (CTA band) | `Then $99/year, cancel anytime. $5 in hosted credits to start.` | `Then $8.25/mo, billed annually ($99/yr). Cancel anytime. $5 in hosted credits to start.` |
| 9 | `app/layout.tsx:20–21` (site / OG description) | `Try free for 7 days, then $99/year; bring your own…` | `Try free for 7 days, then $8.25/mo, billed annually ($99/yr); bring your own…` |
| 10 | `components/account/subscription-cta.tsx:68` (trial status) | `Free until ${trialDay}, then $99/year. Cancel anytime before then.` | `Free until ${trialDay}, then $8.25/mo, billed annually ($99/yr). Cancel anytime before then.` |

### Unchanged CTA buttons

| # | File:line | Note |
|---|-----------|------|
| 11 | `app/page.tsx:525`, `app/pricing/page.tsx:241`, `components/account/subscription-cta.tsx` (`StartTrialButton`) | No change — "Start your 7-day free trial" stays. |

## Deliberately NOT changed

- **schema.org Offer price** (`app/page.tsx:183`, `price: "99.00"`) — structured data must
  equal the real transaction price; Google penalizes mismatches. The visible card leads
  with monthly; the machine-readable offer stays `99.00`.
- **Active-subscriber status** (`components/account/subscription-cta.tsx:73`,
  `$99/year · renews ${renewDay}`) — already-converted users; the annual figure is the
  accurate, relevant one for them. The cheap-feel matters pre-conversion.
- **Stripe** — `supabase/functions/create-checkout-session/index.ts`, `.env.example`,
  `STRIPE_SUBSCRIPTION_PRICE_ID`: zero changes.
- **`.env.example` comments** referencing "$99/yr" — describe the Stripe price (still $99/yr),
  not user-facing copy. Leave as-is.

## Risks & mitigations

- **Drip-pricing / bait-and-switch perception** → mitigated by the clear-disclosure decision:
  `$99/yr` is legible on every card and in every prose mention; the existing `$0 due today`
  and "card required" lines stay.
- **Inconsistency between adjacent copy** → mitigated by the "everywhere, consistently"
  scope; the only $99-led survivors are the two intentional exceptions above.
- **Accuracy** → `$8.25 × 12 = $99.00` exactly; no rounding mismatch with the real charge.

## Verification

- Grep for residual user-facing `$99/year` / `$99 /year` after edits — only the active-sub
  status line (#73) and `.env.example` comments should remain.
- Each of the 3 cards renders `$8.25` as the hero with `billed annually at $99/yr` beneath.
- schema.org JSON-LD still emits `"price": "99.00"`.
- Build passes; no type errors from the edited `.tsx`/template strings.
