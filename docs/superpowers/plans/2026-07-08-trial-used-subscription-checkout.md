# Trial-Used Subscription Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Woven's backend and web account surface stop offering a second free trial after an account has ever started a subscription trial.

**Architecture:** `trial_used` is derived server-side from historical `subscriptions` rows and remains separate from `has_access`. Checkout creation branches to either a 7-day trial subscription Checkout or an immediate paid annual subscription Checkout. Web/account and future desktop consumers read `checkout_mode` instead of guessing from local state.

**Tech Stack:** Supabase Postgres migrations/RPCs, Supabase Edge Functions on Deno, Stripe Checkout Sessions, Next.js 16 App Router Server Actions, Vitest, `pnpm`.

**Docs digest:** `docs/superpowers/research/2026-07-08-trial-used-subscription-docs.md`

## Global Constraints

- Account-level rule: `trial_used = true` once the account has ever had a Woven subscription/trial row.
- Do not change `has_access` semantics.
- `license.active` continues to control access; new fields only control copy and Checkout intent.
- `CheckoutMode = "trial" | "subscription" | "none"`.
- Checkout must fail closed if trial eligibility cannot be read; do not create a trial Checkout under uncertainty.
- Immediate paid subscription Checkout omits `subscription_data.trial_period_days` and `subscription_data.trial_settings`.
- Keep existing `createTrialCheckoutSession` action name for this pass.
- Keep `origin: "app" | "web"` redirect allowlisting; never accept arbitrary redirect URLs.
- This plan implements `woven-video` backend + web. `woven-harness` decode/copy work is a follow-up consumer plan after this backend contract exists.

---

### Task 1: Shared Checkout-Mode Helper

**Files:**
- Create: `lib/billing/subscription-eligibility.ts`
- Create: `tests/billing/subscription-eligibility.test.ts`

**Interfaces:**
- Produces: `type CheckoutMode = "trial" | "subscription" | "none"`
- Produces: `resolveCheckoutMode(input: { hasAccess: boolean; trialUsed: boolean | null | undefined }): CheckoutMode | undefined`
- Consumed by subsequent tasks: API route and account page use this helper to avoid duplicated policy.

- [ ] **Step 1: Write the failing test**

Create `tests/billing/subscription-eligibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolveCheckoutMode } from "@/lib/billing/subscription-eligibility";

describe("resolveCheckoutMode", () => {
  it("returns none when the account already has access", () => {
    expect(resolveCheckoutMode({ hasAccess: true, trialUsed: false })).toBe("none");
    expect(resolveCheckoutMode({ hasAccess: true, trialUsed: true })).toBe("none");
    expect(resolveCheckoutMode({ hasAccess: true, trialUsed: undefined })).toBe("none");
  });

  it("returns trial when the account lacks access and has never used a trial", () => {
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: false })).toBe("trial");
  });

  it("returns subscription when the account lacks access and has used a trial", () => {
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: true })).toBe("subscription");
  });

  it("returns undefined when a no-access account has unknown trial eligibility", () => {
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: undefined })).toBeUndefined();
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: null })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- tests/billing/subscription-eligibility.test.ts
```

Expected: FAIL with a module resolution error for `@/lib/billing/subscription-eligibility`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/billing/subscription-eligibility.ts`:

```ts
export type CheckoutMode = "trial" | "subscription" | "none";

