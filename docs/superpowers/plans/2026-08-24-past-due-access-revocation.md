# Past-Due Access Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revoke Woven access when Stripe reports a failed subscription payment, notify open desktop apps through Supabase Realtime, and restore access after payment recovery without creating duplicate subscriptions.

**Architecture:** Stripe remains authoritative and the mirrored `public.subscriptions` row is the event source. The backend enforces the combined entitlement on every hosted request, Supabase Realtime invalidates the desktop cache, and foreground or stale/disconnected request checks cover missed events. Deployment is intentionally split into additive backend compatibility, desktop release, and final database enforcement.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Supabase Postgres/RLS/Realtime, Supabase Edge Functions on Deno, Stripe Billing API `2026-04-22.dahlia`, Swift 6, SwiftUI, supabase-swift `2.55.1`, XCTest

**Docs digest:** `docs/superpowers/research/2026-08-24-payment-failure-revocation-docs.md`

## Global Constraints

- Subscription access statuses are exactly `trialing` and `active`; `past_due`, `unpaid`, terminal, and unknown statuses do not grant subscription access.
- Grandfathered and active legacy-license access remain unchanged.
- Realtime events invalidate local state; the desktop never derives entitlement directly from a row payload.
- Realtime is the normal path. Foreground and request-time checks are fallbacks, not continuous polling.
- The fallback entitlement verification interval is five minutes and is independent of the seven-day offline cache window.
- Payment recovery updates the existing Stripe subscription through `create-portal-session`; it never creates a second subscription.
- In-flight work is not canceled. Revocation applies before subsequent work is admitted.
- Production hosted enforcement must have `WOVEN_ENFORCE_LICENSE=true` in every hosted runtime before cutover.
- Do not create the final cutover migration until the compatibility backend and desktop release have shipped.

## File Structure

### `woven-video` compatibility release

- Create `supabase/functions/stripe-webhook/invoice-handlers.ts`: pure, dependency-injected invoice-to-subscription synchronization.
- Modify `supabase/functions/stripe-webhook/index.ts`: wire Stripe retrieval, mirror writes, and existing notifications.
- Create `supabase/migrations/20260824120000_enable_subscriptions_realtime.sql`: idempotently publish the subscriptions table.
- Create `supabase/tests/20260824_subscriptions_realtime.sql`: publication and read-own policy assertions.
- Create `lib/billing/payment-required.ts`: pure delinquent-status classifier.
- Modify `app/api/v1/billing/balance/route.ts`: additive `payment_required` response and checkout-mode input.
- Modify `lib/billing/subscription-eligibility.ts`: prevent acquisition checkout when payment recovery is required.
- Modify `supabase/functions/create-checkout-session/subscription.ts`: pure checkout-conflict classifier.
- Modify `supabase/functions/create-checkout-session/index.ts`: reject delinquent duplicate checkout.
- Create `components/account/subscription-presentation.ts`: deterministic row selection and presentation state.
- Modify `app/account/page.tsx` and `components/account/subscription-cta.tsx`: retain Manage billing for inactive delinquent accounts.

### `woven-harness` desktop release

- Modify `project.yml`: pin supabase-swift `2.55.1`.
- Modify `Sources/WovenHarness/WovenBackendClient.swift`: decode payment state and create portal sessions.
- Modify `Sources/WovenHarness/Models/AcquisitionPresentation.swift`: explicit acquisition versus payment-recovery action.
- Modify `Sources/WovenHarness/Views/LicensePaywallView.swift`: recovery-specific UI and portal launch.
- Create `Sources/WovenHarness/Stores/SubscriptionRealtimeConnection.swift`: protocol and production Supabase adapter.
- Create `Sources/WovenHarness/Stores/SubscriptionRealtimeListener.swift`: account-aware listener lifecycle and invalidation stream.
- Create `Sources/WovenHarness/Stores/EntitlementRequestAdmission.swift`: pure fallback refresh decision.
- Modify `Sources/WovenHarness/Stores/WovenAccountStore.swift`: listener ownership, refresh coalescing, portal URL, and authorization.
- Modify `Sources/WovenHarness/Views/ChatView.swift`, `Sources/WovenHarness/Sidecar/SidecarController.swift`, and `Sources/WovenHarness/ContentView.swift`: gate new work and prioritize revocation routing.

### `woven-video` enforcement release

- Create `supabase/migrations/20260824130000_restrict_subscription_access_statuses.sql`: final access contract and delinquent-row invalidation.
- Create `supabase/tests/20260824_past_due_access.sql`: complete access matrix and grants.
- Modify `lib/billing/offline-access-expiry.ts` and balance tests: remove transitional `past_due` handling.
- Modify `docs/billing-architecture.md`: canonical status, webhook, Realtime, and recovery contract.

---

## Phase 1: Additive Backend Compatibility

### Task 1: Synchronize invoice events into the subscription mirror

**Files:**
- Create: `supabase/functions/stripe-webhook/invoice-handlers.ts`
- Modify: `supabase/functions/stripe-webhook/index.ts:16-59,257-361`
- Create: `tests/billing/stripe-webhook-invoices.test.ts`

**Interfaces:**
- Consumes: Stripe `Invoice`, `Subscription`, and `event.created` values.
- Produces: `invoiceSubscriptionID(invoice: Stripe.Invoice) -> string | null` and `createInvoiceEventHandlers(dependencies) -> { paid, paymentFailed }`.

- [ ] **Step 1: Write failing invoice orchestration tests**

Create tests with dependency spies that assert this exact sequence:

