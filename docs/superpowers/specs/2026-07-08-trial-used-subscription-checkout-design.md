# Design - Trial-used subscription checkout

**Date:** 2026-07-08  
**Status:** Approved design; implementation plan pending  
**Primary repo:** `woven-video`  
**Consumer repo:** `woven-harness`

## 1. Goal

Once a user has used a Woven trial, the backend must stop offering another trial. A trial-used, no-access user should be asked to start the paid annual subscription, not another 7-day free trial.

The important product rule is account-level and server-owned:

- `trial_used = true` once the account has ever had a Woven subscription/trial row.
- `trial_used = false` only when the account has never started a subscription trial.
- `has_access` remains separate and still means grandfathered access, legacy license, or a live subscription state.

## 2. Current State

`supabase/functions/create-checkout-session/index.ts` currently treats every no-access `purpose: "subscription"` request as trial-eligible. It checks `user_has_access`, returns `{ alreadySubscribed: true }` for users with access, and otherwise creates a subscription Checkout session with `subscription_data.trial_period_days: 7`.

The existing harness migration spec explicitly allowed a lapsed user to see and start another free trial. That policy is now wrong. The backend needs to enforce the new rule so web and desktop clients cannot drift.

## 3. Dependencies

Use the docs digest at `docs/superpowers/research/2026-07-08-trial-used-subscription-docs.md`.

Relevant installed versions:

- Stripe Node via Supabase Edge Functions: `stripe@22.1.0`
- Supabase JS: `@supabase/supabase-js@2.105.1`
- Next.js: `next@16.2.3`

Stripe Checkout supports both required flows with the same `mode: "subscription"` API:

- Trial checkout: include `subscription_data.trial_period_days: 7` and the existing trial settings.
- Immediate paid subscription checkout: omit trial fields and use the same recurring price.

## 4. Backend Contract

Add a stable backend eligibility contract:

```ts
type CheckoutMode = "trial" | "subscription" | "none";
```

`trial` means the account has no access and has never used a trial.  
`subscription` means the account has no access and has already used a trial.  
`none` means the account already has access, so there is no checkout CTA.

Expose the contract in read responses consumed by clients:

```json
{
  "currency": "usd",
  "balance_usd_micros": 0,
  "balance_usd": 0,
  "license": { "active": false, "granted_at": null },
  "trial_used": true,
  "checkout_mode": "subscription"
}
```

The existing `license.active` field continues to control access. New fields only control copy and Checkout intent.

## 5. Database Design

Add RPCs:

- `public.user_trial_used(p_user_id uuid) returns boolean`
- `public.trial_used() returns boolean`

`user_trial_used` returns `true` when any row exists in `public.subscriptions` for the user, regardless of status. This intentionally counts `trialing`, `active`, `past_due`, `canceled`, `incomplete`, `incomplete_expired`, `unpaid`, `paused`, and any future Stripe status recorded by the webhook.

This derives eligibility from the subscription mirror instead of adding a second mutable flag. The existing `subscriptions_user_status_idx` has `user_id` as its leftmost column, so the lookup can use the current index.

Permissions should mirror `user_has_access`:

- no public/anon execute
- authenticated and service-role may execute `trial_used`
- service-role may execute `user_trial_used`

## 6. Checkout Session Design

Update `create-checkout-session` for `body.purpose === "subscription"`:

1. Authenticate the user and ensure billing account/customer as today.
2. Call `user_has_access(p_user_id)`.
3. If access exists, return `{ alreadySubscribed: true, checkoutMode: "none" }`.
4. Call `user_trial_used(p_user_id)`.
5. If `trial_used === false`, create the existing trial Checkout:
   - `mode: "subscription"`
   - same customer, client reference, recurring price, redirects
   - `payment_method_collection: "always"`
   - `subscription_data.trial_period_days: 7`
   - existing `trial_settings.end_behavior.missing_payment_method: "cancel"`
   - metadata includes `trial_eligible: "true"`
   - response includes `{ url, checkoutMode: "trial" }`
