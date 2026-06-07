# Design — $99/yr subscription + 7-day free trial (card required)

**Date:** 2026-06-07
**Status:** Approved design, pre-implementation
**Repo scope:** `woven-video` (Next.js web + Supabase edge functions + DB migrations). The macOS
desktop app is a separate codebase and is treated here as a downstream dependency.
**Research digest:** `docs/superpowers/research/2026-06-07-stripe-trial-subscription-docs.md`

## 1. Problem & goal

Fresh users bounce at two points: on the marketing site, and after download when they hit the
`$99` one-time paywall before ever trying the product. The whole app is gated today — even
bring-your-own-key users must buy the license first — so people are asked to pay `$99` for an
unproven tool sight-unseen. Conversions to date: **0**.

**Goal:** replace the upfront one-time purchase with a low-friction **7-day free trial that requires
a card** and **auto-converts to a `$99/year` subscription**. The trial reframes the website CTA from
"$99" to "Start free trial" (helps the site bounce) and lets people use the product before paying
(helps the post-download bounce). Starting recurring now — while pre-launch with 0 conversions — locks
in the subscription model at its cheapest possible moment (no lifetime holders to migrate later).

## 2. Decisions locked (with founder)

- **Model:** one-time `$99` lifetime → **`$99/year` recurring subscription**.
- **Trial:** **7 days** (not 3 — video tools have a long time-to-first-value; the card-on-file already
  supplies the urgency), **card required up front**, `$0` charged today, auto-charge at day 7.
- **Trial credits:** grant **`$5` hosted credits once at trial start** so trial users can actually
  test Woven-hosted models during the 7 days. (Replaces the old "license includes `$5` credits.")
- **Money-back guarantee:** **dropped.** The free trial is the risk-free try; "cancel anytime before
  you're charged" replaces "7-day money-back guarantee."
- **Grandfathered users (13):** **stay free forever.** The trial→sub funnel applies to new signups only.
- **Lead marketing with the trial**, not the price — `$99/year` sits below the fold.

## 3. User flow

1. **Website** — hero leads with *"Try Woven free for 7 days · then `$99/year`, cancel anytime"*,
   CTA *"Start free trial."* Download `.dmg` / sign in.
2. **Download → sign in** (Google OAuth, unchanged).
3. **Start trial** — "Start 7-day free trial" → Stripe Checkout (`mode=subscription`, card required,
   `$0` today). On success the subscription is created in status `trialing`; webhook grants `$5`
   hosted credits and unlocks the app.
4. **During trial** — full app access; `$5` credits available for hosted models or BYOK.
5. **Day ~4** — Stripe `customer.subscription.trial_will_end` (fires 3 days before end) → Loops
   reminder email ("trial ends in 3 days, `$99/yr` starts then").
6. **Day 7 conversion** — auto-charge `$99` → `invoice.paid` → status `active`. If the card declines →
   `past_due` (access continues during Stripe Smart Retries grace) → resolves to `active` or `canceled`.
7. **Cancel anytime** — Stripe Customer Portal. Canceling during the trial = `cancel_at_period_end`,
   no charge, access until the trial date, then it lapses.

## 4. Stripe configuration

- **Price:** new recurring yearly Price, `$99/yr` → env `STRIPE_SUBSCRIPTION_PRICE_ID`. Retire
  `STRIPE_LICENSE_PRICE_ID` for new sales (retained for grandfather/legacy/refund history).
- **Checkout** (`create-checkout-session`, new `mode=subscription` branch, `purpose: "subscription"`):
  - `mode=subscription`
  - `subscription_data[trial_period_days]=7`
  - `payment_method_collection=always`  ← requires the card up front
  - `subscription_data[trial_settings][end_behavior][missing_payment_method]=cancel`  (safety net)
  - `metadata { user_id, purpose: "subscription" }`
  - success → `/account?subscription=trialing` (web) or `/checkout/success` (app origin)
- **Dunning:** configured in the Stripe Dashboard (Smart Retries / failed-payment schedule). We do
  **not** implement retry logic; we react to the resulting `customer.subscription.updated` status.
- **Webhook events to handle** (`stripe-webhook`):
  | Event | Action |
  |---|---|
  | `customer.subscription.created` | upsert `subscriptions` row (`trialing`); grant `$5` trial credits (idempotent on `subscription_id`) |
  | `customer.subscription.updated` | sync `status`, `current_period_end`, `trial_end`, `cancel_at_period_end` |
  | `customer.subscription.deleted` | mark `canceled` |
  | `customer.subscription.trial_will_end` | trigger Loops reminder email |
  | `invoice.paid` | conversion/renewal succeeded → `active` |
  | `invoice.payment_failed` | declined → `past_due`; trigger Loops "card declined" email |

  The existing one-time `checkout.session.completed` / `charge.refunded` handlers stay for legacy
  license records but receive no new traffic.