```ts
expect(calls).toEqual([
  "retrieve:sub_failed",
  "record:sub_failed:past_due:1777000000",
  "notify_failed:in_failed",
]);
```

Cover a paid recovery (`active`), failed payment (`past_due`), zero-dollar paid subscription invoice (sync but no paid notification), non-subscription invoice (notification only), expanded subscription reference, and retrieval rejection (no notification).

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm exec vitest run tests/billing/stripe-webhook-invoices.test.ts`

Expected: FAIL because `invoice-handlers.ts` does not exist.

- [ ] **Step 3: Implement the pure handler module**

Use these public interfaces:

```ts
import type Stripe from "stripe";

export type InvoiceEventDependencies = {
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  recordSubscription: (
    subscription: Stripe.Subscription,
    eventCreated: number,
  ) => Promise<void>;
  notifyPaid: (invoice: Stripe.Invoice) => Promise<void>;
  notifyPaymentFailed: (invoice: Stripe.Invoice) => Promise<void>;
};

export function invoiceSubscriptionID(invoice: Stripe.Invoice): string | null {
  if (invoice.parent?.type !== "subscription_details") return null;
  const subscription = invoice.parent.subscription_details?.subscription;
  if (typeof subscription === "string") return subscription;
  return subscription?.id ?? null;
}

export function createInvoiceEventHandlers(deps: InvoiceEventDependencies) {
  async function synchronize(invoice: Stripe.Invoice, eventCreated: number) {
    const id = invoiceSubscriptionID(invoice);
    if (!id) return;
    const subscription = await deps.retrieveSubscription(id);
    await deps.recordSubscription(subscription, eventCreated);
  }

  return {
    paid: async (invoice: Stripe.Invoice, eventCreated: number) => {
      await synchronize(invoice, eventCreated);
      if ((invoice.amount_paid ?? 0) > 0) await deps.notifyPaid(invoice);
    },
    paymentFailed: async (invoice: Stripe.Invoice, eventCreated: number) => {
      await synchronize(invoice, eventCreated);
      await deps.notifyPaymentFailed(invoice);
    },
  };
}
```

- [ ] **Step 4: Wire the pure handlers into the Edge Function**

Rename the existing notification-only functions to `notifyInvoicePaid` and `notifyInvoicePaymentFailed`. In the request handler, create dependencies that call `stripe.subscriptions.retrieve(id)` and the existing `handleSubscriptionEvent(subscription, eventCreated)`. Pass `event.created` for both invoice event types.

The top-level behavior must remain:

```ts
} else if (event.type === "invoice.paid") {
  await invoiceHandlers.paid(event.data.object as Stripe.Invoice, event.created);
} else if (event.type === "invoice.payment_failed") {
  await invoiceHandlers.paymentFailed(
    event.data.object as Stripe.Invoice,
    event.created,
  );
}
```

- [ ] **Step 5: Run tests and Edge Function type-checking**

Run:

```bash
pnpm exec vitest run tests/billing/stripe-webhook-invoices.test.ts
deno check --config supabase/functions/deno.json supabase/functions/stripe-webhook/index.ts
```

Expected: both commands succeed; the retrieval-failure test proves the webhook rejects so Stripe retries.

- [ ] **Step 6: Commit the webhook unit**

```bash
git add supabase/functions/stripe-webhook/index.ts supabase/functions/stripe-webhook/invoice-handlers.ts tests/billing/stripe-webhook-invoices.test.ts
git commit -m "fix(billing): synchronize invoice subscription status"
```

### Task 2: Publish subscriptions to Realtime safely

**Files:**
- Create: `supabase/migrations/20260824120000_enable_subscriptions_realtime.sql`
- Create: `supabase/tests/20260824_subscriptions_realtime.sql`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `public.subscriptions` table and read-own RLS policy.
- Produces: one `supabase_realtime` publication entry for `public.subscriptions`.

- [ ] **Step 1: Write the failing pgTAP publication test**

Assert one publication row and the authenticated read-own policy:

```sql
begin;
select plan(2);

select is(
  (
    select count(*)::integer
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'subscriptions'
  ),
  1,
  'subscriptions is published exactly once'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriptions'
      and policyname = 'Users can read own subscriptions'
      and roles @> array['authenticated']::name[]
  ),
  'subscriptions retains authenticated read-own RLS'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the local database test and confirm failure**

Run:

```bash
supabase start
supabase db reset
supabase test db
```

Expected: publication assertion FAIL.

- [ ] **Step 3: Add the idempotent publication migration**

```sql
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'subscriptions'
  ) then
    alter publication supabase_realtime add table public.subscriptions;
  end if;
end
$$;
```

- [ ] **Step 4: Add the billing DB script**

Add to `package.json`:

```json
"test:billing-db": "supabase test db"
```

- [ ] **Step 5: Verify normal and repeated migration execution**

Run:

```bash
supabase db reset
pnpm run test:billing-db
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20260824120000_enable_subscriptions_realtime.sql
pnpm run test:billing-db
```

Expected: all commands succeed and the publication count remains one.

- [ ] **Step 6: Commit the publication unit**

```bash
git add package.json supabase/migrations/20260824120000_enable_subscriptions_realtime.sql supabase/tests/20260824_subscriptions_realtime.sql
git commit -m "feat(billing): publish subscription status changes"
```

### Task 3: Add the payment-recovery balance contract

**Files:**
- Create: `lib/billing/payment-required.ts`
- Modify: `lib/billing/subscription-eligibility.ts`
- Modify: `app/api/v1/billing/balance/route.ts`
- Modify: `tests/billing/subscription-eligibility.test.ts`
- Modify: `tests/billing/balance-route-source.test.ts`

