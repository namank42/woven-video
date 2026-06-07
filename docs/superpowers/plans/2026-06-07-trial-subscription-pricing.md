# $99/yr + 7-Day Trial Pricing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-time `$99` lifetime license with a `$99/year` subscription gated behind a 7-day, card-required free trial that auto-converts.

**Architecture:** Stripe Checkout in `subscription` mode (`trial_period_days=7`, `payment_method_collection=always`) collects a card and charges `$0`. A new `subscriptions` table mirrors Stripe status, written by `stripe-webhook` on `customer.subscription.*` events; a `$5` hosted credit is granted once at trial start. Access is gated by a new `user_has_access()`/`has_access()` RPC = grandfathered OR legacy license OR subscription status ∈ {`trialing`,`active`,`past_due`}. A `create-portal-session` function gives self-serve cancel/manage-billing. Loops emails fire on `trial_will_end` and `payment_failed`. Grandfather/legacy-license logic is left fully intact.

**Tech Stack:** Next.js 16 (App Router, server components/actions), Supabase (Postgres migrations, Deno edge functions, RLS), Stripe `stripe@22.1.0` apiVersion `2026-04-22.dahlia`, Loops events API.

**Docs digest:** `docs/superpowers/research/2026-06-07-stripe-trial-subscription-docs.md`

**Spec:** `docs/superpowers/specs/2026-06-07-trial-subscription-pricing-design.md`

**Testing reality:** This repo has **no unit-test runner** (only `pnpm lint` and `pnpm build`). Verification therefore uses: `pnpm lint`, `pnpm build` (TS typecheck), `supabase db reset` (apply/verify migrations), and `supabase functions serve` + the Stripe CLI (`stripe listen` / `stripe trigger`) for edge functions. Do **not** scaffold a new test framework — match the codebase.

**Branch:** `feat/trial-subscription` (already created, design docs committed).

---

## File Structure

**Create:**
- `supabase/migrations/20260607120000_create_subscriptions.sql` — `subscriptions` table, RLS, `user_has_access()`/`has_access()`.
- `supabase/functions/_shared/loops.ts` — `sendLoopsEvent()` helper (no-op if `LOOPS_API_KEY` unset).
- `supabase/functions/create-portal-session/index.ts` — Stripe Billing Customer Portal session.
- `components/account/subscription-cta.tsx` — trial/active/past_due/no-access states card.
- `components/account/start-trial-button.tsx` — client submit button (`useFormStatus`).
- `components/account/manage-billing-button.tsx` — client submit button → portal.

**Modify:**
- `supabase/functions/create-checkout-session/index.ts` — add `purpose:"subscription"` branch; top-up gate → `user_has_access`.
- `supabase/functions/stripe-webhook/index.ts` — add subscription/invoice/trial handlers + `$5` trial credit.
- `supabase/config.toml` — register `[functions.create-portal-session] verify_jwt = true`.
- `app/account/actions.ts` — `createTrialCheckoutSession()`, `createPortalSession()`.
- `lib/api/license.ts` — gate RPC `has_active_license` → `has_access`.
- `app/account/page.tsx` — query subscription, switch to `has_access`, new alerts + CTA.
- `components/account/balance-top-up-form.tsx` — gating copy.
- `app/pricing/page.tsx`, `app/page.tsx`, `components/checkout/checkout-result.tsx` — marketing copy.
- `.env.example` — add `STRIPE_SUBSCRIPTION_PRICE_ID`; note `LOOPS_API_KEY` for functions.

**Delete:**
- `components/account/license-cta.tsx`, `components/account/license-buy-button.tsx` (replaced by subscription CTA).

---

## Task 1: DB migration — `subscriptions` table + access RPCs

**Files:**
- Create: `supabase/migrations/20260607120000_create_subscriptions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Subscription mirror for the $99/yr + 7-day trial model. Source of truth is Stripe;
-- rows are written by the stripe-webhook edge function (service role) on
-- customer.subscription.* events. Access is granted during trialing/active/past_due.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text,
  status text not null,                       -- mirrors Stripe; intentionally NO check so a new
                                              -- Stripe status can never reject a webhook write
  price_id text,
  trial_end timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_user_idx on public.subscriptions(user_id);
create index subscriptions_user_status_idx on public.subscriptions(user_id, status);

create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

-- Access = grandfathered OR legacy active license OR a live subscription.
-- Reuses user_has_active_license (grandfather + legacy lifetime) from the licenses migration.
create or replace function public.user_has_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.user_has_active_license(p_user_id)
    or exists (
      select 1 from public.subscriptions
      where user_id = p_user_id
        and status in ('trialing', 'active', 'past_due')
    );
$$;

create or replace function public.has_access()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.user_has_access(auth.uid());
$$;

alter table public.subscriptions enable row level security;

create policy "Users can read own subscriptions"
on public.subscriptions
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;   -- read-own ONLY; writes are service-role
grant all on public.subscriptions to service_role;

revoke all on function public.user_has_access(uuid) from public, anon;
revoke all on function public.has_access() from public, anon;
grant execute on function public.user_has_access(uuid) to authenticated, service_role;
grant execute on function public.has_access() to authenticated, service_role;
```

