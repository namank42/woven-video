# Design — Three-Day Free Trial

**Date:** 2026-07-31
**Status:** Approved design
**Repo scope:** `woven-video` and `woven-harness`
**Research digest:** `docs/superpowers/research/2026-07-31-three-day-trial-stripe-docs.md`

## 1. Goal

Change Woven's card-required free trial from seven days to three days for trials
created after the release. Keep the rest of the offer unchanged:

- `$99/year` automatic conversion
- `$5` in hosted credits granted once when the trial starts
- full app access during the trial
- cancellation through Stripe
- backend-owned trial eligibility and access

Existing active trials keep the `trial_end` already stored by Stripe. The
release must not update, shorten, recreate, or cancel an existing subscription.

## 2. Decisions

- The macOS app must explicitly advertise a three-day trial. It must not use
  duration-neutral copy.
- Release Harness before changing the live Checkout duration.
- Remove the inaccurate promise that Woven emails users before their trial
  ends. The code that emits the dormant Loops `trial_ending` event remains
  unchanged.
- Add verification of Stripe-hosted trial reminders to the operational release
  checklist. Do not build a custom reminder scheduler in this project.
- Remove stale seven-day refund-window wording from the website contact form
  and Harness feedback sheet. Woven is not promising a separate seven-day
  refund policy.
- Preserve the seven-day offline verification grace for paid and
  grandfathered users.
- Cap a trial user's cached offline access at the subscription's real
  `trial_end`.

## 3. Current Ownership

`woven-video` owns the offer and access contract:

- `supabase/functions/create-checkout-session/subscription.ts` creates the
  Stripe trial with `subscription_data.trial_period_days`.
- Stripe subscription webhooks mirror `status` and `trial_end` into
  `public.subscriptions`.
- `GET /api/v1/billing/balance` publishes `license.active` and
  `checkout_mode`.
- Web, account, checkout-return, legal, and SEO surfaces publish the offer.

`woven-harness` consumes that contract:

- `license.active` is the only access gate.
- `checkout_mode` controls acquisition copy and CTA behavior.
- `AcquisitionPresentation` contains the current seven-day trial language.
- `LicenseGate` caches the last server-verified access decision for seven days.

The ownership rules do not change. Trial eligibility remains backend-derived;
Harness does not infer eligibility from local state.

## 4. Stripe Checkout Contract

For trial-eligible checkout:

```ts
subscription_data: {
  metadata,
  trial_period_days: 3,
  trial_settings: {
    end_behavior: { missing_payment_method: "cancel" }
  }
}
```

The existing `payment_method_collection: "always"`, annual Price, metadata,
success/cancel redirects, reservation guard, and checkout-mode response remain
unchanged.

For trial-used users, Checkout continues to create an immediately paid annual
subscription with no `trial_period_days` or `trial_settings`.

Changing Checkout Session creation affects only subscriptions created by future
Checkout completions. There is no Subscription update call in this design.

## 5. Offline Trial-Expiry Contract

### Backend response

Extend the existing optional `license` object returned by
`GET /api/v1/billing/balance`:

```json
{
  "license": {
    "active": true,
    "granted_at": null,
    "offline_access_expires_at": "2026-08-03T10:00:00.000Z"
  }
}
```

`offline_access_expires_at` is an ISO-8601 timestamp used only to bound cached
offline access. It does not replace `license.active`, change online access
semantics, or determine checkout eligibility.

The backend derives it with this precedence:

1. If an active grandfathered or legacy lifetime license grants access, omit
   the field.
2. Otherwise, if any live `active` or `past_due` subscription grants access,
   omit the field.
3. Otherwise, if access comes from a `trialing` subscription with a valid
   `trial_end`, set the field to that `trial_end`.
4. A `trialing` row without a valid `trial_end`, or an error while resolving
   the access source, must not be represented as ordinary unbounded paid
   access. Preserve the existing unavailable-license behavior and log the
   inconsistency.
5. When `license.active` is false, omit the field.

This precedence prevents an unnecessary trial cap when the same account also
has a stronger perpetual or paid access source.

### Harness cache