**Interfaces:**
- Consumes: combined `has_access()` result and mirrored subscription statuses.
- Produces: optional response field `payment_required`; checkout mode `none` during payment recovery.

- [ ] **Step 1: Write failing pure decision tests**

Test this matrix:

```ts
expect(resolvePaymentRequired(false, ["past_due"])).toBe(true);
expect(resolvePaymentRequired(false, ["unpaid"])).toBe(true);
expect(resolvePaymentRequired(false, ["canceled"])).toBe(false);
expect(resolvePaymentRequired(true, ["past_due"])).toBe(false);
expect(resolveCheckoutMode({ hasAccess: false, trialUsed: true, paymentRequired: true })).toBe("none");
```

- [ ] **Step 2: Run decision tests and confirm failure**

Run: `pnpm exec vitest run tests/billing/subscription-eligibility.test.ts`

Expected: FAIL because the new argument and helper do not exist.

- [ ] **Step 3: Implement the pure classifier and checkout precedence**

```ts
const PAYMENT_REQUIRED_STATUSES = new Set(["past_due", "unpaid"]);

export function resolvePaymentRequired(
  hasAccess: boolean,
  statuses: readonly string[],
): boolean {
  return !hasAccess && statuses.some((status) => PAYMENT_REQUIRED_STATUSES.has(status));
}
```

Extend `resolveCheckoutMode` with `paymentRequired?: boolean` and evaluate it before trial history:

```ts
if (hasAccess || paymentRequired) return "none";
```

- [ ] **Step 4: Write failing route tests**

Add route scenarios for inactive `past_due`, inactive `unpaid`, ordinary inactive, active recovery, and a grandfathered account with a delinquent row. Assert:

```ts
expect(body.license).toEqual({ active: false, granted_at: null });
expect(body.payment_required).toBe(true);
expect(body.checkout_mode).toBe("none");
```

On subscription-query failure, assert `payment_required` is omitted rather than fabricated.

- [ ] **Step 5: Refactor the route to load statuses and serialize the additive field**

After `has_access()` succeeds, load relevant subscription rows once. Compute payment recovery only when the query succeeds. Continue passing `trialing`, `active`, and transitional `past_due` rows to offline-source resolution until Task 10; this prevents the compatibility release from omitting an active license while the old SQL function still grants `past_due`.

The response construction must include:

```ts
...(paymentRequired === undefined
  ? {}
  : { payment_required: paymentRequired }),
```

Pass `paymentRequired` to `resolveCheckoutMode`.

- [ ] **Step 6: Run focused billing tests**

Run:

```bash
pnpm exec vitest run tests/billing/balance-route-source.test.ts tests/billing/subscription-eligibility.test.ts tests/billing/offline-access-expiry.test.ts
```

Expected: PASS, including the temporary existing `past_due` offline-source test.

- [ ] **Step 7: Commit the additive API contract**

```bash
git add app/api/v1/billing/balance/route.ts lib/billing/payment-required.ts lib/billing/subscription-eligibility.ts tests/billing/balance-route-source.test.ts tests/billing/subscription-eligibility.test.ts
git commit -m "feat(billing): expose payment recovery state"
```

### Task 4: Reject duplicate checkout for delinquent subscriptions

**Files:**
- Modify: `supabase/functions/create-checkout-session/subscription.ts`
- Modify: `supabase/functions/create-checkout-session/index.ts:152-284`
- Modify: `tests/billing/subscription-checkout.test.ts`
- Modify: `tests/billing/create-checkout-session-source.test.ts`

**Interfaces:**
- Consumes: subscription status strings for the authenticated user.
- Produces: HTTP 409 error code `subscription_payment_required` before any Stripe Checkout creation.

- [ ] **Step 1: Write failing classifier tests**

```ts
expect(hasPaymentRequiredSubscription(["past_due"])).toBe(true);
expect(hasPaymentRequiredSubscription(["unpaid"])).toBe(true);
expect(hasPaymentRequiredSubscription(["active"])).toBe(false);
expect(hasPaymentRequiredSubscription(["canceled", "paused"])).toBe(false);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm exec vitest run tests/billing/subscription-checkout.test.ts tests/billing/create-checkout-session-source.test.ts`

Expected: FAIL because the classifier and status query are absent.

- [ ] **Step 3: Add the pure classifier**

```ts
export function hasPaymentRequiredSubscription(statuses: readonly string[]) {
  return statuses.some((status) => status === "past_due" || status === "unpaid");
}
```

- [ ] **Step 4: Query delinquent rows before access and trial checks**

In the subscription checkout branch, query `subscriptions.status` for `user_id = user.id` and `.in("status", ["past_due", "unpaid"])`. Fail with a 500 error if the query fails. If the classifier is true, throw:

```ts
throw new HttpError(409, "subscription_payment_required");
```

This block must execute before `user_has_access`, `user_trial_used`, reservation creation, and every `stripe.checkout.sessions.create` call.

- [ ] **Step 5: Pin source ordering and response behavior**

Extend the source test to compare string offsets and require:

```ts
expect(delinquentQueryIndex).toBeLessThan(hasAccessIndex);
expect(conflictIndex).toBeLessThan(firstStripeCreateIndex);
expect(source).toContain('new HttpError(409, "subscription_payment_required")');
```

- [ ] **Step 6: Run tests and Deno check**

Run:

