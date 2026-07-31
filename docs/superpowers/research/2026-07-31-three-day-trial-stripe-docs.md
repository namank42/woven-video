# Docs Digest — Three-Day Stripe Trial — 2026-07-31

## Stripe Node (context7: `/stripe/stripe-node`) — v22.1.0 installed

- Woven pins `stripe` to `npm:stripe@22.1.0` and uses Stripe API version
  `2026-04-22.dahlia` in its Supabase Edge Functions.
- `Checkout.SessionCreateParams.subscription_data.trial_period_days` is an
  optional integer and must be at least `1`, so `3` is a valid trial length.
- The existing Woven shape remains valid:
  `subscription_data: { trial_period_days: 3, trial_settings: {
  end_behavior: { missing_payment_method: "cancel" } } }`.
- Source: context7 `/stripe/stripe-node` and installed
  `supabase/functions/deno.json`.

## Stripe Billing and Checkout (context7: `/websites/stripe`)

- A Checkout Session in `mode: "subscription"` can set the new
  subscription's trial through
  `subscription_data.trial_period_days`.
- Changing Woven's Checkout Session creation affects subscriptions created by
  future Checkout completions. Existing subscriptions retain their stored
  `trial_end` unless Woven explicitly updates each Subscription through the
  Subscription API. This design does not perform those updates.
- `customer.subscription.trial_will_end` normally occurs three days before the
  scheduled end. If a trial is shortened so that fewer than three days remain,
  it can fire immediately. A three-day trial therefore does not provide a
  useful later reminder window through this event.
- Stripe says trial offers must meet card-network notification requirements.
  Stripe-hosted trial reminder emails can be enabled in Dashboard settings; for
  trials shorter than seven days, Stripe sends that reminder as soon as the
  trial begins. Self-hosted reminders can instead use Stripe events, but the
  merchant remains responsible if neither option is used.
- Woven currently emits a Loops `trial_ending` event but has no active customer
  email workflow. Removing the false product-copy promise is separate from
  deciding how Woven satisfies notification requirements operationally.
- Sources:
  - Context7 `/websites/stripe`
  - <https://docs.stripe.com/payments/checkout/free-trials>
  - <https://docs.stripe.com/api/events/types#event_types-customer.subscription.trial_will_end>
  - <https://docs.stripe.com/billing/subscriptions/trials/manage-trial-compliance>
  - <https://docs.stripe.com/api/subscriptions/update>