- [ ] **Step 2: Apply and verify the migration runs clean**

Run: `pnpm supabase db reset`
Expected: all migrations apply with no error; output ends with the seed step succeeding. Confirm the new migration is listed.

- [ ] **Step 3: Smoke-test the access function**

Run:
```bash
pnpm supabase db reset >/dev/null 2>&1
psql "$(pnpm supabase status -o env 2>/dev/null | grep DB_URL | cut -d= -f2- | tr -d '"')" \
  -c "select public.user_has_access('00000000-0000-0000-0000-000000000000'::uuid) as has_access;"
```
Expected: returns `f` (false) — unknown user has no access, no subscription row, function resolves.
(If `psql`/status env isn't wired locally, skip and rely on Step 2 + the `pnpm build` typecheck downstream.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260607120000_create_subscriptions.sql
git commit -m "feat(db): subscriptions table + user_has_access/has_access RPCs"
```

---

## Task 2: Config — env vars

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the subscription price var after the license price**

Find in `.env.example`:
```
STRIPE_LICENSE_PRICE_ID=price_xxx
```
Add directly below it:
```
# Recurring yearly Price ($99/yr) for the trial→subscription flow (created in Stripe).
STRIPE_SUBSCRIPTION_PRICE_ID=price_xxx
```

- [ ] **Step 2: Note that the webhook needs the Loops key**

Find the existing line:
```
LOOPS_API_KEY=lo_replace_me
```
Replace it with:
```
# Used by the Next.js app AND the stripe-webhook edge function (trial/dunning emails).
# For deployed functions set it as a Supabase secret: supabase secrets set LOOPS_API_KEY=...
LOOPS_API_KEY=lo_replace_me
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore(env): add STRIPE_SUBSCRIPTION_PRICE_ID; document LOOPS_API_KEY for functions"
```

---

## Task 3: Edge — Loops event helper

**Files:**
- Create: `supabase/functions/_shared/loops.ts`

- [ ] **Step 1: Write the helper**

```ts
// Fires a Loops event from edge functions. No-ops when LOOPS_API_KEY is unset
// (local/preview), mirroring the DB signup trigger's "missing key => no-op" behavior.
// Loops automations turn these events into emails (configured in the Loops dashboard).
export async function sendLoopsEvent(args: {
  email: string;
  userId?: string | null;
  eventName: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  const key = Deno.env.get("LOOPS_API_KEY");
  if (!key || !args.email) {
    return;
  }

  try {
    await fetch("https://app.loops.so/api/v1/events/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        email: args.email,
        userId: args.userId ?? undefined,
        eventName: args.eventName,
        ...(args.properties ?? {}),
      }),
    });
  } catch (error) {
    console.error(`loops event "${args.eventName}" failed:`, error);
  }
}
```

- [ ] **Step 2: Typecheck the function**

Run: `pnpm supabase functions serve --no-verify-jwt stripe-webhook 2>&1 | head -5` then Ctrl-C, OR rely on Deno check in Task 5 where it's imported. Minimal standalone check:
Run: `deno check supabase/functions/_shared/loops.ts`
Expected: no type errors. (If `deno` isn't installed locally, this is covered when the webhook imports it under `supabase functions serve` in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/loops.ts
git commit -m "feat(functions): shared Loops event helper"
```

---

## Task 4: Edge — subscription Checkout branch

**Files:**
- Modify: `supabase/functions/create-checkout-session/index.ts`

- [ ] **Step 1: Add the subscription branch before the LICENSE branch**

Insert this block immediately **before** the `// ---- LICENSE checkout ----` comment (currently line 115):

```ts
    // ---- SUBSCRIPTION checkout (trial -> $99/yr) ----
    if (body.purpose === "subscription") {
      const { data: hasAccess, error: accessError } = await admin.rpc(
        "user_has_access",
        { p_user_id: user.id },
      );

      if (accessError) {
        throw new HttpError(500, "failed_to_check_access", accessError);
      }

      if (hasAccess) {
        return jsonResponse({ alreadySubscribed: true });
      }

      const subMetadata = { user_id: user.id, purpose: "subscription" };

      // Whitelisted redirect target (see LICENSE branch note). Never echo a raw URL.
      const subOrigin = body.origin === "app" ? "app" : "web";
      const subSuccessUrl = subOrigin === "app"
        ? `${siteUrl}/checkout/success`
        : `${siteUrl}/account?subscription=trialing&session_id={CHECKOUT_SESSION_ID}`;
      const subCancelUrl = subOrigin === "app"
        ? `${siteUrl}/checkout/cancelled`
        : `${siteUrl}/account?subscription=cancelled`;

      const subscriptionSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.id,
        payment_method_collection: "always", // require the card up front
        line_items: [
          { price: requiredEnv("STRIPE_SUBSCRIPTION_PRICE_ID"), quantity: 1 },
        ],
        subscription_data: {
          trial_period_days: 7,
          trial_settings: {
            end_behavior: { missing_payment_method: "cancel" },
          },
          metadata: subMetadata, // carried onto the Subscription object for the webhook
        },
        metadata: subMetadata,
        success_url: subSuccessUrl,
        cancel_url: subCancelUrl,
      });

      return jsonResponse({ url: subscriptionSession.url });
    }

```