Add the optional timestamp to `WovenLicense` and persist it through the existing
`CachedLicense` encoding. Because it is optional, caches written by older
Harness versions continue to decode.

`LicenseGate` keeps its seven-day `graceWindow`. Its decision order becomes:

1. No cache: `.unresolved`.
2. Negative cache age or age beyond seven days: `.staleLocked`.
3. Inactive cached license within the grace window: `.unlicensed`.
4. Active cached license with a supplied expiry:
   - malformed timestamp: `.staleLocked`
   - `now >= expiry`: `.staleLocked`
   - `now < expiry`: `.licensed`
5. Active cached license without a supplied expiry: `.licensed` while the
   existing seven-day grace remains fresh.

An absent expiry supports paid/grandfathered accounts, old caches, and the
Harness-first interval before the new backend is live. Once the backend
contract is deployed, every trial-backed active response must include a valid
expiry.

## 6. User-Facing Copy

Current production surfaces must consistently use:

- `3 days free, then $99/year. Cancel anytime.`
- `Start your 3-day free trial`
- `$0 due today · cancel anytime before day 3 · card required.`

Equivalent prose can be used where grammar requires it:

- `Try Woven free for 3 days.`
- `The full Woven app, free for 3 days.`
- `You have full access to Woven for the next 3 days.`
- `You won't be charged until day 3.`

Remove these promises from current product surfaces:

- `We email you before your trial ends.`
- refund requests being available within a seven-day window
- any seven-day trial, day-7 cancellation, or seven-days-free wording

### `woven-video` surfaces

- `app/page.tsx`
- `app/pricing/page.tsx`
- `app/terms/page.tsx`
- `app/account/page.tsx`
- `components/marketing/page-sections.tsx`
- `components/account/subscription-offer.ts`
- `components/account/start-trial-button.tsx`
- `components/checkout/checkout-result.tsx`
- `components/contact/contact-form.tsx`
- current SEO content under `lib/seo/`

### `woven-harness` surfaces

- `Sources/WovenHarness/Models/AcquisitionPresentation.swift`
- `Sources/WovenHarness/Views/FeedbackSheet.swift`

Historical design documents, implementation plans, changelog entries, and old
Sparkle appcast release notes remain historical records and are not rewritten.
Seven-day media retention, test-data timestamps, and unrelated grace periods
also remain unchanged. The current `LicenseGate` comment must be updated because
its explanation is live code documentation, not history.

## 7. Data Flow

### New trial after cutover

1. The backend returns `checkout_mode: "trial"` for a trial-eligible,
   no-access user.
2. Web and current Harness builds display the three-day offer.
3. Checkout creates a new Stripe subscription with
   `trial_period_days: 3`.
4. The webhook mirrors `status: "trialing"` and the Stripe `trial_end`, grants
   the existing idempotent `$5` credit, and keeps access active.
5. The balance route returns `license.active: true` and
   `offline_access_expires_at: trial_end`.
6. Harness permits cached offline access only until the earlier of the normal
   seven-day cache limit and the real trial expiry.
7. At the trial end, existing Stripe invoice and webhook behavior handles
   conversion to `active`, failure to `past_due`, or cancellation.

### Existing trial

No Stripe mutation occurs. Its original `trial_end` remains authoritative and
is published as the offline cache bound. A seven-day trial started before the
cutover therefore keeps all seven promised days.

### Paid or grandfathered access

`license.active` remains true, no trial expiry is published, and the existing
seven-day offline cache behavior remains unchanged.

## 8. Error Handling

- Missing or unknown `checkout_mode` continues to fail closed to paid-safe
  acquisition copy.
- Failure to resolve access continues to use the current optional-license
  behavior; the backend must not fabricate `active: false` or an expiry.
- A malformed supplied expiry fails closed in Harness.
- A missing expiry remains backward-compatible, but the deployed backend must
  never intentionally omit it for trial-backed active access.
- Checkout failure, Stripe webhook retry behavior, `$5` credit idempotency,
  Customer Portal behavior, and subscription status mapping are unchanged.
- The dormant Loops event handler remains a no-op from the customer's
  perspective unless a workflow is activated separately.