```bash
pnpm exec vitest run tests/billing/subscription-checkout.test.ts tests/billing/create-checkout-session-source.test.ts
deno check --config supabase/functions/deno.json supabase/functions/create-checkout-session/index.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the checkout guard**

```bash
git add supabase/functions/create-checkout-session/index.ts supabase/functions/create-checkout-session/subscription.ts tests/billing/subscription-checkout.test.ts tests/billing/create-checkout-session-source.test.ts
git commit -m "fix(billing): prevent duplicate delinquent checkout"
```

### Task 5: Keep payment recovery reachable on the web account

**Files:**
- Create: `components/account/subscription-presentation.ts`
- Modify: `components/account/subscription-cta.tsx`
- Modify: `app/account/page.tsx:256-317`
- Create: `tests/billing/account-subscription-presentation.test.ts`
- Modify: `tests/billing/account-page-source.test.ts`

**Interfaces:**
- Consumes: all relevant subscription rows and combined access result.
- Produces: selected account subscription and presentation kind `payment_required | managed | grandfathered | acquisition`.

- [ ] **Step 1: Write failing pure presentation tests**

Cover `past_due` and `unpaid` with `hasAccess=false`, active subscription, grandfathered access, acquisition, and active-plus-past-due rows. Require delinquent selection and `payment_required` presentation.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm exec vitest run tests/billing/account-subscription-presentation.test.ts tests/billing/account-page-source.test.ts`

Expected: FAIL because the pure module does not exist and `unpaid` is not queried.

- [ ] **Step 3: Implement deterministic selection and presentation**

```ts
export function isPaymentRequiredSubscriptionStatus(status: string) {
  return status === "past_due" || status === "unpaid";
}

export function selectAccountSubscription<T extends { status: string }>(rows: T[]): T | null {
  return rows.find((row) => isPaymentRequiredSubscriptionStatus(row.status))
    ?? rows.find((row) => row.status === "trialing" || row.status === "active")
    ?? null;
}

export function resolveSubscriptionPresentation(input: {
  hasAccess: boolean;
  subscription: { status: string } | null;
}) {
  if (input.subscription && isPaymentRequiredSubscriptionStatus(input.subscription.status)) {
    return "payment_required" as const;
  }
  if (input.subscription) return "managed" as const;
  return input.hasAccess ? "grandfathered" as const : "acquisition" as const;
}
```

- [ ] **Step 4: Load all relevant rows and select deliberately**

Change the account query to include `trialing`, `active`, `past_due`, and `unpaid`, remove `.limit(1)` from the mixed-status query, and pass the rows through `selectAccountSubscription`.

- [ ] **Step 5: Render the recovery card independently of access**

In `SubscriptionCta`, evaluate the pure presentation kind first. For `payment_required`, show **Payment needs attention**, explain that the card could not be charged and access returns after payment, and render only the existing `createPortalSession` / `ManageBillingButton` form. Do not render `StartTrialButton` or subscription Checkout in this branch.

- [ ] **Step 6: Run focused and full web checks**

Run:

```bash
pnpm exec vitest run tests/billing/account-subscription-presentation.test.ts tests/billing/account-page-source.test.ts
pnpm test
pnpm lint
pnpm build
```

Expected: all commands succeed.

- [ ] **Step 7: Commit the account recovery unit**

```bash
git add app/account/page.tsx components/account/subscription-cta.tsx components/account/subscription-presentation.ts tests/billing/account-page-source.test.ts tests/billing/account-subscription-presentation.test.ts
git commit -m "fix(account): keep failed payment recovery available"
```

### Task 6: Deploy and verify the compatibility backend

**Files:**
- Verify only; no new source file.

**Interfaces:**
- Produces: production support for `payment_required`, invoice synchronization, Realtime publication, duplicate-checkout rejection, and web recovery while `past_due` still temporarily grants access.

- [ ] **Step 1: Run the complete compatibility verification**

Run from `woven-video`:

```bash
pnpm test
pnpm run test:billing-db
deno check --config supabase/functions/deno.json supabase/functions/stripe-webhook/index.ts supabase/functions/create-checkout-session/index.ts supabase/functions/create-portal-session/index.ts
pnpm lint
pnpm build
```

Expected: all commands succeed.

- [ ] **Step 2: Release only compatibility changes**

Use the `release-woven-web` workflow. Confirm `20260824130000_restrict_subscription_access_statuses.sql` does not exist yet, then deploy the Realtime migration, Edge Functions, and Next.js app.

- [ ] **Step 3: Smoke-test additive production behavior**

Verify:

- `/api/v1/billing/balance` remains backward compatible when `payment_required` is absent or false.
- A test-mode failed invoice updates the subscription mirror.
- The account page shows Manage billing for a delinquent test account.
- A Realtime client authenticated as that account receives only its own subscription update.
- Existing `past_due` production behavior still grants access until Phase 3.

---

## Phase 2: Desktop Realtime And Recovery

### Task 7: Add payment-recovery networking and presentation

**Files:**
- Modify: `/Users/naman/projects/woven-harness/Sources/WovenHarness/WovenBackendClient.swift`
- Modify: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Models/AcquisitionPresentation.swift`
- Modify: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Stores/WovenAccountStore.swift`
- Modify: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Views/LicensePaywallView.swift`
- Modify: `/Users/naman/projects/woven-harness/Tests/WovenHarnessTests/BalanceDecodingTests.swift`
- Modify: `/Users/naman/projects/woven-harness/Tests/WovenHarnessTests/AcquisitionPresentationTests.swift`
- Create: `/Users/naman/projects/woven-harness/Tests/WovenHarnessTests/WovenBackendClientTests.swift`

**Interfaces:**
- Consumes: balance `payment_required` and authenticated `create-portal-session` Edge Function.
- Produces: `WovenBalance.paymentRequired`, `BillingPortalSession`, `AcquisitionPresentation.forAccount(checkoutMode:paymentRequired:licenseDecision:)`, explicit `PrimaryAction`, and `WovenAccountStore.createBillingPortalURL()`.

- [ ] **Step 1: Write failing decoding and portal request tests**

Decode `payment_required` as true, false, and absent. Inject a request loader and assert portal request method, URL, `apikey`, bearer authorization, successful URL decoding, malformed success response, and non-2xx error.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
xcodebuild -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' test -only-testing:WovenHarnessTests/BalanceDecodingTests -only-testing:WovenHarnessTests/WovenBackendClientTests
```