- [ ] **Step 2: Switch the top-up gate from license to access**

In the `// ---- TOPUP checkout ----` block, replace the RPC call (currently line 177-180):
```ts
      const { data: licensed, error: licenseCheckError } = await admin.rpc(
        "user_has_active_license",
        { p_user_id: user.id },
      );
```
with:
```ts
      const { data: licensed, error: licenseCheckError } = await admin.rpc(
        "user_has_access",
        { p_user_id: user.id },
      );
```
(Leave the surrounding `WOVEN_ENFORCE_LICENSE` flag and the `license_required` error as-is.)

- [ ] **Step 3: Serve the function and verify it boots without type errors**

Run: `pnpm supabase functions serve create-checkout-session` (Ctrl-C after it prints "Serving functions on ...")
Expected: serves with no TypeScript/import error.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-checkout-session/index.ts
git commit -m "feat(functions): subscription-mode checkout branch with 7-day trial"
```

---

## Task 5: Edge — webhook subscription/invoice handlers + trial credit

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`

- [ ] **Step 1: Import the Loops helper and add a trial-credit constant**

At the top, after the existing imports, add:
```ts
import { sendLoopsEvent } from "../_shared/loops.ts";
```
Below the existing `LICENSE_BONUS_USD_MICROS` constant (line 12), add:
```ts
const TRIAL_CREDIT_USD_MICROS = 5_000_000; // $5 hosted credits seeded once at trial start
```

- [ ] **Step 2: Extend the event dispatch**

Replace the dispatch block (currently lines 36-42):
```ts
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
      );
    } else if (event.type === "charge.refunded") {
      await handleChargeRefunded(stripe, event.data.object as Stripe.Charge);
    }
```
with:
```ts
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
      );
    } else if (event.type === "charge.refunded") {
      await handleChargeRefunded(stripe, event.data.object as Stripe.Charge);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await handleSubscriptionEvent(event.data.object as Stripe.Subscription);
    } else if (event.type === "customer.subscription.trial_will_end") {
      await handleTrialWillEnd(event.data.object as Stripe.Subscription);
    } else if (event.type === "invoice.paid") {
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
    } else if (event.type === "invoice.payment_failed") {
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
    }
```

- [ ] **Step 3: Add the handlers and a profile-resolver helper**

Append at the end of the file:
```ts
function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

// Resolve { userId, email } from a Stripe customer id via profiles.
async function resolveProfile(
  admin: ReturnType<typeof createServiceClient>,
  customerId: string | null,
): Promise<{ userId: string | null; email: string | null }> {
  if (!customerId) return { userId: null, email: null };
  const { data } = await admin
    .from("profiles")
    .select("id, email")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return { userId: data?.id ?? null, email: data?.email ?? null };
}

async function handleSubscriptionEvent(sub: Stripe.Subscription) {
  const admin = createServiceClient();
  const customerId = customerIdOf(sub.customer);

  // user_id is set via subscription_data.metadata at checkout; fall back to customer lookup.
  let userId = sub.metadata?.user_id ?? null;
  if (!userId) {
    userId = (await resolveProfile(admin, customerId)).userId;
  }
  if (!userId) {
    throw new HttpError(400, "subscription_missing_user");
  }

  // current_period_end may live on the subscription OR on its first item (API-version dependent).
  const item = sub.items?.data?.[0];
  const periodEndUnix = (sub as { current_period_end?: number })
    .current_period_end ??
    (item as { current_period_end?: number } | undefined)?.current_period_end ??
    null;
  const priceId = item?.price?.id ?? null;

  const { error: upsertError } = await admin
    .from("subscriptions")
    .upsert({
      user_id: userId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
      status: sub.status,
      price_id: priceId,
      trial_end: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
      current_period_end: periodEndUnix
        ? new Date(periodEndUnix * 1000).toISOString()
        : null,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      metadata: { latest_event_status: sub.status },
    }, { onConflict: "stripe_subscription_id" });

  if (upsertError) {
    throw new HttpError(500, "failed_to_upsert_subscription", upsertError);
  }

  // Seed $5 hosted credits once when the trial starts. Idempotent on
  // (source, source_id, kind) = ('trial_bonus', subscription_id, 'promo'), so repeated
  // trialing webhooks are a no-op.
  if (sub.status === "trialing") {
    const { error: creditError } = await admin.rpc("grant_balance", {
      p_user_id: userId,
      p_amount_usd_micros: TRIAL_CREDIT_USD_MICROS,
      p_source: "trial_bonus",
      p_source_id: sub.id,
      p_kind: "promo",
      p_metadata: { reason: "trial_bonus", stripe_subscription_id: sub.id },
    });
    if (creditError) {
      throw new HttpError(500, "failed_to_grant_trial_credit", creditError);
    }
  }
}

async function handleTrialWillEnd(sub: Stripe.Subscription) {
  const admin = createServiceClient();
  const customerId = customerIdOf(sub.customer);
  const { userId, email } = await resolveProfile(admin, customerId);
  if (email) {
    await sendLoopsEvent({
      email,
      userId: sub.metadata?.user_id ?? userId,
      eventName: "trial_ending",
    });
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // Only real charges (trial conversion + annual renewals); skip $0 trial-start invoices.
  if ((invoice.amount_paid ?? 0) <= 0) {
    return;
  }
  const admin = createServiceClient();
  const customerId = customerIdOf(invoice.customer);
  const { userId, email } = await resolveProfile(admin, customerId);
  const to = invoice.customer_email ?? email;
  if (to) {
    await sendLoopsEvent({ email: to, userId, eventName: "subscription_paid" });
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const admin = createServiceClient();
  const customerId = customerIdOf(invoice.customer);
  const { userId, email } = await resolveProfile(admin, customerId);
  const to = invoice.customer_email ?? email;
  if (to) {
    await sendLoopsEvent({ email: to, userId, eventName: "payment_failed" });
  }
}
```