6. If `trial_used === true`, create an immediate paid annual subscription Checkout:
   - `mode: "subscription"`
   - same customer, client reference, recurring price, redirects
   - no `trial_period_days`
   - no `trial_settings`
   - metadata includes `trial_eligible: "false"`
   - response includes `{ url, checkoutMode: "subscription" }`

Keep `origin: "app" | "web"` redirect allowlisting exactly as it works today. Do not accept arbitrary redirect URLs.

## 7. Web Account Design

The web account page should use the same eligibility contract:

- no access + `checkout_mode: "trial"`: show trial CTA and trial copy.
- no access + `checkout_mode: "subscription"`: show subscription CTA and no "$0 due today" / "free trial" copy.
- access + subscription row: show subscription status and management as today.
- access without subscription row: show grandfathered/full-access status as today.

Keep the existing `createTrialCheckoutSession` action name for this pass to avoid unrelated churn. The action should continue to verify auth inside the action before calling the Edge Function and redirecting, per current Next.js server-action guidance.

## 8. Harness Consumer Design

`woven-harness` should consume backend state, not guess from local `sawActiveLicense`.

Planned harness changes after the backend contract exists:

- Decode `trial_used` and `checkout_mode` from `GET /api/v1/billing/balance`.
- Keep `license.active` as the only access gate.
- If gated with `checkout_mode: "trial"`, render trial CTA/copy.
- If gated with `checkout_mode: "subscription"`, render paid subscription CTA/copy.
- Keep the same in-app Checkout call; the backend decides whether the Stripe session has a trial.

Old harness builds remain compatible because the new fields are additive.

## 9. Error Handling

Checkout should not accidentally grant another trial under uncertainty.

- If `user_has_access` fails, return a 500 as today.
- If `user_trial_used` fails, return a clear 500 and do not create Checkout.
- Do not silently create an immediate paid Checkout after an eligibility lookup failure, because that could surprise someone who expected a trial.
- If `GET /api/v1/billing/balance` cannot compute `trial_used`, omit or null the new fields and keep the existing access response behavior. New clients should only show subscription-specific copy when the backend explicitly says `checkout_mode: "subscription"`.

## 10. Tests

Backend database/RPC tests:

- no subscription rows -> `trial_used = false`
- any subscription row -> `trial_used = true`
- statuses such as `trialing`, `active`, `past_due`, and `canceled` all count
- `has_access` remains unchanged by the new RPC

Edge Function tests/stubs:

- access user -> `{ alreadySubscribed: true, checkoutMode: "none" }`
- no access + no prior subscription -> trial Checkout includes `trial_period_days: 7`
- no access + prior subscription -> Checkout omits trial fields and returns `checkoutMode: "subscription"`
- eligibility RPC error -> no Stripe session is created

Web tests:

- no access + trial available -> "Start your 7-day free trial"
- no access + trial used -> subscription CTA, no trial wording
- access states continue to show existing manage/full-access surfaces

Harness tests will live in `woven-harness` when that consumer update is implemented:

- balance decoding preserves additive compatibility
- paywall presentation switches between trial and subscription CTA

## 11. Rollout

Ship order:

1. `woven-video` migration/RPC and checkout contract.
2. `woven-video` web account copy/CTA update.
3. `woven-harness` decode and paywall copy update.

The backend must ship before the harness UI change so the desktop app has a server-owned eligibility signal to consume.

## 12. Out of Scope

- Reworking subscription management, cancellation, or resume flows.
- Changing `has_access` semantics.
- Adding in-app trial countdown/status in `woven-harness`.
- Backfilling a separate trial ledger; historical subscription rows are the source of truth.
- Preventing trials across multiple user accounts or Stripe customers. This design is account-level only.

## 13. Success Criteria

- A brand-new no-access account starts a 7-day trial Checkout.
- A no-access account that previously started any subscription/trial sees subscription copy and gets an immediate paid annual subscription Checkout.
- A live trialing/active/past_due subscriber is not walled and does not see a checkout CTA.
- A grandfathered user keeps access and is not prompted to subscribe.
- Web and harness CTAs are driven by the same backend eligibility contract.