## 5. Data model

New migration adding a **`subscriptions`** table (one active row per user, written only by webhooks /
service role):

| Column | Notes |
|---|---|
| `id` | pk |
| `user_id` | fk → profiles |
| `stripe_subscription_id` | unique |
| `stripe_customer_id` | |
| `status` | `trialing`/`active`/`past_due`/`canceled`/`unpaid`/`incomplete`/`incomplete_expired`/`paused` |
| `price_id` | |
| `trial_end` | timestamptz, nullable |
| `current_period_end` | timestamptz |
| `cancel_at_period_end` | bool |
| `created_at` / `updated_at` | |

**Access RPC** — `user_has_access(p_user_id uuid) returns boolean`:
`true` if grandfathered (existing `licenses`/cutoff logic, unchanged) **OR** the user's latest
subscription `status ∈ {trialing, active, past_due}`. Client-readable `has_access()` wraps it for the
current user.

Status → access mapping (from research digest):
- `trialing`, `active` → **grant**
- `past_due` → **grant (grace during Smart Retries)**
- `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused` → **revoke**

The `licenses` table and grandfather/cutoff logic are left intact and honored.

## 6. Enforcement

- `lib/api/license.ts` gate switches from `user_has_active_license` to `user_has_access`
  (same fail-open-on-infra-error behavior). The deploy flag `WOVEN_ENFORCE_LICENSE` is kept as-is to
  avoid env churn; its meaning now covers subscription access.
- **Account page** (`app/account/page.tsx`) shows trial/subscription state: "Trial ends Jun 14 ·
  `$99/yr` after," or "Active · renews <date>," plus a **"Manage billing"** button → Customer Portal.
- **Top-up form** (`components/account/balance-top-up-form.tsx`): gating message updated from
  "A lifetime license is required" to access-based wording.

## 7. Cancellation — Customer Portal

New edge function `create-portal-session` (Stripe Billing Customer Portal): server-side creates a
portal session for the user's `stripe_customer_id`, returns the URL, web redirects. Portal is
configured in the Stripe Dashboard to allow cancel + update payment method. (API fallback if portal is
undesirable: `subscriptions.update(id, {cancel_at_period_end:true})`.)

## 8. Lifecycle emails (Loops)

Reuse the existing Loops integration (the repo already syncs signups to Loops). Triggered from the
webhook:
- `trial_will_end` → "Your trial ends in 3 days" (`$99/yr` starts).
- `invoice.payment_failed` → "We couldn't charge your card" (update payment method link).
- `customer.subscription.deleted` → optional winback (later).

## 9. Marketing / copy changes

- `app/pricing/page.tsx` — hero, CTA, and bullets: lead with the trial; `$99/year`; "cancel anytime";
  remove "yours forever / no subscription" and the "7-day money-back guarantee" line; the `$5` credits
  line reframed as "included in your trial."
- `app/page.tsx` (home) — same offer reframing where the `$99` lifetime line appears.
- `components/account/license-cta.tsx` + `license-buy-button.tsx` — "Start free trial" instead of
  "Buy lifetime license — $99"; calls the subscription checkout.
- `components/checkout/checkout-result.tsx` and `app/checkout/success|cancelled` — trial-start copy.

## 10. Out of scope / dependencies

- **Desktop app (separate repo):** must add the "Start free trial" entry point, surface trial state
  (days remaining), and call the new `has_access`/access check. Tracked as a dependency, not built here.
- **Trial abuse** (throwaway Google accounts for repeat trials): **YAGNI now** — card-required is the
  primary deterrent and we're pre-launch. Revisit if churned-trial abuse appears.

## 11. Risks

- Subscription framing is a weaker website hook than "lifetime"; mitigated by leading with the free
  trial so `$99/yr` is below the fold.
- `$5` trial credits are spendable by someone who cancels before converting; bounded by card-required +
  the small amount. Accepted.
- Webhook status-sync is now the source of truth for access — must be idempotent and handle
  out-of-order events (use `current_period_end`/event timestamps to avoid stale overwrites).

## 12. Success criteria

- A new user can start a 7-day trial with a card, `$0` charged, and immediately use the app with `$5`
  hosted credits.
- At day 7 the card is auto-charged `$99`; access continues seamlessly on `active`.
- A declined conversion moves to `past_due` with grace, then resolves per Stripe retries.
- A user can cancel in the trial via the Customer Portal and is never charged.
- Grandfathered users retain free access throughout.
- The pricing/home pages lead with the trial offer; no "lifetime"/"money-back guarantee" copy remains.