export function resolveCheckoutMode({
  hasAccess,
  trialUsed,
}: {
  hasAccess: boolean;
  trialUsed: boolean | null | undefined;
}): CheckoutMode | undefined {
  if (hasAccess) {
    return "none";
  }

  if (trialUsed === true) {
    return "subscription";
  }

  if (trialUsed === false) {
    return "trial";
  }

  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm test -- tests/billing/subscription-eligibility.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/subscription-eligibility.ts tests/billing/subscription-eligibility.test.ts
git commit -m "feat(billing): add checkout mode resolver"
```

---

### Task 2: Trial-Used SQL RPC

**Files:**
- Create: `supabase/migrations/20260708120000_trial_used_subscription_checkout.sql`
- Modify: `tests/media/db-rpcs.integration.test.ts`

**Interfaces:**
- Produces: `public.user_trial_used(p_user_id uuid) returns boolean`
- Produces: `public.trial_used() returns boolean`
- Consumed by subsequent tasks: Edge Function uses `user_trial_used`; Next route/account page use `trial_used`.

- [ ] **Step 1: Write the failing integration tests**

In `tests/media/db-rpcs.integration.test.ts`, add these tests near the top of `describeDb("media SQL RPC integration", () => {`, after the existing `afterEach` block:

```ts
  it("reports trial unused until any subscription row exists", async () => {
    const admin = getAdminClient();
    const { userId } = await createUserAndAccount();

    const before = await admin.rpc("user_trial_used", { p_user_id: userId });
    expect(before.error).toBeNull();
    expect(before.data).toBe(false);

    await insertSubscription({ userId, status: "canceled" });

    const after = await admin.rpc("user_trial_used", { p_user_id: userId });
    expect(after.error).toBeNull();
    expect(after.data).toBe(true);
  });

  it.each([
    "trialing",
    "active",
    "past_due",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "unpaid",
    "paused",
  ])("counts %s subscription rows as trial used", async (status) => {
    const admin = getAdminClient();
    const { userId } = await createUserAndAccount();
    await insertSubscription({ userId, status });

    const { data, error } = await admin.rpc("user_trial_used", {
      p_user_id: userId,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });
```

At the bottom of the file, before `async function insertMediaJob`, add this helper:

```ts
async function insertSubscription({
  userId,
  status,
}: {
  userId: string;
  status: string;
}) {
  const admin = getAdminClient();
  const now = Date.now();
  const { error } = await admin
    .from("subscriptions")
    .insert({
      user_id: userId,
      stripe_subscription_id: `sub_${randomUUID()}`,
      stripe_customer_id: `cus_${randomUUID()}`,
      status,
      price_id: "price_test_subscription",
      trial_end: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      current_period_end: new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString(),
      cancel_at_period_end: false,
      metadata: {},
    });

  if (error) throw error;
}
```

- [ ] **Step 2: Run integration test to verify it fails**

Requires local Supabase to be running and reset to current migrations.

Run:

```bash
RUN_SUPABASE_DB_TESTS=1 pnpm run test:media-db -- -t "trial used"
```

Expected: FAIL with `function user_trial_used(...) does not exist` or an equivalent RPC-missing error. If the sandbox blocks `127.0.0.1:54321` with `EPERM`, record the blocker and continue to the migration step; do not claim DB verification passed.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/20260708120000_trial_used_subscription_checkout.sql`:

```sql
-- Trial eligibility for the subscription checkout flow.
-- A user has used their trial once any subscription row exists for them,
-- regardless of current Stripe status.

create or replace function public.user_trial_used(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.subscriptions
    where user_id = p_user_id
  );
$$;

create or replace function public.trial_used()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.user_trial_used(auth.uid());
$$;

revoke all on function public.user_trial_used(uuid) from public, anon, authenticated;
revoke all on function public.trial_used() from public, anon;

grant execute on function public.user_trial_used(uuid) to service_role;
grant execute on function public.trial_used() to authenticated, service_role;
```

- [ ] **Step 4: Apply migration locally**

Run:

```bash
supabase db reset
```

Expected: database reset completes successfully. If this requires approval or fails due to local Supabase state, surface the exact error.

- [ ] **Step 5: Run integration tests to verify they pass**

Run:

```bash
RUN_SUPABASE_DB_TESTS=1 pnpm run test:media-db -- -t "trial used"
```

Expected: PASS for the new trial-used tests. If the sandbox blocks loopback DB access, record `connect EPERM 127.0.0.1:54321` or the exact blocker.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260708120000_trial_used_subscription_checkout.sql tests/media/db-rpcs.integration.test.ts
git commit -m "feat(billing): track trial-used eligibility"
```

---

### Task 3: Subscription Checkout Session Branching

**Files:**
- Create: `supabase/functions/create-checkout-session/subscription.ts`
- Create: `tests/billing/subscription-checkout.test.ts`
- Create: `tests/billing/create-checkout-session-source.test.ts`
- Modify: `supabase/functions/create-checkout-session/index.ts`

**Interfaces:**
- Produces: `normalizeCheckoutOrigin(value: unknown): "app" | "web"`
- Produces: `buildSubscriptionCheckoutSession(input): { checkoutMode: "trial" | "subscription"; params: SubscriptionCheckoutSessionParams }`
- Consumes: `public.user_trial_used(p_user_id uuid)` from Task 2.

- [ ] **Step 1: Write failing helper tests**

Create `tests/billing/subscription-checkout.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildSubscriptionCheckoutSession,
  normalizeCheckoutOrigin,
} from "../../supabase/functions/create-checkout-session/subscription";

describe("subscription checkout helper", () => {
  it("normalizes only the app origin as app", () => {
    expect(normalizeCheckoutOrigin("app")).toBe("app");
    expect(normalizeCheckoutOrigin("web")).toBe("web");
    expect(normalizeCheckoutOrigin("https://evil.example")).toBe("web");
    expect(normalizeCheckoutOrigin(undefined)).toBe("web");
  });

  it("builds a trial checkout for trial-eligible app users", () => {
    const plan = buildSubscriptionCheckoutSession({
      customerId: "cus_123",
      userId: "user_123",
      priceId: "price_123",
      siteUrl: "https://woven.video/",
      origin: "app",
      trialUsed: false,
    });

    expect(plan.checkoutMode).toBe("trial");
    expect(plan.params).toMatchObject({
      mode: "subscription",
      customer: "cus_123",
      client_reference_id: "user_123",
      payment_method_collection: "always",
      line_items: [{ price: "price_123", quantity: 1 }],
      metadata: {
        user_id: "user_123",
        purpose: "subscription",
        trial_eligible: "true",
      },
      success_url: "https://woven.video/checkout/success",
      cancel_url: "https://woven.video/checkout/cancelled",
    });
    expect(plan.params.subscription_data).toEqual({
      trial_period_days: 7,
      trial_settings: {
        end_behavior: { missing_payment_method: "cancel" },
      },
      metadata: {
        user_id: "user_123",
        purpose: "subscription",
        trial_eligible: "true",
      },
    });
  });

  it("builds an immediate paid checkout for trial-used web users", () => {
    const plan = buildSubscriptionCheckoutSession({
      customerId: "cus_456",
      userId: "user_456",
      priceId: "price_456",
      siteUrl: "https://woven.video",
      origin: "web",
      trialUsed: true,
    });

    expect(plan.checkoutMode).toBe("subscription");
    expect(plan.params.success_url).toBe(
      "https://woven.video/account?subscription=started&session_id={CHECKOUT_SESSION_ID}",
    );
    expect(plan.params.cancel_url).toBe("https://woven.video/account?subscription=cancelled");
    expect(plan.params.metadata.trial_eligible).toBe("false");
    expect(plan.params.subscription_data).toEqual({
      metadata: {
        user_id: "user_456",
        purpose: "subscription",
        trial_eligible: "false",
      },
    });
    expect(plan.params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(plan.params.subscription_data).not.toHaveProperty("trial_settings");
  });
});
```

Create `tests/billing/create-checkout-session-source.test.ts`:

```ts
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("create-checkout-session source", () => {
  it("checks trial-used eligibility before creating subscription checkout", async () => {
    const source = await readFile(
      "supabase/functions/create-checkout-session/index.ts",
      "utf8",
    );

    expect(source).toContain("user_trial_used");
    expect(source).toContain("failed_to_check_trial_eligibility");
    expect(source).toContain("checkoutMode");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test -- tests/billing/subscription-checkout.test.ts tests/billing/create-checkout-session-source.test.ts
```

Expected: FAIL with missing helper module and source assertions not finding `user_trial_used`.

- [ ] **Step 3: Create the pure Checkout helper**

Create `supabase/functions/create-checkout-session/subscription.ts`:

```ts
export type CheckoutOrigin = "app" | "web";
export type SubscriptionCheckoutMode = "trial" | "subscription";

type TrialEligibleValue = "true" | "false";

type SubscriptionCheckoutMetadata = {
  user_id: string;
  purpose: "subscription";
  trial_eligible: TrialEligibleValue;
};

export type SubscriptionCheckoutSessionParams = {
  mode: "subscription";
  customer: string;
  client_reference_id: string;
  payment_method_collection: "always";
  line_items: Array<{ price: string; quantity: number }>;
  subscription_data: {
    metadata: SubscriptionCheckoutMetadata;
    trial_period_days?: number;
    trial_settings?: {
      end_behavior: { missing_payment_method: "cancel" };
    };
  };
  metadata: SubscriptionCheckoutMetadata;
  success_url: string;
  cancel_url: string;
};

export function normalizeCheckoutOrigin(value: unknown): CheckoutOrigin {
  return value === "app" ? "app" : "web";
}

function normalizeSiteUrl(siteUrl: string) {
  return siteUrl.replace(/\/+$/, "");
}

function subscriptionRedirects({
  siteUrl,
  origin,
  trialUsed,
}: {
  siteUrl: string;
  origin: CheckoutOrigin;
  trialUsed: boolean;
}) {
  const baseUrl = normalizeSiteUrl(siteUrl);

  if (origin === "app") {
    return {
      successUrl: `${baseUrl}/checkout/success`,
      cancelUrl: `${baseUrl}/checkout/cancelled`,
    };
  }

  return {
    successUrl: trialUsed
      ? `${baseUrl}/account?subscription=started&session_id={CHECKOUT_SESSION_ID}`
      : `${baseUrl}/account?subscription=trialing&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}/account?subscription=cancelled`,
  };
}

export function buildSubscriptionCheckoutSession({
  customerId,
  userId,
  priceId,
  siteUrl,
  origin,
  trialUsed,
}: {
  customerId: string;
  userId: string;
  priceId: string;
  siteUrl: string;
  origin: CheckoutOrigin;
  trialUsed: boolean;
}): {
  checkoutMode: SubscriptionCheckoutMode;
  params: SubscriptionCheckoutSessionParams;
} {
  const trialEligible = trialUsed ? "false" : "true";
  const metadata: SubscriptionCheckoutMetadata = {
    user_id: userId,
    purpose: "subscription",
    trial_eligible: trialEligible,
  };
  const redirects = subscriptionRedirects({ siteUrl, origin, trialUsed });
  const subscriptionData: SubscriptionCheckoutSessionParams["subscription_data"] = {
    metadata,
  };

  if (!trialUsed) {
    subscriptionData.trial_period_days = 7;
    subscriptionData.trial_settings = {
      end_behavior: { missing_payment_method: "cancel" },
    };
  }

  return {
    checkoutMode: trialUsed ? "subscription" : "trial",
    params: {
      mode: "subscription",
      customer: customerId,
      client_reference_id: userId,
      payment_method_collection: "always",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: subscriptionData,
      metadata,
      success_url: redirects.successUrl,
      cancel_url: redirects.cancelUrl,
    },
  };
}
```

- [ ] **Step 4: Wire the Edge Function**

In `supabase/functions/create-checkout-session/index.ts`, add this import near the existing imports:

```ts
import {
  buildSubscriptionCheckoutSession,
  normalizeCheckoutOrigin,
} from "./subscription.ts";
```

Replace the current `body.purpose === "subscription"` branch with:

```ts
    // ---- SUBSCRIPTION checkout (trial -> $99/yr, or immediate paid after trial used) ----
    if (body.purpose === "subscription") {
      const { data: hasAccess, error: accessError } = await admin.rpc(
        "user_has_access",
        { p_user_id: user.id },
      );

      if (accessError) {
        throw new HttpError(500, "failed_to_check_access", accessError);
      }

      if (hasAccess) {
        return jsonResponse({ alreadySubscribed: true, checkoutMode: "none" });
      }

      const { data: trialUsed, error: trialUsedError } = await admin.rpc(
        "user_trial_used",
        { p_user_id: user.id },
      );

      if (trialUsedError) {
        throw new HttpError(
          500,
          "failed_to_check_trial_eligibility",
          trialUsedError,
        );
      }

      const checkoutPlan = buildSubscriptionCheckoutSession({
        customerId,
        userId: user.id,
        priceId: requiredEnv("STRIPE_SUBSCRIPTION_PRICE_ID"),
        siteUrl,
        origin: normalizeCheckoutOrigin(body.origin),
        trialUsed: trialUsed === true,
      });

      const subscriptionSession = await stripe.checkout.sessions.create(
        checkoutPlan.params,
      );

      return jsonResponse({
        url: subscriptionSession.url,
        checkoutMode: checkoutPlan.checkoutMode,
      });
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm test -- tests/billing/subscription-checkout.test.ts tests/billing/create-checkout-session-source.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/create-checkout-session/index.ts supabase/functions/create-checkout-session/subscription.ts tests/billing/subscription-checkout.test.ts tests/billing/create-checkout-session-source.test.ts
git commit -m "feat(billing): branch subscription checkout by trial eligibility"
```

---

### Task 4: Balance API Eligibility Fields

**Files:**
- Modify: `app/api/v1/billing/balance/route.ts`
- Create: `tests/billing/balance-route-source.test.ts`

**Interfaces:**
- Consumes: `resolveCheckoutMode` from Task 1.
- Consumes: `public.trial_used()` from Task 2.
- Produces additive JSON fields: `trial_used?: boolean`, `checkout_mode?: CheckoutMode`.

- [ ] **Step 1: Write the failing source test**

Create `tests/billing/balance-route-source.test.ts`:

```ts
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("billing balance API source", () => {
  it("returns additive trial eligibility fields when available", async () => {
    const source = await readFile("app/api/v1/billing/balance/route.ts", "utf8");

    expect(source).toContain("resolveCheckoutMode");
    expect(source).toContain('supabase.rpc("trial_used")');
    expect(source).toContain("trial_used");
    expect(source).toContain("checkout_mode");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- tests/billing/balance-route-source.test.ts
```

Expected: FAIL because the route does not call `trial_used` or include the new fields yet.

- [ ] **Step 3: Update the route**

In `app/api/v1/billing/balance/route.ts`, add the import:

```ts
import { resolveCheckoutMode } from "@/lib/billing/subscription-eligibility";
```

Replace the current license block and `Response.json` return with this code:

```ts
  // Additive license object. `active` now reflects has_access (grandfathered OR
  // legacy license OR a live subscription: trialing/active/past_due) so trialing
  // users aren't walled. Omit the field on a read error so the client falls back
  // to its own cache (fail-open within its grace window).
  let license: { active: boolean; granted_at: string | null } | undefined;
  let hasAccess: boolean | undefined;
  const { data: active, error: licenseError } = await supabase.rpc(
    "has_access",
  );

  if (!licenseError) {
    hasAccess = active === true;
    let grantedAt: string | null = null;
    if (hasAccess) {
      const { data: licenseRow } = await supabase
        .from("licenses")
        .select("granted_at")
        .eq("status", "active")
        .maybeSingle();
      grantedAt = licenseRow?.granted_at ?? null;
    }
    license = { active: hasAccess, granted_at: grantedAt };
  }

  let trialUsed: boolean | undefined;
  const { data: trialUsedData, error: trialUsedError } = await supabase.rpc("trial_used");

  if (!trialUsedError) {
    trialUsed = trialUsedData === true;
  }

  const checkoutMode =
    hasAccess === undefined
      ? undefined
      : resolveCheckoutMode({ hasAccess, trialUsed });

  return Response.json({
    currency: row?.currency ?? "usd",
    balance_usd_micros: balanceUsdMicros,
    balance_usd: balanceUsdMicros / 1_000_000,
    ...(license ? { license } : {}),
    ...(trialUsed !== undefined ? { trial_used: trialUsed } : {}),
    ...(checkoutMode ? { checkout_mode: checkoutMode } : {}),
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test -- tests/billing/subscription-eligibility.test.ts tests/billing/balance-route-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/billing/balance/route.ts tests/billing/balance-route-source.test.ts
git commit -m "feat(api): expose trial eligibility in balance response"
```

---

### Task 5: Web Account CTA Uses Checkout Mode

**Files:**
- Create: `components/account/subscription-offer.ts`
- Create: `tests/billing/subscription-offer.test.ts`
- Modify: `components/account/start-trial-button.tsx`
- Modify: `components/account/subscription-cta.tsx`
- Modify: `app/account/page.tsx`
- Modify: `app/account/actions.ts`

**Interfaces:**
- Consumes: `CheckoutMode` and `resolveCheckoutMode` from Task 1.
- Produces: `getNoAccessSubscriptionOffer(checkoutMode: CheckoutMode | undefined): NoAccessSubscriptionOffer`
- Produces: `SubscriptionCta` prop `checkoutMode?: CheckoutMode`
- Produces: `StartTrialButton` prop `label?: string`

- [ ] **Step 1: Write failing presentation tests**

Create `tests/billing/subscription-offer.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getNoAccessSubscriptionOffer } from "@/components/account/subscription-offer";

describe("getNoAccessSubscriptionOffer", () => {
  it("uses free-trial copy only for explicit trial checkout mode", () => {
    expect(getNoAccessSubscriptionOffer("trial")).toEqual({
      title: "Start your free trial",
      buttonLabel: "Start your 7-day free trial",
      emphasizedFinePrint: "$0 due today",
      finePrint: "cancel anytime before day 7 · card required. We email you before your trial ends.",
    });
  });

  it("uses subscription copy for trial-used accounts", () => {
    const offer = getNoAccessSubscriptionOffer("subscription");

    expect(offer.title).toBe("Start your Woven subscription");
    expect(offer.buttonLabel).toBe("Subscribe to Woven");
    expect(`${offer.title} ${offer.buttonLabel} ${offer.finePrint}`).not.toMatch(/free trial|\$0 due today/i);
  });

  it("uses generic checkout copy when eligibility is unknown", () => {
    const offer = getNoAccessSubscriptionOffer(undefined);

    expect(offer.title).toBe("Start Woven");
    expect(offer.buttonLabel).toBe("Continue to checkout");
    expect(`${offer.title} ${offer.buttonLabel} ${offer.finePrint}`).not.toMatch(/free trial|\$0 due today/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- tests/billing/subscription-offer.test.ts
```

Expected: FAIL with missing `@/components/account/subscription-offer`.

- [ ] **Step 3: Create offer helper**

Create `components/account/subscription-offer.ts`:

```ts
import type { CheckoutMode } from "@/lib/billing/subscription-eligibility";

export type NoAccessSubscriptionOffer = {
  title: string;
  buttonLabel: string;
  emphasizedFinePrint: string;
  finePrint: string;
};

export function getNoAccessSubscriptionOffer(
  checkoutMode: CheckoutMode | undefined,
): NoAccessSubscriptionOffer {
  if (checkoutMode === "trial") {
    return {
      title: "Start your free trial",
      buttonLabel: "Start your 7-day free trial",
      emphasizedFinePrint: "$0 due today",
      finePrint: "cancel anytime before day 7 · card required. We email you before your trial ends.",
    };
  }

  if (checkoutMode === "subscription") {
    return {
      title: "Start your Woven subscription",
      buttonLabel: "Subscribe to Woven",
      emphasizedFinePrint: "$99/year",
      finePrint: "billed annually. Checkout shows the total before you subscribe.",
    };
  }

  return {
    title: "Start Woven",
    buttonLabel: "Continue to checkout",
    emphasizedFinePrint: "$99/year",
    finePrint: "checkout shows the total before you confirm.",
  };
}
```

- [ ] **Step 4: Update button label prop**

Replace `components/account/start-trial-button.tsx` with:

```tsx
"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function StartTrialButton({
  label = "Start your 7-day free trial",
}: {
  label?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="h-10 rounded-lg px-5">
      {pending ? "Opening Stripe…" : label}
    </Button>
  );
}
```

- [ ] **Step 5: Update SubscriptionCta**

In `components/account/subscription-cta.tsx`, add imports:

```ts
import { getNoAccessSubscriptionOffer } from "@/components/account/subscription-offer";
import type { CheckoutMode } from "@/lib/billing/subscription-eligibility";
```

Change the function signature to:

```ts
export function SubscriptionCta({
  hasAccess,
  subscription,
  checkoutMode,
}: {
  hasAccess: boolean;
  subscription: SubscriptionSummary;
  checkoutMode?: CheckoutMode;
}) {
```

Replace the current no-access return block with:

```tsx
  const offer = getNoAccessSubscriptionOffer(checkoutMode);

  return (
    <Card className="ring-2 ring-foreground">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{offer.title}</CardTitle>
          <span className="inline-flex shrink-0 items-center rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
            Required
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="font-heading text-4xl font-medium tracking-tight tabular-nums">
              $8.25
            </span>
            <span className="text-sm text-muted-foreground">/mo</span>
          </div>
          <span className="text-sm text-muted-foreground">
            billed annually at $99/yr
          </span>
        </div>
        <ul className="flex flex-col gap-3 border-t pt-5 text-sm">
          {trialBullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                <CheckIcon className="size-3" />
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <form action={createTrialCheckoutSession}>
            <StartTrialButton label={offer.buttonLabel} />
          </form>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{offer.emphasizedFinePrint}</span>{" "}
            · {offer.finePrint}
          </p>
        </div>
      </CardContent>
    </Card>
  );
```

- [ ] **Step 6: Update account page query and alerts**

In `app/account/page.tsx`, add:

```ts
import { resolveCheckoutMode } from "@/lib/billing/subscription-eligibility";
```

In the `Promise.all` destructuring, add `trial_used` as a final result:

```ts
    { data: hasAccessData },
    { data: trialUsedData },
```

In the `Promise.all([...])` array, add:

```ts
    supabase.rpc("trial_used"),
```

After `const hasAccess = hasAccessData === true;`, add:

```ts
  const checkoutMode = resolveCheckoutMode({
    hasAccess,
    trialUsed: trialUsedData === true ? true : trialUsedData === false ? false : undefined,
  });
```

Add this alert after the existing `subscriptionParam === "trialing"` alert:

```tsx
      {subscriptionParam === "started" ? (
        <Alert tone="success">
          Your subscription is starting. Stripe may take a moment to sync.
        </Alert>
      ) : null}
```

Update both `SubscriptionCta` usages to pass `checkoutMode`:

```tsx
              <SubscriptionCta
                hasAccess={hasAccess}
                subscription={subscription}
                checkoutMode={checkoutMode}
              />
```

- [ ] **Step 7: Update checkout action copy**

In `app/account/actions.ts`, inside `createTrialCheckoutSession`, extend the payload type:

```ts
      checkoutMode?: "trial" | "subscription" | "none";
```

Change the fallback error text in that same action from:

```ts
        `Unable to start your free trial. (${response.status})`;
```

to:

```ts
        `Unable to start checkout. (${response.status})`;
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm test -- tests/billing/subscription-offer.test.ts tests/billing/subscription-eligibility.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run account source sanity check**

Run:

```bash
rg -n "subscription=started|checkoutMode=\\{checkoutMode\\}|trial_used|Unable to start checkout" app/account components/account
```

Expected: matches in `app/account/page.tsx`, `app/account/actions.ts`, and `components/account/subscription-cta.tsx`.

- [ ] **Step 10: Commit**

```bash
git add app/account/actions.ts app/account/page.tsx components/account/start-trial-button.tsx components/account/subscription-cta.tsx components/account/subscription-offer.ts tests/billing/subscription-offer.test.ts
git commit -m "feat(account): show subscription CTA after trial used"
```

---

### Task 6: Final Verification

**Files:**
- Read/verify only unless a prior task failed.

**Interfaces:**
- Consumes all prior task outputs.
- Produces final confidence that backend contract, web copy, and tests are coherent.

- [ ] **Step 1: Run focused billing tests**

Run:

```bash
pnpm test -- tests/billing/subscription-eligibility.test.ts tests/billing/subscription-checkout.test.ts tests/billing/create-checkout-session-source.test.ts tests/billing/balance-route-source.test.ts tests/billing/subscription-offer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full non-DB Vitest suite**

Run:

```bash
pnpm test
```

Expected: PASS. If unrelated existing tests fail, record the exact failing test names and errors.

- [ ] **Step 3: Run DB verification if local Supabase is available**

Run:

```bash
supabase db reset
RUN_SUPABASE_DB_TESTS=1 pnpm run test:media-db
```

Expected: DB reset passes and `tests/media/db-rpcs.integration.test.ts` passes. If sandbox loopback is blocked with `EPERM 127.0.0.1:54321`, report it as environment-blocked verification.

- [ ] **Step 4: Check formatting and worktree**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` exits 0. `git status --short` shows no uncommitted changes after the task commits.

- [ ] **Step 5: Handoff note for woven-harness**

Record this in the final implementation summary:

```text
woven-harness follow-up: decode `trial_used` and `checkout_mode` from `/api/v1/billing/balance`; keep `license.active` as the access gate; use `checkout_mode: "subscription"` to render paid subscription copy instead of free-trial copy for trial-used accounts.
```