## 9. Testing

### `woven-video`

- Checkout builder returns `trial_period_days: 3` for trial-eligible users.
- Trial-used checkout still omits all trial parameters.
- Checkout origin and success/cancel redirects are unchanged.
- Trial presentation helpers use three-day copy and contain no email promise.
- Checkout-success copy uses three days.
- Balance-response tests cover:
  - perpetual/legacy access: no trial expiry
  - active subscription: no trial expiry
  - `past_due` subscription: no trial expiry
  - trialing subscription: exact mirrored `trial_end`
  - trialing subscription with invalid/missing end: unavailable-license path
  - inactive account: no trial expiry
- Current product-source scans prove there are no remaining seven-day trial,
  day-7 cancellation, trial-email, or seven-day refund promises.
- Billing tests, type checks, and the production build pass.
- Per the repo `AGENTS.md`, implementation must read the relevant local
  `node_modules/next/dist/docs/` guidance before modifying Next.js code.

### `woven-harness`

- Acquisition presentation asserts the exact three-day headline, detail, and
  CTA.
- Trial presentation contains no trial-ending-email promise.
- Feedback copy contains no seven-day refund promise.
- Balance decoding supports a valid expiry and remains compatible when it is
  absent.
- Existing cached-license JSON without the new field still decodes.
- License-gate tests cover:
  - trial cache before expiry: licensed
  - exact trial expiry: stale locked
  - after trial expiry: stale locked
  - malformed supplied expiry: stale locked
  - paid/perpetual access without expiry: existing seven-day grace
  - normal seven-day stale boundary and clock rollback behavior
- Focused tests plus the normal Xcode test/build verification pass.

## 10. Release Sequence

1. Implement Harness in an isolated feature branch or worktree based on
   `origin/main`. At design time, local Harness `main` is two commits ahead and
   has an untracked `.pnpm-store/`; those unrelated changes must not enter this
   patch.
2. Test, notarize, and release the Harness patch through the normal
   `project.yml` → `xcodegen generate` → `scripts/release.sh` → appcast flow.
3. Verify the public DMG/appcast and the exact three-day Harness UI.
4. Merge and push the `woven-video` change. Allow Vercel to publish the web,
   terms, SEO, and balance-response changes first.
5. Verify live copy and the additive balance contract.
6. Deploy `supabase/functions/create-checkout-session`. This deployment is the
   actual three-day cutover for newly created trials.
7. Verify a new test trial receives a three-day Stripe `trial_end`, while a
   pre-existing trial retains its original timestamp.
8. Verify Stripe-hosted trial reminder settings in the production Dashboard.

This order can briefly display three days while Checkout still grants seven.
It must never deploy the shorter Checkout duration while current web or the new
Harness release still promises seven days.

There is no forced minimum Harness version. Old installed builds can retain
stale seven-day copy until Sparkle updates them; releasing Harness first and
verifying the appcast minimizes but cannot eliminate that compatibility window.

## 11. Rollback

- Before the Edge Function cutover, Harness and Vercel can be rolled back
  without affecting Stripe subscription state.
- After cutover, restore `trial_period_days: 7` and the matching current copy if
  the offer must be reverted.
- Trials already created with three days keep their stored `trial_end`; rollback
  does not mutate them.
- Do not run a bulk Stripe Subscription update in either direction.

## 12. Acceptance Criteria

- A trial created after the Edge Function cutover has a three-day Stripe trial.
- A trial created before cutover retains its original end date.
- Web, pricing, terms, account, checkout return, SEO, and current Harness
  advertise three days.
- Current product surfaces contain no promised trial-ending email or seven-day
  refund window.
- Trial eligibility remains backend-driven through `checkout_mode`.
- `license.active` remains the access gate.
- Trial-backed cached access stops at the mirrored Stripe `trial_end`.
- Paid and grandfathered users retain the existing seven-day offline grace.
- `$5` trial credits, `$99/year` conversion, cancellation, webhook
  idempotency, and trial-used behavior remain unchanged.
- Harness ships before the live Checkout duration changes.
- Stripe-hosted trial reminder settings are explicitly verified during release.