- [ ] **Step 4: Serve the webhook and replay subscription events with the Stripe CLI**

Terminal A: `pnpm supabase functions serve stripe-webhook --no-verify-jwt`
Terminal B:
```bash
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_failed
```
Expected: each returns `200` in the `stripe listen` output; the function log shows no thrown `HttpError`. (CLI fixture subs won't carry our `user_id` metadata or a matching customer, so `subscription_missing_user` on a fixture is acceptable — the path is exercised. Real verification happens end-to-end in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(functions): subscription/invoice webhook handlers + trial credit + Loops"
```

---

## Task 6: Edge — Customer Portal session

**Files:**
- Create: `supabase/functions/create-portal-session/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write the portal function**

```ts
import Stripe from "stripe";

import {
  errorResponse,
  HttpError,
  jsonResponse,
  optionsResponse,
  requiredEnv,
} from "../_shared/http.ts";
import {
  createServiceClient,
  requireAuthenticatedUser,
} from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const user = await requireAuthenticatedUser(req);
    const admin = createServiceClient();
    const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2026-04-22.dahlia",
    });
    const siteUrl = Deno.env.get("WOVEN_SITE_URL") ?? "http://localhost:3000";

    const { data: profile, error } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (error) {
      throw new HttpError(500, "failed_to_load_profile", error);
    }
    if (!profile.stripe_customer_id) {
      throw new HttpError(400, "no_stripe_customer");
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl}/account`,
    });

    return jsonResponse({ url: portal.url });
  } catch (error) {
    return errorResponse(error);
  }
});
```

- [ ] **Step 2: Register the function's JWT verification**

In `supabase/config.toml`, find:
```
[functions.create-checkout-session]
verify_jwt = true
```
Add directly below it:
```
[functions.create-portal-session]
verify_jwt = true
```

- [ ] **Step 3: Serve and verify it boots**

Run: `pnpm supabase functions serve create-portal-session` (Ctrl-C after "Serving functions on ...")
Expected: no TypeScript/import error. A POST without auth returns `401 missing_authorization_header` (the requireAuthenticatedUser guard).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-portal-session/index.ts supabase/config.toml
git commit -m "feat(functions): create-portal-session for self-serve cancel/manage-billing"
```

---

## Task 7: Web — server actions for trial checkout + portal

**Files:**
- Modify: `app/account/actions.ts`

- [ ] **Step 1: Add `createTrialCheckoutSession`**

Append after `createLicenseCheckoutSession` (end of file). It mirrors that action but posts `purpose:"subscription"` and handles `alreadySubscribed`:

```ts
export async function createTrialCheckoutSession() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/account");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect("/login?next=/account");
  }

  const { url, anonKey } = getSupabaseEnv();
  let checkoutUrl: string | undefined;
  let errorMessage: string | undefined;
  let alreadySubscribed = false;

  try {
    const response = await fetch(`${url}/functions/v1/create-checkout-session`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ purpose: "subscription" }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      url?: string;
      alreadySubscribed?: boolean;
      error?: string;
      msg?: string;
      message?: string;
    };

    if (payload.alreadySubscribed) {
      alreadySubscribed = true;
    } else if (!response.ok) {
      errorMessage =
        payload.error ??
        payload.msg ??
        payload.message ??
        `Unable to start your free trial. (${response.status})`;
    } else {
      checkoutUrl = payload.url;
    }
  } catch {
    errorMessage = "Checkout function is not reachable.";
  }

  if (alreadySubscribed) {
    redirect(searchParamUrl("/account", { subscription: "already" }));
  }

  if (!checkoutUrl) {
    redirect(searchParamUrl("/account", { error: errorMessage }));
  }

  redirect(checkoutUrl);
}
```

- [ ] **Step 2: Add `createPortalSession`**

Append after `createTrialCheckoutSession`:

```ts
export async function createPortalSession() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/account");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect("/login?next=/account");
  }

  const { url, anonKey } = getSupabaseEnv();
  let portalUrl: string | undefined;
  let errorMessage: string | undefined;

  try {
    const response = await fetch(`${url}/functions/v1/create-portal-session`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
      msg?: string;
      message?: string;
    };

    if (!response.ok) {
      errorMessage =
        payload.error ??
        payload.msg ??
        payload.message ??
        `Unable to open the billing portal. (${response.status})`;
    } else {
      portalUrl = payload.url;
    }
  } catch {
    errorMessage = "Billing portal is not reachable.";
  }

  if (!portalUrl) {
    redirect(searchParamUrl("/account", { error: errorMessage }));
  }

  redirect(portalUrl);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm build`
Expected: compiles. (These actions are not yet imported anywhere; that happens in Task 9.)

- [ ] **Step 4: Commit**

```bash
git add app/account/actions.ts
git commit -m "feat(account): server actions for trial checkout + billing portal"
```

---

## Task 8: Web — switch the access gate to `has_access`

**Files:**
- Modify: `lib/api/license.ts`

- [ ] **Step 1: Repoint the gate RPC**

In `lib/api/license.ts`, replace:
```ts
  const { data, error } = await auth.supabase.rpc("has_active_license");

  if (error) {
    console.error("has_active_license check failed (failing open):", error.message);
    return null;
  }
```
with:
```ts
  const { data, error } = await auth.supabase.rpc("has_access");

  if (error) {
    console.error("has_access check failed (failing open):", error.message);
    return null;
  }
```
(Keep the `WOVEN_ENFORCE_LICENSE` flag, the fail-open behavior, and the `license_required` error code unchanged — the deploy flag and error contract stay stable for the desktop app.)

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add lib/api/license.ts
git commit -m "feat(api): gate hosted routes on has_access (trial/active/past_due)"
```

---

## Task 9: Web — account page trial state + CTA + portal

**Files:**
- Create: `components/account/subscription-cta.tsx`
- Create: `components/account/start-trial-button.tsx`
- Create: `components/account/manage-billing-button.tsx`
- Modify: `app/account/page.tsx`
- Modify: `components/account/balance-top-up-form.tsx`
- Delete: `components/account/license-cta.tsx`, `components/account/license-buy-button.tsx`

- [ ] **Step 1: Write the trial-start button (client)**

`components/account/start-trial-button.tsx`:
```tsx
"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function StartTrialButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="h-10 rounded-lg px-5">
      {pending ? "Opening Stripe…" : "Start your 7-day free trial"}
    </Button>
  );
}
```

- [ ] **Step 2: Write the manage-billing button (client)**

`components/account/manage-billing-button.tsx`:
```tsx
"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function ManageBillingButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      className="h-9 rounded-lg px-4"
    >
      {pending ? "Opening…" : "Manage billing"}
    </Button>
  );
}
```

- [ ] **Step 3: Write the subscription CTA card (server component)**

`components/account/subscription-cta.tsx`:
```tsx
import { CheckCircle2Icon, CheckIcon } from "lucide-react";

import {
  createPortalSession,
  createTrialCheckoutSession,
} from "@/app/account/actions";
import { ManageBillingButton } from "@/components/account/manage-billing-button";
import { StartTrialButton } from "@/components/account/start-trial-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type SubscriptionSummary = {
  status: string;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
} | null;

const trialBullets = [
  "Full Woven app, free for 7 days",
  "$5 in Woven-hosted credits to try hosted models",
  "Bring your own Anthropic and OpenAI keys, or sign in with ChatGPT",
  "Cancel anytime before day 7 — no charge",
];

