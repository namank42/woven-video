# Docs Digest — Stripe subscription + free trial (card required) — 2026-06-07

Installed: `stripe@22.1.0` (supabase/functions/deno.json), apiVersion `2026-04-22.dahlia`.
Source: context7 `/websites/stripe` (docs.stripe.com). Pulled 2026-06-07.

## Checkout Session — subscription mode with a trial, card required
- `mode=subscription` + `subscription_data[trial_period_days]=7` → creates the subscription in
  status `trialing`, charges **$0 today**, auto-charges the price at trial end.
- **Card required:** set `payment_method_collection=always` (collects card up front). The
  no-card trial pattern uses `if_required` instead — we do NOT want that.
- Safety net: `subscription_data[trial_settings][end_behavior][missing_payment_method]=cancel`
  (cancel the sub if somehow no PM is on file at trial end). Options: `cancel | pause | create_invoice`.
- Reuse the existing `create-checkout-session` edge function; today it builds a `mode=payment`
  session — add a `mode=subscription` branch for `purpose: "subscription"`.

## Trial lifecycle webhook events (exact names)
- `customer.subscription.created` — fires at trial start; `status=trialing`.
- `customer.subscription.trial_will_end` — fires **3 days before** trial end (or immediately if
  trial < 3 days). For a 7-day trial this lands on ~day 4. Use this to trigger the reminder email.
  (NOTE: this is 3 days, not 2 — adjust marketing copy to "3 days before" or schedule our own.)
- `customer.subscription.updated` — every status transition (trialing→active, →past_due, →canceled).
  This is the primary event for syncing access state.
- `customer.subscription.deleted` — terminal cancellation.
- `invoice.paid` — the trial→paid conversion charge succeeded (also annual renewals).
- `invoice.payment_failed` — conversion/renewal charge declined → sub goes `past_due`.

## Subscription statuses → app access mapping
Full set: `trialing, active, past_due, canceled, incomplete, incomplete_expired, unpaid, paused`.
- `trialing` — in free trial. **GRANT access.** Auto-transitions to `active` on first payment.
- `active` — paid, good standing. **GRANT access.**
- `past_due` — latest invoice failed; Stripe keeps retrying (Smart Retries). **GRACE: grant access
  during the retry window**, then revoke when it resolves to `canceled`/`unpaid`.
- `canceled` — terminal. **REVOKE.**
- `unpaid` — invoice unpaid, no more attempts. **REVOKE.**
- `incomplete` / `incomplete_expired` — initial payment never completed (23h window). **REVOKE.**
- `paused` — trial ended with no payment method. **REVOKE.** (We require a card, so unlikely.)

## Declined card at trial conversion (dunning)
- On a failed conversion charge the subscription becomes `past_due` and Stripe runs **Smart Retries**
  / the retry schedule configured in the Dashboard (Billing → Subscriptions and emails → manage
  failed payments). After retries exhaust it transitions to `canceled` or `unpaid` per that setting.
- We do not implement retry logic ourselves — configure it in the Dashboard and react to the
  resulting `customer.subscription.updated` status in the webhook.

## Cancel during the trial
- **Stripe Customer Portal** (hosted, configured in Dashboard) is the lowest-code path — gives users
  self-serve cancel/update-card. Create a portal session server-side and redirect.
- API alternative: `subscriptions.update(id, { cancel_at_period_end: true })` cancels at trial end
  with **no charge** (access continues to trial end); `subscriptions.cancel(id)` ends immediately.
- For "cancel before you're charged," `cancel_at_period_end=true` during `trialing` is the clean path:
  no charge, access until the trial date, then it lapses.

## Implications for our design
- One Stripe **Price** in recurring/yearly mode ($99/year) replaces the one-time license price.
- Entitlement is no longer a one-shot `grant_license`; it's a **mirror of Stripe subscription status**.
  Need a `subscriptions` table (or extend `licenses`) keyed by `stripe_subscription_id` + `status` +
  `current_period_end` + `trial_end`, updated by webhooks.
- Access check `user_has_active_license()` becomes `user_has_access()` = status in
  {`trialing`,`active`,`past_due`(within grace)} OR grandfathered.
- Reminder email: trigger off `customer.subscription.trial_will_end` via Loops.
