# Past-Due Access Revocation Design

**Date:** 2026-08-24
**Status:** Approved for planning
**Repositories:** `woven-video`, `woven-harness`

## Problem

Stripe changes an automatic subscription to `past_due` when the first paid invoice after a trial, or a later renewal invoice, cannot be collected. Woven currently treats `past_due` as an access-granting state. A customer can therefore continue using the app throughout Stripe's configured retry window even though the first payment failed.

Woven must revoke access when Stripe reports `past_due`, show the existing desktop paywall promptly in an open app, and provide a recovery path that updates the existing subscription rather than creating a duplicate subscription.

## Goals

- Treat only `trialing` and `active` subscriptions as access-granting.
- Revoke server-side access as soon as the failed invoice is reflected in Stripe.
- Route an online, open desktop app to the paywall shortly after revocation without polling.
- Let the customer update the payment method for the existing subscription.
- Restore access promptly after a successful retry.
- Preserve grandfathered and legacy license access.
- Keep server enforcement authoritative even if Realtime delivery fails.

## Non-Goals

- Cancel work that was accepted before revocation.
- Guarantee immediate revocation while the desktop is offline.
- Remotely change already-installed desktop versions that do not contain the new listener.
- Replace Stripe Smart Retries or implement a Woven retry schedule.
- Add a detailed dunning or invoice-history interface to the desktop app.

## Access Contract

`public.user_has_access(user_id)` remains the canonical entitlement decision.

Access is granted when any of these are true:

- The account has grandfathered access.
- The account has an active legacy license.
- The account has a mirrored Stripe subscription with status `trialing` or `active`.

`past_due`, `unpaid`, `canceled`, `incomplete`, `incomplete_expired`, `paused`, and unknown future Stripe statuses do not grant subscription access.

Trial history remains independent of access. A `past_due` or terminal subscription still counts as having used a trial.

## Authoritative Event Flow

1. Stripe attempts the invoice payment.
2. On failure, Stripe changes the subscription to `past_due` and emits invoice and subscription events.
3. `stripe-webhook` receives `invoice.payment_failed`, resolves the invoice's subscription reference, retrieves the current Subscription object from Stripe, and passes it through the existing order-safe `record_subscription` path.
4. The mirrored `subscriptions.status` becomes `past_due`.
5. `user_has_access` immediately returns false unless the account has another valid access source.
6. Protected hosted endpoints reject subsequent requests through their existing entitlement check.
7. Supabase Realtime emits the row update to the authenticated desktop client that owns the row.
8. The desktop treats the event as invalidation, fetches `/api/v1/billing/balance`, and applies the server's full entitlement decision.
9. If access is false, the existing top-level routing displays `LicensePaywallView`.

`invoice.paid` uses the same synchronization path before its existing notification work. A recovered Stripe subscription is mirrored as `active`; Realtime invalidates the desktop cache; the balance refresh restores access.

The invoice webhook never derives entitlement from the invoice alone. It retrieves the current Stripe Subscription so Stripe remains authoritative and event ordering is handled by `record_subscription.last_event_at`.

## Backend Changes

### Database

Add forward-only migrations rather than editing historical migrations:

- Replace `user_has_access(uuid)` so subscription access includes only `trialing` and `active`.
- Preserve the function's existing security-definer configuration and grants.
- Add `public.subscriptions` to the `supabase_realtime` publication conditionally, so deployment also succeeds if it was enabled manually.
- Preserve the existing RLS policy `user_id = auth.uid()`. Realtime subscribers can receive only their own subscription rows.

### Stripe Webhook

Extend `invoice.payment_failed` and `invoice.paid` handling:

- Read the subscription ID from the Stripe API-version-specific invoice subscription details.
- Ignore invoices that are not associated with a subscription.
- Retrieve the current subscription from Stripe.
- Call the existing subscription mirror handler with `event.created` before sending the Loops notification.
- Keep `customer.subscription.created`, `updated`, and `deleted` handling as redundant authoritative coverage.
- Keep the current stale-event guard so an older event cannot overwrite a newer terminal or recovered status.