Expected: FAIL because the field, injected loader, and portal method do not exist.

- [ ] **Step 3: Extend the network contract**

Add:

```swift
let paymentRequired: Bool?
case paymentRequired = "payment_required"

struct BillingPortalSession: Decodable, Equatable {
    let url: URL
}
```

Give `WovenBackendClient` an injected loader with a production default:

```swift
typealias DataLoader = @Sendable (URLRequest) async throws -> (Data, URLResponse)

init(
    baseURL: URL,
    dataLoader: @escaping DataLoader = { try await URLSession.shared.data(for: $0) }
) {
    self.baseURL = baseURL
    self.dataLoader = dataLoader
}
```

Add `createBillingPortalSession` using `POST <supabaseURL>/functions/v1/create-portal-session` with `apikey`, bearer token, and JSON content type.

- [ ] **Step 4: Write failing recovery-presentation tests**

Require explicit values:

```swift
XCTAssertEqual(presentation.kind, .paymentRecovery)
XCTAssertEqual(presentation.primaryAction, .updatePaymentMethod)
XCTAssertEqual(presentation.paywallHeadline, "Payment needs attention")
XCTAssertNil(presentation.paywallDetail)
XCTAssertTrue(presentation.paywallBenefits.isEmpty)
```

- [ ] **Step 5: Add explicit presentation kind and action**

Add nested enums:

```swift
enum Kind: Equatable { case acquisition, paymentRecovery, unavailable }
enum PrimaryAction: Equatable { case checkout, updatePaymentMethod }
```

Add this selector while keeping `forCheckoutMode` for existing isolated copy tests:

```swift
static func forAccount(
    checkoutMode: WovenCheckoutMode?,
    paymentRequired: Bool?,
    licenseDecision: LicenseDecision
) -> AcquisitionPresentation
```

Select recovery only when `paymentRequired == true` and `licenseDecision` is definitively unlicensed. Keep existing trial/subscription/no-checkout copy unchanged for other states.

- [ ] **Step 6: Route the paywall action correctly**

In recovery mode, omit the hard-coded price and benefit card. Render **Update payment method**, call `wovenAccount.createBillingPortalURL()`, and open the returned Stripe URL. On error, open `wovenAccount.licensePurchaseURL`. Keep Refresh, Contact us, and Sign out.

- [ ] **Step 7: Run focused UI/model tests**

Run:

```bash
xcodebuild -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' test -only-testing:WovenHarnessTests/BalanceDecodingTests -only-testing:WovenHarnessTests/WovenBackendClientTests -only-testing:WovenHarnessTests/AcquisitionPresentationTests
```

Expected: PASS.

- [ ] **Step 8: Commit the recovery UI unit**

```bash
git add Sources/WovenHarness/WovenBackendClient.swift Sources/WovenHarness/Models/AcquisitionPresentation.swift Sources/WovenHarness/Stores/WovenAccountStore.swift Sources/WovenHarness/Views/LicensePaywallView.swift Tests/WovenHarnessTests/BalanceDecodingTests.swift Tests/WovenHarnessTests/WovenBackendClientTests.swift Tests/WovenHarnessTests/AcquisitionPresentationTests.swift
git commit -m "feat(billing): add failed payment recovery paywall"
```

### Task 8: Build a testable Supabase Realtime listener

**Files:**
- Modify: `/Users/naman/projects/woven-harness/project.yml`
- Create: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Stores/SubscriptionRealtimeConnection.swift`
- Create: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Stores/SubscriptionRealtimeListener.swift`
- Create: `/Users/naman/projects/woven-harness/Tests/WovenHarnessTests/SubscriptionRealtimeListenerTests.swift`

**Interfaces:**
- Consumes: authenticated user UUID and `SupabaseClient`.
- Produces: account-aware invalidation and health callbacks without exposing Supabase types to store tests.

- [ ] **Step 1: Pin and resolve supabase-swift**

Change `project.yml` to:

```yaml
Supabase:
  url: https://github.com/supabase/supabase-swift.git
  exactVersion: "2.55.1"
```

Run:

```bash
xcodegen generate
xcodebuild -resolvePackageDependencies -project WovenHarness.xcodeproj -scheme WovenHarness
```

Expected: dependency resolution reports `supabase-swift @ 2.55.1`.

- [ ] **Step 2: Write failing listener lifecycle tests**

Use a fake `SubscriptionRealtimeConnection` and cover initial subscribe-before-callback, invalidation, `.subscribed` reconnect, duplicate same-user setup, account switch cleanup, sign-out cleanup, subscribe failure, and stale old-connection events after an account switch.

- [ ] **Step 3: Define the connection boundary**