function formatDay(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function SubscriptionCta({
  hasAccess,
  subscription,
}: {
  hasAccess: boolean;
  subscription: SubscriptionSummary;
}) {
  // Active subscriber / trialing / past_due — show status + manage billing.
  if (hasAccess && subscription) {
    const { status, trial_end, current_period_end, cancel_at_period_end } =
      subscription;

    const title =
      status === "trialing"
        ? "Free trial active"
        : status === "past_due"
          ? "Payment needs attention"
          : "Subscription active";

    const trialDay = formatDay(trial_end);
    const renewDay = formatDay(current_period_end);
    const description =
      status === "trialing"
        ? cancel_at_period_end
          ? `Your trial ends ${trialDay ?? "soon"} and won't renew.`
          : `Free until ${trialDay ?? "soon"}, then $99/year. Cancel anytime before then.`
        : status === "past_due"
          ? "We couldn't charge your card. Update your payment method to keep access."
          : cancel_at_period_end
            ? `Active until ${renewDay ?? "the period end"} — set to cancel.`
            : `$99/year · renews ${renewDay ?? "annually"}.`;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2Icon className="size-5 text-foreground/70" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createPortalSession}>
            <ManageBillingButton />
          </form>
        </CardContent>
      </Card>
    );
  }

  // Grandfathered free access (has access, no subscription row) — nothing to sell.
  if (hasAccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2Icon className="size-5 text-foreground/70" />
            Full access
          </CardTitle>
          <CardDescription>
            You have full access to Woven. Hosted models draw from your prepaid
            balance below.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // No access — start the trial.
  return (
    <Card className="ring-2 ring-foreground">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Start your free trial</CardTitle>
            <CardDescription>7 days free, then $99/year</CardDescription>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
            Required
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          Card required, $0 today. We email you 3 days before your trial ends.
          Cancel anytime before then and you won't be charged.
        </p>
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
        <form action={createTrialCheckoutSession}>
          <StartTrialButton />
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Update the account page — query subscription, use `has_access`, swap CTA, fix alerts**

In `app/account/page.tsx`:

(a) Replace the `LicenseCta` import (line 12):
```tsx
import { LicenseCta } from "@/components/account/license-cta";
```
with:
```tsx
import {
  SubscriptionCta,
  type SubscriptionSummary,
} from "@/components/account/subscription-cta";
```

(b) Update the `searchParams` type (lines 62-68) to add `subscription`:
```tsx
type AccountPageProps = {
  searchParams: Promise<{
    checkout?: string | string[];
    error?: string | string[];
    license?: string | string[];
    subscription?: string | string[];
  }>;
};
```

(c) In the component body, read the param (after `const license = firstSearchParam(params.license);`, line 256):
```tsx
  const subscriptionParam = firstSearchParam(params.subscription);
```

(d) Add a subscriptions query to the `Promise.all` (the existing block destructures 4 results from 4 queries, lines 259-280). Make two matching additions so positions line up:
- Add `{ data: subscriptionRows },` as the **last** element of the destructuring array (after `{ data: licenseRowsForActivity },`).
- Add this query as the **last** element of the `Promise.all([...])` array (after the `licenses` select):
```tsx
    supabase
      .from("subscriptions")
      .select("status, trial_end, current_period_end, cancel_at_period_end")
      .order("created_at", { ascending: false })
      .limit(1),
```

(e) Replace the license check (lines 290-294):
```tsx
  const { data: hasLicense } = await supabase.rpc("has_active_license");
  const licensed = hasLicense === true;
  // No top-up without a license once enforcement is on (same flag as the API gate).
  const enforceLicense = process.env.WOVEN_ENFORCE_LICENSE === "true";
  const canTopUp = !enforceLicense || licensed;
```
with:
```tsx
  const { data: hasAccessData } = await supabase.rpc("has_access");
  const hasAccess = hasAccessData === true;
  const subscription = (Array.isArray(subscriptionRows)
    ? subscriptionRows[0] ?? null
    : null) as SubscriptionSummary;
  // No top-up without access once enforcement is on (same flag as the API gate).
  const enforceLicense = process.env.WOVEN_ENFORCE_LICENSE === "true";
  const canTopUp = !enforceLicense || hasAccess;
```

(f) Replace the license alert blocks (lines 319-330) with subscription-aware alerts:
```tsx
      {subscriptionParam === "trialing" ? (
        <Alert tone="success">
          Your free trial is starting. Welcome to Woven — your $5 in hosted
          credits is on its way. You won't be charged until day 7.
        </Alert>
      ) : null}
      {subscriptionParam === "already" ? (
        <Alert tone="info">You already have an active Woven plan.</Alert>
      ) : null}
      {subscriptionParam === "cancelled" ? (
        <Alert tone="info">Trial checkout cancelled. No card was charged.</Alert>
      ) : null}
```
(Delete the three `license === "..."` alert blocks; the `license` param is no longer produced by the new flow. Leave `checkout`/`error` alerts as-is.)

(g) Replace the layout switch (lines 358-379) — swap `licensed`→`hasAccess` and `LicenseCta`→`SubscriptionCta`:
```tsx
        return hasAccess ? (
          <>
            {statsSection(false)}
            <section>
              <SubscriptionCta hasAccess={hasAccess} subscription={subscription} />
            </section>
            <section>
              <BalanceTopUpForm disabled={!canTopUp} />
            </section>
          </>
        ) : (
          <>
            <section>
              <SubscriptionCta hasAccess={hasAccess} subscription={subscription} />
            </section>
            {statsSection(true)}
            <section>
              <BalanceTopUpForm disabled={!canTopUp} />
            </section>
          </>
        );
```

(h) Update the "Need help?" copy (lines 447-449) — drop the money-back window wording:
```tsx
        <p className="text-sm text-muted-foreground">
          Questions about your account or billing? You can cancel anytime from
          Manage billing.{" "}
```

- [ ] **Step 5: Update the top-up form gating copy**

In `components/account/balance-top-up-form.tsx`, replace:
```tsx
                ? "A lifetime license is required to add credits."
```
with:
```tsx
                ? "Start your free trial to add credits."
```

- [ ] **Step 6: Delete the obsolete license CTA components**

```bash
git rm components/account/license-cta.tsx components/account/license-buy-button.tsx
```

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm build && pnpm lint`
Expected: compiles and lints clean. (Confirms no dangling `LicenseCta`/`createLicenseCheckoutSession` imports remain — `createLicenseCheckoutSession` is now unused but still exported from actions.ts, which is fine.)

- [ ] **Step 8: Commit**

```bash
git add app/account/page.tsx components/account/subscription-cta.tsx components/account/start-trial-button.tsx components/account/manage-billing-button.tsx components/account/balance-top-up-form.tsx
git commit -m "feat(account): trial-state CTA, start-trial + manage-billing, has_access"
```

---

## Task 10: Web — marketing copy (lead with trial, drop lifetime + guarantee)

**Files:**
- Modify: `app/pricing/page.tsx`
- Modify: `app/page.tsx`
- Modify: `components/checkout/checkout-result.tsx`

- [ ] **Step 1: Pricing hero**

In `app/pricing/page.tsx`, replace the `PricingHero` `<h1>`/`<p>` (lines 177-184):
```tsx
        <h1 className="mt-6 max-w-2xl text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-6xl">
          Try Woven free for 7 days.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Then $99/year — cancel anytime. Card required, $0 today, with $5 in
          hosted credits to start. Run models your way: bring your own keys, sign
          in with ChatGPT, or top up for Woven-hosted models.
        </p>
```

- [ ] **Step 2: Pricing plan card**

In `app/pricing/page.tsx`, replace `licenseBullets` (lines 191-197):
```tsx
  const licenseBullets = [
    "7 days free, then $99/year — cancel anytime",
    "Bring your own Anthropic and OpenAI keys",
    "Or sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan",
    "$5 in Woven-hosted credits to start",
    "Card required — we email you 3 days before your trial ends",
  ];
```
Replace the plan card header/price/description (lines 206-220):
```tsx
              <h2 className="text-lg font-semibold tracking-tight">Woven</h2>
              <p className="text-xs text-muted-foreground">7-day free trial</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
              Required
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold tracking-tight">$99</span>
            <span className="text-sm text-muted-foreground">/year</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Free for 7 days, then $99/year. Card required, $0 today. Includes $5
            in hosted credits to start. Cancel anytime before day 7.
          </p>
```
Replace the CTA link text (line 238):
```tsx
            Start your free trial
```

- [ ] **Step 3: Pricing JSON-LD + bottom CTA**

In `app/pricing/page.tsx`, replace the description string (line 21):
```tsx
    "Woven is a native macOS AI video editor. Try free for 7 days, then $99/year — cancel anytime. Includes $5 in hosted credits. Run any model your way: bring your own Anthropic/OpenAI keys, sign in with ChatGPT, or top up Woven-hosted credits at published per-model rates.",
```
Update the bottom CTA via two exact text replacements (leave all surrounding JSX/classNames untouched):
- Replace `Buy once. Use forever.` → `Try it free for 7 days.`
- Replace `$99 one-time, includes $5 in hosted credits, 7-day money-back guarantee.` → `Then $99/year, cancel anytime. $5 in hosted credits to start.`

- [ ] **Step 4: Home page copy**

In `app/page.tsx`, apply these **exact find→replace** pairs (each `find` string is unique in the file; surrounding JSX/attributes stay unchanged). The `price: "99.00"` structured-data value (line 182) stays — it's now the annual price.

Prose/FAQ/metadata strings:
- Find `"A $99 lifetime license unlocks the full app. Bring your own Anthropic and OpenAI keys, sign in with ChatGPT for GPT-5+ on your existing plan, or run Woven-hosted models on a prepaid balance — same lineup, no key juggling."`
  Replace `"Try Woven free for 7 days, then $99/year — cancel anytime. Bring your own Anthropic and OpenAI keys, sign in with ChatGPT for GPT-5+ on your existing plan, or run Woven-hosted models on a prepaid balance — same lineup, no key juggling."`
- Find `"Woven is a $99 one-time lifetime license — yours forever, no subscription. It includes $5 in hosted credits and a 7-day money-back guarantee. After that, bring your own provider keys, sign in with ChatGPT (GPT-5+ on your existing plan), or top up a prepaid balance for Woven-hosted models."`
  Replace `"Woven is a 7-day free trial, then $99/year — cancel anytime, card required. It includes $5 in hosted credits. Bring your own provider keys, sign in with ChatGPT (GPT-5+ on your existing plan), or top up a prepaid balance for Woven-hosted models."`
- Find `"Yes. Sign in once with Google and get a $99 lifetime license. After that, run with your own Anthropic and OpenAI keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance."`
  Replace `"Yes. Sign in once with Google and start a 7-day free trial ($99/year after). Then run with your own Anthropic and OpenAI keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance."`
- Find `"Yes. With your lifetime license, run Woven with the keys you provide — you pay providers directly at their rates and Woven takes nothing extra for inference."`
  Replace `"Yes. On any active plan, run Woven with the keys you provide — you pay providers directly at their rates and Woven takes nothing extra for inference."`
- Find `"Woven is the AI Video Editor. A native macOS app to script, edit, and assemble short-form video by asking. A $99 one-time lifetime license; bring your own provider keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance."`
  Replace `"Woven is the AI Video Editor. A native macOS app to script, edit, and assemble short-form video by asking. Try free for 7 days, then $99/year; bring your own provider keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance."`

Pricing section JSX text (lines ~470-521):
- Find `One price. Yours forever.` → Replace `Try it free for 7 days.`
- Find `Lifetime license` (the `<h3>` on line 483) → Replace `Woven`
- Find `One-time — yours forever` → Replace `7-day free trial`
- Find `<span className="text-sm text-background/70">once</span>` → Replace `<span className="text-sm text-background/70">/year</span>`
- Find the description (lines 500-501):
  ```
              The full Woven app on your Mac, forever. Includes $5 in hosted
              credits to start. 7-day money-back guarantee.
  ```
  Replace:
  ```
              The full Woven app on your Mac. Free for 7 days, then $99/year.
              Includes $5 in hosted credits to start.
  ```
- Find `<BulletItem inverse>Lifetime access — no subscription</BulletItem>` → Replace `<BulletItem inverse>7 days free, then $99/year — cancel anytime</BulletItem>`
- Find `<BulletItem inverse>$5 in Woven-hosted credits included</BulletItem>` → Replace `<BulletItem inverse>$5 in Woven-hosted credits to start</BulletItem>`
- Find `<BulletItem inverse>7-day money-back guarantee</BulletItem>` → Replace `<BulletItem inverse>Card required — we email you 3 days before your trial ends</BulletItem>`
- Find `Get your license — $99` → Replace `Start your free trial`

- [ ] **Step 5: Checkout result page**

In `components/checkout/checkout-result.tsx`, replace the `success` copy (lines 9-17):
```tsx
  success: {
    Icon: CheckCircle2Icon,
    iconClass: "text-emerald-500",
    headline: "Your free trial is live.",
    body:
      "You have full access to Woven for the next 7 days, and $5 in hosted credits have been added to your balance. You won't be charged until your trial ends.",
    backToApp:
      "Head back to the Woven app — it'll unlock automatically. You can close this tab.",
  },
```

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm build && pnpm lint`
Expected: compiles and lints clean.

- [ ] **Step 7: Commit**

```bash
git add app/pricing/page.tsx app/page.tsx components/checkout/checkout-result.tsx
git commit -m "feat(marketing): lead with 7-day free trial; drop lifetime + money-back copy"
```

---

## Task 11: Ops checklist + end-to-end verification

These are **manual operator steps** (Stripe Dashboard, Loops, Supabase secrets) — no code. Do them in a **test-mode** Stripe account first.

- [ ] **Step 1: Stripe — create the recurring Price**
  - Product "Woven" → add a **recurring** Price: `$99.00 / year`, currency USD.
  - Copy the `price_...` id into `STRIPE_SUBSCRIPTION_PRICE_ID` (local `.env` and Vercel + Supabase function env).

- [ ] **Step 2: Stripe — enable the Customer Portal**
  - Settings → Billing → Customer portal: allow **cancel subscription** and **update payment method**. Save.

- [ ] **Step 3: Stripe — configure failed-payment handling (dunning)**
  - Settings → Billing → Subscriptions and emails → manage failed payments: enable Smart Retries; set the post-retry action to **cancel** the subscription. (Our webhook reacts to the resulting `customer.subscription.updated`/`deleted` status.)

- [ ] **Step 4: Stripe — register webhook events**
  - Add/confirm the production webhook endpoint (`.../functions/v1/stripe-webhook`) subscribes to: `checkout.session.completed`, `charge.refunded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_failed`.

- [ ] **Step 5: Loops — create automations**
  - New automations triggered by events `trial_ending`, `payment_failed`, `subscription_paid` with the corresponding email templates. (Event names must match the webhook exactly.)

- [ ] **Step 6: Secrets**
  - `supabase secrets set STRIPE_SUBSCRIPTION_PRICE_ID=price_... LOOPS_API_KEY=lo_...` for deployed functions (LOOPS so the webhook can email).

- [ ] **Step 7: End-to-end test (Stripe test mode + test clock)**
  - Start a trial from `/account` → Stripe Checkout with a test card → `$0` charged, redirected to `/account?subscription=trialing`.
  - Confirm: a `subscriptions` row exists with `status=trialing`; the account page shows "Free trial active · ends <date>"; balance shows `+$5`.
  - Use a Stripe **test clock** to advance past 7 days → `invoice.paid` → row flips to `active`; advance with a declining test card (`4000000000000341`) → `past_due`, `payment_failed` event fires, access continues during grace.
  - From "Manage billing," cancel during a fresh trial → `cancel_at_period_end=true`, no charge.

- [ ] **Step 8: Final full build + lint**

Run: `pnpm build && pnpm lint`
Expected: clean.

- [ ] **Step 9: Release**
  - Use the **release-woven-web** skill (it handles code + DB migrations + new env vars to production safely). New env: `STRIPE_SUBSCRIPTION_PRICE_ID`; new function `create-portal-session`; new migration `20260607120000_create_subscriptions.sql`.

---

## Notes / out of scope

- **Desktop app (separate repo):** must add the "Start free trial" entry, show days-remaining, and call the `has_access` contract (the API still returns `403 license_required` when gated — error code intentionally unchanged). Not part of this plan.
- **Trial abuse** via throwaway Google accounts: not addressed (card-required is the deterrent; pre-launch). Revisit if it appears.
- **Legacy license paths** (`purpose:"license"` checkout branch, `checkout.session.completed`/`charge.refunded` license handlers, `licenses` table, grandfather cutoff) are intentionally left intact for the 13 grandfathered users and refund history.