### Balance Contract

Add an optional additive `payment_required` boolean to `/api/v1/billing/balance`.

- `true` when the combined entitlement is inactive and the authenticated account has a mirrored `past_due` or `unpaid` subscription.
- `false` otherwise.
- It selects desktop acquisition copy and action only; it never grants or revokes access.
- `license.active` continues to come exclusively from `has_access()`.

Remove `past_due` from live-subscription and unlimited offline-access resolution. Only `trialing` and `active` can be access sources.

### Checkout and Account Recovery

`create-checkout-session` must reject subscription checkout when an existing subscription is `past_due` or `unpaid`. The response uses a stable conflict code such as `subscription_payment_required`, preventing duplicate annual subscriptions while Stripe is retrying the existing one.

The website account component must render the existing subscription-management card whenever a `past_due` or `unpaid` row exists, even though `hasAccess` is false. It shows payment-attention copy and the existing **Manage billing** action.

The existing authenticated `create-portal-session` Edge Function remains the only portal-session creator. No Stripe secret or customer identifier is exposed to the desktop.

## Desktop Changes

### Realtime Listener

`WovenAccountStore` owns one listener task and one Realtime channel for the current authenticated user.

- Store the authenticated Supabase user ID alongside the access token.
- After sign-in or session restoration, create a channel scoped to `public.subscriptions` and filtered by `user_id`.
- Register for insert, update, and delete changes because checkout can create a first row, payment status updates mutate it, and administrative cleanup could delete it.
- Subscribe first, then refresh balance. This ordering closes the initial-fetch race.
- Every matching event triggers `refreshBalance()`; the event payload itself never directly changes the license cache.
- Stop and remove the old channel on sign-out, session loss, account change, and store teardown.
- Avoid duplicate channels when auth-state callbacks repeat for the same user.

Reconnect behavior must refresh balance after the channel becomes subscribed again. App foregrounding retains its existing balance refresh as a fallback for missed events. The store tracks channel health and the last successful balance verification so fallback checks do not become continuous polling. A healthy channel uses a five-minute stale-verification threshold for defense in depth; this is separate from the seven-day offline cache window.

### Request-Time Enforcement

Before admitting a new local/BYOK/Codex operation, refresh entitlement and re-check `licenseDecision` only when Realtime is disconnected or the last successful verification is stale. A healthy subscribed channel does not add a balance request to every operation. This covers paths that otherwise rely only on the cached client decision without turning the fallback into polling.

Hosted backend routes run `user_has_access` as part of the requested operation, so they do not need a separate client preflight. Stale or old clients cannot start hosted work after revocation when production license enforcement is enabled.

### Paywall Recovery State

Decode the additive `payment_required` field. When access is false and this field is true, `LicensePaywallView` shows payment-recovery presentation instead of acquisition presentation:

- Headline: **Payment needs attention**
- Supporting copy: the last payment failed and access will return after the payment method is updated and Stripe collects the invoice.
- Primary action: **Update payment method**
- Secondary actions: **Refresh**, **Contact us**, and **Sign out**

The primary action calls the existing `create-portal-session` Edge Function with the current Supabase bearer token and opens the returned Stripe URL. If portal creation fails, fall back to the web account page, which exposes the same Manage billing action.

The paywall keeps listening to Realtime. Returning from the browser also causes the existing foreground refresh. A successful payment therefore clears the paywall through either path.

## Failure Handling