```swift
enum SubscriptionRealtimeHealth: Equatable, Sendable {
    case stopped, connecting, subscribed, disconnected
}

enum SubscriptionRealtimeEvent: Equatable, Sendable {
    case invalidated
    case healthChanged(SubscriptionRealtimeHealth)
}

@MainActor
protocol SubscriptionRealtimeConnection: AnyObject {
    var events: AsyncStream<SubscriptionRealtimeEvent> { get }
    func subscribe() async throws
    func remove() async
}

typealias SubscriptionRealtimeConnectionFactory =
    @MainActor @Sendable (UUID) -> any SubscriptionRealtimeConnection
```

- [ ] **Step 4: Implement the production Supabase adapter**

Create the channel with a unique user-scoped name. Register both streams before subscribe:

```swift
let changes = channel.postgresChange(
    AnyAction.self,
    schema: "public",
    table: "subscriptions",
    filter: .eq("user_id", value: userID.uuidString)
)
let statuses = channel.statusChange
try await channel.subscribeWithError()
```

Map insert/update/delete to `.invalidated`, map channel states to the local health enum, and remove through `await supabase.removeChannel(channel)`.

- [ ] **Step 5: Implement the account-aware listener coordinator**

Expose:

```swift
func setUserID(_ userID: UUID?) async
func stop() async
```

Use a generation UUID per connection. Ignore events whose generation is no longer current. Emit refresh callbacks after first `.subscribed`, every `.invalidated`, and every transition from disconnected back to `.subscribed`. Repeated setup for the same user must not create another channel.

- [ ] **Step 6: Run focused listener tests**

Run:

```bash
xcodebuild -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' test -only-testing:WovenHarnessTests/SubscriptionRealtimeListenerTests
```

Expected: PASS.

- [ ] **Step 7: Commit the listener unit**

```bash
git add project.yml WovenHarness.xcodeproj Sources/WovenHarness/Stores/SubscriptionRealtimeConnection.swift Sources/WovenHarness/Stores/SubscriptionRealtimeListener.swift Tests/WovenHarnessTests/SubscriptionRealtimeListenerTests.swift
git commit -m "feat(billing): listen for subscription status changes"
```

### Task 9: Integrate invalidation and coalesced balance refresh

**Files:**
- Modify: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Stores/WovenAccountStore.swift`
- Create: `/Users/naman/projects/woven-harness/Tests/WovenHarnessTests/WovenAccountRealtimeTests.swift`

**Interfaces:**
- Consumes: `SubscriptionRealtimeListener` refresh/health callbacks.
- Produces: subscribe-before-refresh session flow, coalesced invalidation refresh, current health, and last successful verification timestamp.

- [ ] **Step 1: Write failing account-store orchestration tests**

Inject a listener factory and balance fetcher. Assert:

- Sign-in starts the listener before initial balance fetch.
- Repeated auth callback for the same UUID does not duplicate the listener.
- Account switch stops the old listener before starting the new one.
- Sign-out and 401 stop the listener and clear the user UUID.
- An invalidation during a balance fetch queues one follow-up fetch instead of being dropped.
- Only a response with a non-nil license advances `lastSuccessfulLicenseVerificationAt`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
xcodebuild -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' test -only-testing:WovenHarnessTests/WovenAccountRealtimeTests
```

Expected: FAIL because the store has no listener injection or refresh queue.

- [ ] **Step 3: Add store state and injection seams**

Add:

```swift
private(set) var authenticatedUserID: UUID?
private(set) var realtimeHealth: SubscriptionRealtimeHealth = .stopped
private(set) var lastSuccessfulLicenseVerificationAt: Date?
private var refreshRequestedWhileRunning = false
private var realtimeListener: SubscriptionRealtimeListener?
```

Extend the initializer with optional internal factories used by tests while preserving production defaults.

- [ ] **Step 4: Replace dropped refreshes with a coalescing loop**

When `refreshBalance()` is called during a fetch, set `refreshRequestedWhileRunning = true`. The owner of the active refresh repeats `fetchBalanceWithFreshToken()` until no refresh was requested during the prior request. Return only after the queued invalidation has been observed. Preserve the last-good cache on error.

- [ ] **Step 5: Reconcile listener lifecycle with auth lifecycle**

On a new session UUID, stop the old listener, store the UUID, start the new listener, then refresh. On same-user token refresh, update the token without replacing the listener. On nil session, sign-out, or 401, stop before clearing account state.

- [ ] **Step 6: Run focused account-store tests**

Run:

```bash
xcodebuild -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' test -only-testing:WovenHarnessTests/WovenAccountRealtimeTests -only-testing:WovenHarnessTests/LicenseGateTests
```

Expected: PASS.

- [ ] **Step 7: Commit the store integration**

```bash
git add Sources/WovenHarness/Stores/WovenAccountStore.swift Tests/WovenHarnessTests/WovenAccountRealtimeTests.swift
git commit -m "feat(billing): refresh entitlement from realtime"
```

### Task 10: Gate new local work when fallback verification is needed

**Files:**
- Create: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Stores/EntitlementRequestAdmission.swift`
- Modify: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Stores/WovenAccountStore.swift`
- Modify: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Views/ChatView.swift:2379-2390,2603-2659`
- Modify: `/Users/naman/projects/woven-harness/Sources/WovenHarness/Sidecar/SidecarController.swift:149-183,553-610,919-925`
- Modify: `/Users/naman/projects/woven-harness/Sources/WovenHarness/ContentView.swift:49-67`
- Create: `/Users/naman/projects/woven-harness/Tests/WovenHarnessTests/EntitlementRequestAdmissionTests.swift`
- Create: `/Users/naman/projects/woven-harness/Tests/WovenHarnessTests/SidecarControllerAdmissionTests.swift`
- Create: `/Users/naman/projects/woven-harness/Tests/WovenHarnessTests/AccountAccessRoutingTests.swift`

**Interfaces:**
- Consumes: Realtime health, last verification date, current license decision, and access mode.
- Produces: `authorizeNewOperation(clientEnforced:)` plus a synchronous defense-in-depth sidecar guard.

- [ ] **Step 1: Write failing pure fallback tests**

Use an injected `now` and `staleAfter = 300`. Assert healthy/fresh skips refresh, healthy/stale refreshes, disconnected always refreshes, stopped refreshes, and `.licensed` is the only allowed resolved decision for configured signed-in new work.

- [ ] **Step 2: Implement the pure helper**

```swift
enum EntitlementRequestAdmission {
    static let staleAfter: TimeInterval = 5 * 60

    static func shouldRefresh(
        realtimeHealth: SubscriptionRealtimeHealth,
        lastVerifiedAt: Date?,
        now: Date,
        staleAfter: TimeInterval = staleAfter
    ) -> Bool {
        guard realtimeHealth == .subscribed,
              let lastVerifiedAt,
              now.timeIntervalSince(lastVerifiedAt) < staleAfter
        else { return true }
        return false
    }

    static func allows(_ decision: LicenseDecision) -> Bool {
        decision == .licensed
    }
}
```

- [ ] **Step 3: Add the async store authorization method**

`authorizeNewOperation(clientEnforced:)` must:

- Allow unconfigured builds.
- Deny configured signed-out accounts.
- Skip an extra balance request for hosted work but deny immediately if local state is already inactive.
- For local/BYOK/Codex work, refresh only when Realtime is unhealthy or the five-minute verification is stale, then require `.licensed`.
- Preserve the existing bounded offline-cache behavior if refresh fails.

- [ ] **Step 4: Preflight Chat and Codex compaction before mutation**

In `prepareModelRequest`, call the authorization method before provider-specific work. In `requestCodexCompaction`, authorize before setting pending UI or calling Sidecar.

- [ ] **Step 5: Add the synchronous Sidecar defense**

Inject:

```swift
canAdmitNewWork: @MainActor @Sendable () -> Bool = { true }
```

Guard `sendUserMessage` before `session.submitUserMessage` and guard `compactCodexThread` before `ensureConfigured`. Denial must produce no transcript mutation and no outbound message.

- [ ] **Step 6: Make the license route supersede Settings**

Change top-level routing order to loading, sign-in, license, Settings, onboarding, workspace. When `requiresLicense` changes to true, clear `isSettingsPresented`. This prevents an already-open Settings screen from hiding revocation.

- [ ] **Step 7: Run focused admission and routing tests**

Run:

```bash
xcodebuild -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' test -only-testing:WovenHarnessTests/EntitlementRequestAdmissionTests -only-testing:WovenHarnessTests/SidecarControllerAdmissionTests -only-testing:WovenHarnessTests/AccountAccessRoutingTests
```

Expected: PASS.

- [ ] **Step 8: Commit admission enforcement**

```bash
git add Sources/WovenHarness/Stores/EntitlementRequestAdmission.swift Sources/WovenHarness/Stores/WovenAccountStore.swift Sources/WovenHarness/Views/ChatView.swift Sources/WovenHarness/Sidecar/SidecarController.swift Sources/WovenHarness/ContentView.swift Tests/WovenHarnessTests/EntitlementRequestAdmissionTests.swift Tests/WovenHarnessTests/SidecarControllerAdmissionTests.swift Tests/WovenHarnessTests/AccountAccessRoutingTests.swift
git commit -m "fix(billing): gate new work after entitlement loss"
```

### Task 11: Verify and release the desktop compatibility build

**Files:**
- Verify only; release workflow updates version artifacts separately.

**Interfaces:**
- Produces: a shipped app that supports Realtime invalidation and failed-payment recovery before backend cutover.

- [ ] **Step 1: Generate and resolve the project**

Run:

```bash
xcodegen generate
xcodebuild -resolvePackageDependencies -project WovenHarness.xcodeproj -scheme WovenHarness
```

Expected: project generation succeeds and Supabase resolves to `2.55.1`.

- [ ] **Step 2: Run the full desktop suite**

Run:

```bash
xcodebuild -project WovenHarness.xcodeproj -scheme WovenHarness -configuration Debug -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO test
```

Expected: all tests pass.

- [ ] **Step 3: Run a test-mode Realtime recovery smoke**

With the compatibility backend deployed, update a test account's mirrored subscription between `active` and `past_due`. Confirm the open app refreshes but remains licensed and receives `payment_required=false` while the old access mapping is intentionally still active. Validate the true recovery presentation with the inactive mocked balance test from Task 7, and separately confirm the portal action can create a Stripe portal URL for the test account.

- [ ] **Step 4: Release the desktop build**

Use the `release-woven` workflow. Verify the signed/notarized build contains supabase-swift `2.55.1`, then publish the update before beginning Phase 3.

---

## Phase 3: Authoritative Access Cutover

### Task 12: Revoke delinquent access in Postgres

**Files:**
- Create: `supabase/migrations/20260824130000_restrict_subscription_access_statuses.sql`
- Create: `supabase/tests/20260824_past_due_access.sql`
- Modify: `lib/billing/offline-access-expiry.ts`
- Modify: `app/api/v1/billing/balance/route.ts`
- Modify: `tests/billing/offline-access-expiry.test.ts`
- Modify: `tests/billing/balance-route-source.test.ts`

**Interfaces:**
- Consumes: shipped compatibility backend and desktop.
- Produces: final `trialing | active` subscription access contract and one Realtime invalidation for existing delinquent rows.

- [ ] **Step 1: Write the failing SQL access matrix**

Use pgTAP fixtures to prove:

- `trialing` and `active` grant access.
- `past_due`, `unpaid`, canceled, incomplete, incomplete_expired, paused, and unknown status do not.
- Active plus past-due grants access.
- Grandfathered plus past-due grants access.
- Active legacy license plus past-due grants access.
- Every subscription status still makes `user_trial_used` true.
- `user_has_access` remains stable, security-definer, and executable only by authenticated/service-role callers.

- [ ] **Step 2: Run the SQL test and confirm failure**

Run:

```bash
supabase db reset
pnpm run test:billing-db
```

Expected: `past_due` access assertion FAIL under the historical function.

- [ ] **Step 3: Add the final access migration**

Replace only `user_has_access`:

```sql
create or replace function public.user_has_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.user_has_active_license(p_user_id)
    or exists (
      select 1
      from public.subscriptions
      where user_id = p_user_id
        and status in ('trialing', 'active')
    );