- **Realtime unavailable:** foreground and stale/disconnected request-time refreshes preserve correctness; the server rejects hosted requests.
- **Balance refresh fails after an event:** retain the last verified cache, surface the existing error, and retry on reconnect, foreground, or user refresh. The server remains authoritative for hosted calls.
- **Stripe subscription retrieval fails:** return a webhook error so Stripe retries; do not guess a status from the invoice.
- **Out-of-order Stripe events:** `record_subscription.last_event_at` prevents older events from regressing the mirror.
- **Multiple access sources:** a Realtime subscription event only invalidates the cache. The balance endpoint preserves grandfathered or legacy access.
- **Multiple subscriptions:** any `trialing` or `active` subscription grants access. A `past_due` row makes `payment_required` true only when the combined entitlement is inactive.
- **Offline desktop:** immediate revocation is impossible. The existing bounded cache policy applies until the app reconnects; subsequent hosted requests cannot pass server enforcement.
- **Old desktop versions:** server enforcement blocks hosted APIs, but old clients can retain local/BYOK access within their cache window. This is accepted until the new desktop version is adopted; minimum-version enforcement is separate work.
- **In-flight work:** requests already authorized continue. Revocation applies to subsequently admitted work.

## Security And Privacy

- Realtime uses the authenticated user's JWT and the existing read-own RLS policy.
- The client filter limits traffic but is not the authorization boundary; RLS is.
- Realtime events contain subscription metadata already readable by the same user through PostgREST.
- Stripe portal sessions are created server-side after authenticated user lookup.
- No service-role key, Stripe secret, or cross-user subscription data is shipped to the desktop.

## Testing

### `woven-video`

- SQL integration tests prove `trialing` and `active` grant access while `past_due` and terminal statuses do not.
- Tests preserve grandfathered and active legacy-license access with a delinquent subscription.
- Balance-route tests cover `license.active`, `payment_required`, and checkout mode for past-due and recovered accounts.
- Offline-access tests remove `past_due` as an unlimited access source.
- Webhook tests cover failed and paid subscription invoices, non-subscription invoices, subscription retrieval failure, and stale event ordering.
- Checkout tests reject `past_due` and `unpaid` without creating a Stripe Checkout session.
- Account component tests keep Manage billing reachable while access is inactive.
- Migration verification confirms `subscriptions` is in `supabase_realtime` without duplicate-publication failure.

### `woven-harness`

- Decoding tests cover present, absent, true, and false `payment_required` values.
- Presentation tests select payment-recovery copy and portal action only for inactive payment-required accounts.
- Listener tests cover subscribe-before-refresh, matching event invalidation, duplicate auth callbacks, account changes, sign-out cleanup, and reconnect refresh.
- License routing tests confirm the refreshed inactive result displays the paywall and recovery restores the workspace.
- Request-admission tests confirm a failed preflight blocks new local and hosted operations.

### End To End

Use Stripe test mode with a Test Clock and a failing payment method:

1. Start a trial and sign into the desktop app.
2. Advance to trial end and fail the invoice payment.
3. Verify the mirror becomes `past_due`, balance returns inactive/payment-required, hosted APIs reject, and the open app displays the recovery paywall.
4. Open the portal, update the payment method, and pay the invoice.
5. Verify the mirror becomes `active` and the open app unlocks without relaunching.

## Rollout

Use a compatibility-first rollout because database, Edge Functions, website, and desktop cannot deploy atomically:

1. Deploy additive backend and web compatibility first: invoice synchronization, `payment_required`, duplicate-checkout rejection, account recovery UI, and Realtime publication. Keep the old access mapping temporarily.
2. Release the desktop build with the Realtime listener, portal recovery action, and fallback checks.
3. Verify production `WOVEN_ENFORCE_LICENSE=true` for Vercel and Supabase Edge Function environments and verify the Stripe endpoint includes the required invoice and subscription events.
4. Apply the final access-contract migration that removes `past_due` from `user_has_access`.
5. In the same migration, update `updated_at` on existing `past_due` and `unpaid` rows so already-open compatible apps receive an invalidation at cutover.
6. Run a live-mode-safe observation check on balance responses, webhook logs, and Realtime delivery; use Stripe test mode for the failure/recovery transaction itself.

After step 4, older desktop versions can still display stale local state, but protected hosted operations are denied by the backend. The new desktop version receives near-instant UI revocation and recovery.

## Documentation Source

Current Stripe and Supabase behavior used by this design is recorded in `docs/superpowers/research/2026-08-24-payment-failure-revocation-docs.md`.