$$;

revoke all on function public.user_has_access(uuid) from public, anon;
grant execute on function public.user_has_access(uuid) to authenticated, service_role;

update public.subscriptions
set updated_at = now()
where status in ('past_due', 'unpaid');
```

The update emits a Realtime invalidation for accounts already delinquent when the function changes.

- [ ] **Step 4: Remove transitional offline handling**

Change `LiveSubscriptionAccess.status` to `"trialing" | "active"`, make only `active` unlimited, and query only `trialing`/`active` rows as access sources. Continue querying `past_due`/`unpaid` separately for `payment_required`.

- [ ] **Step 5: Update route and resolver tests**

Replace the old `past_due` unlimited test with an unrecognized/non-access source assertion. Require inactive `past_due` to serialize `license.active=false`, `payment_required=true`, and `checkout_mode="none"`.

- [ ] **Step 6: Run focused and full backend verification**

Run:

```bash
supabase db reset
pnpm run test:billing-db
pnpm exec vitest run tests/billing/balance-route-source.test.ts tests/billing/offline-access-expiry.test.ts tests/billing/subscription-eligibility.test.ts
pnpm test
pnpm lint
pnpm build
```

Expected: all commands succeed.

- [ ] **Step 7: Commit the cutover separately**

```bash
git add supabase/migrations/20260824130000_restrict_subscription_access_statuses.sql supabase/tests/20260824_past_due_access.sql app/api/v1/billing/balance/route.ts lib/billing/offline-access-expiry.ts tests/billing/balance-route-source.test.ts tests/billing/offline-access-expiry.test.ts
git commit -m "fix(billing): revoke access after payment failure"
```

### Task 13: Document, deploy, and verify the final behavior

**Files:**
- Modify: `docs/billing-architecture.md:43-90`

**Interfaces:**
- Produces: canonical documentation and verified production cutover.

- [ ] **Step 1: Update canonical billing documentation**

Document the subscription mirror, exact access statuses, invoice synchronization, Realtime invalidation, `payment_required`, portal recovery, duplicate-checkout rejection, and the fact that Realtime is acceleration while server authorization is authoritative.

- [ ] **Step 2: Verify production configuration before migration**

Confirm all of the following:

- Vercel production has `WOVEN_ENFORCE_LICENSE=true`.
- Supabase hosted Edge Function environments that admit licensed work have `WOVEN_ENFORCE_LICENSE=true`.
- Stripe's webhook endpoint includes `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, and `invoice.paid`.
- The compatible desktop version is published and offered through Sparkle.

Do not apply the migration if any check fails.

- [ ] **Step 3: Commit the canonical documentation**

```bash
git add docs/billing-architecture.md
git commit -m "docs(billing): document payment failure revocation"
```

- [ ] **Step 4: Release the enforcement change**

Use `release-woven-web`. Review the migration list immediately before `supabase db push`; it must include the final access migration and no unrelated pending migration.

- [ ] **Step 5: Run the Stripe Test Clock end-to-end scenario**

1. Start a three-day trial for a test account and open the desktop app.
2. Advance the Test Clock to trial end with a failing payment method.
3. Verify Stripe reports `past_due` and Supabase mirrors it.
4. Verify `/api/v1/billing/balance` returns `license.active=false`, `payment_required=true`, and `checkout_mode="none"`.
5. Verify the already-open app displays **Payment needs attention** without relaunching.
6. Verify a hosted request is rejected and a new local/BYOK/Codex turn is not admitted.
7. Open **Update payment method**, replace the method, and pay the invoice.
8. Verify Stripe and Supabase return to `active` and the open app unlocks.

- [ ] **Step 6: Observe production safety signals**

For the first release window, monitor Stripe webhook failures, Supabase Edge Function logs, balance-route errors, duplicate-checkout conflicts, Realtime connection failures, and support reports. A Realtime outage must degrade to foreground/stale verification; it must not bypass hosted server authorization.

## Completion Criteria

- Failed first post-trial and renewal payments revoke combined subscription access at `past_due`.
- An open compatible desktop app reaches the recovery paywall through Realtime without polling.
- A missed Realtime event is covered by foreground or stale/disconnected request verification.
- Hosted requests are denied by the server after revocation.
- Local/BYOK/Codex new work is denied after the client verifies revocation.
- Payment recovery uses the existing subscription's Stripe portal and cannot create a duplicate subscription.
- Successful recovery restores access in the open app.
- Grandfathered and active legacy-license users retain access.
- Full backend, database, Edge Function, desktop, and end-to-end tests pass.
