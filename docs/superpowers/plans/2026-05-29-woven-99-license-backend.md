# Woven $99 License — Backend (woven-video) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a $99 one-time lifetime-license entitlement (with a bundled $5 hosted-credit bonus, a 7-day money-back→revoke flow, and grandfathering of all existing users) to the `woven-video` Supabase/Stripe/Next.js backend — shippable on its own and non-breaking, with the hard-enforcement 403 gate written but deploy-gated off until the harness ships.

**Architecture:** A new `public.licenses` table is the entitlement store, kept entirely separate from the USD credit ledger. It clones the ledger's idempotency (`unique(source, source_id)`), RLS (read-own, service-role-write), and `security definer` RPC conventions. The single existing Stripe `create-checkout-session` Edge Function gains a `purpose` switch (`license` vs `topup`); the single `stripe-webhook` branches on `metadata.purpose` to either grant a license (+ $5 promo credits) or top up, and revokes on `charge.refunded`. The harness reads license state from an additive `license` field on the existing `GET /api/v1/billing/balance`. A shared `licenseGateResponse()` helper enforces a `403 license_required` on hosted routes, behind the `WOVEN_ENFORCE_LICENSE` env flag (default off).

**Tech Stack:** Next.js 16 (App Router, React 19), Supabase (Postgres + RLS + `security definer` RPCs, Deno Edge Functions), Stripe (Checkout `mode: payment`, Products/Prices, webhooks), TypeScript, Tailwind 4 / shadcn.

**Scope:** `woven-video` only. All `woven-harness` (Swift) work — the paywall UI, tri-state gate, `ChatView` guard, offline cache — is a **separate** plan. See spec §4. Spec: `docs/superpowers/specs/2026-05-29-woven-99-license-design.md`.

## Testing approach (read first)

This repo has **no unit-test harness** (only `eslint`; no vitest/jest/playwright). Per "follow existing patterns," this plan does **not** introduce one. Verification per task uses what the repo actually supports:

- **Types:** `pnpm exec tsc --noEmit` (and/or `pnpm build`) — must pass clean.
- **Lint:** `pnpm lint` — must pass clean.
- **SQL / RPCs:** `supabase db reset` (applies all migrations) then a **transactional assertion script** run with `psql` against the local DB (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) — asserts via `raise exception`, then `rollback` so nothing persists.
- **Edge functions:** `supabase functions serve --env-file .env.local` + the **Stripe CLI** (`stripe listen`, `stripe trigger`) and `curl`.
- **Next routes:** `pnpm dev` + `curl` with a real Supabase bearer token, asserting status codes / JSON shape.

Local stack assumed running: `supabase start` (see `docs/billing-architecture.md`). Set `DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'` in your shell for the SQL steps.

---

## File structure

**Create:**
- `supabase/migrations/20260529120000_create_licenses.sql` — table, indexes, RLS, grants, `grant_license` / `revoke_license` / `has_active_license` RPCs.
- `supabase/migrations/20260529130000_grandfather_backfill.sql` — one-time idempotent backfill (placeholder cutoff; push only after cutoff).
- `lib/api/license.ts` — shared `licenseGateResponse(auth)` helper (deploy-gated 403).
- `components/account/license-cta.tsx` — license status / "Buy lifetime license" CTA for `/account`.

**Modify:**
- `supabase/functions/create-checkout-session/index.ts` — `purpose` switch + `license` branch + pre-check.
- `supabase/functions/stripe-webhook/index.ts` — `purpose` branch + $5 bonus + `charge.refunded` revoke.
- `app/api/v1/billing/balance/route.ts` — add additive `license` field.
- `app/api/v1/chat/completions/route.ts` — insert license gate after auth.
- `app/api/v1/web/search/route.ts` — insert license gate after auth.
- `app/api/v1/web/fetch/route.ts` — insert license gate after auth.
- `app/api/v1/reel-captions/jobs/route.ts` — insert license gate after auth (POST only).
- `app/account/actions.ts` — add `createLicenseCheckoutSession` server action.
- `app/account/page.tsx` — render `<LicenseCta>` + handle `?license=success`.
- `app/pricing/page.tsx` — retire free tier; reframe as $99 license (+$5, 7-day) + optional credits.
- `.env.example` — add `STRIPE_LICENSE_PRICE_ID`, `WOVEN_ENFORCE_LICENSE`.

---

## Task 1: `licenses` table + RPCs (migration)

**Files:**
- Create: `supabase/migrations/20260529120000_create_licenses.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260529120000_create_licenses.sql` with exactly:

```sql
-- Lifetime license entitlement. Separate from the credit ledger.
-- Clones ledger idempotency (unique source/source_id), RLS, and security-definer conventions.

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'lifetime' check (kind in ('lifetime')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  source text not null,            -- 'stripe' | 'grandfather'
  source_id text not null,         -- stripe: payment_intent id; grandfather: user_id::text
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason in ('refund', 'dispute', 'admin')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id),
  check ((status = 'revoked') = (revoked_at is not null))
);

-- A user can never hold two ACTIVE licenses.
create unique index licenses_one_active_per_user
  on public.licenses(user_id) where status = 'active';
create index licenses_user_idx on public.licenses(user_id);

create trigger set_licenses_updated_at
before update on public.licenses
for each row execute function public.set_updated_at();

-- ---------- RPCs ----------

create or replace function public.grant_license(
  p_user_id uuid,
  p_source text,
  p_source_id text,
  p_kind text default 'lifetime',
  p_metadata jsonb default '{}'::jsonb
)
returns public.licenses
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing public.licenses%rowtype;
  v_row public.licenses%rowtype;
begin
  if p_source is null or length(trim(p_source)) = 0 then
    raise exception 'license_source_required';
  end if;
  if p_source_id is null or length(trim(p_source_id)) = 0 then
    raise exception 'license_source_id_required';
  end if;

  -- Replay / tombstone: a row for this exact (source, source_id) is returned unchanged.
  -- This is what makes an out-of-order refund-before-grant safe: a 'revoked' tombstone
  -- is returned and is NOT reactivated.
  select * into v_existing
  from public.licenses
  where source = p_source and source_id = p_source_id;

  if v_existing.id is not null then
    return v_existing;
  end if;

  begin
    insert into public.licenses (user_id, kind, status, source, source_id, metadata)
    values (p_user_id, p_kind, 'active', p_source, p_source_id, coalesce(p_metadata, '{}'::jsonb))
    returning * into v_row;
  exception
    when unique_violation then
      -- A different (source, source_id) but the user already holds an active license
      -- (partial unique index fired). Return their existing active row; do not insert.
      select * into v_row
      from public.licenses
      where user_id = p_user_id and status = 'active'
      limit 1;
  end;

  return v_row;
end;
$$;

create or replace function public.revoke_license(
  p_source text,
  p_source_id text,
  p_user_id uuid default null,
  p_reason text default 'refund',
  p_metadata jsonb default '{}'::jsonb
)
returns public.licenses
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.licenses%rowtype;
begin
  if p_source is null or length(trim(p_source)) = 0 then
    raise exception 'license_source_required';
  end if;
  if p_source_id is null or length(trim(p_source_id)) = 0 then
    raise exception 'license_source_id_required';
  end if;
  if p_reason not in ('refund', 'dispute', 'admin') then
    raise exception 'invalid_revoke_reason';
  end if;

  select * into v_row
  from public.licenses
  where source = p_source and source_id = p_source_id
  for update;

  if v_row.id is not null then
    if v_row.status = 'revoked' then
      return v_row;  -- idempotent no-op
    end if;
    update public.licenses
    set status = 'revoked',
        revoked_at = now(),
        revoke_reason = p_reason,
        metadata = coalesce(p_metadata, '{}'::jsonb) || metadata
    where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  -- No row yet: refund/dispute arrived before the grant. Write a 'revoked' tombstone
  -- keyed on (source, source_id) so the later grant_license collides and does NOT activate.
  if p_user_id is null then
    raise exception 'license_user_id_required_for_tombstone';
  end if;

  insert into public.licenses (user_id, status, source, source_id, granted_at, revoked_at, revoke_reason, metadata)
  values (p_user_id, 'revoked', p_source, p_source_id, now(), now(), p_reason, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.has_active_license()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.licenses
    where user_id = auth.uid() and status = 'active'
  );
$$;

-- ---------- RLS + grants ----------

alter table public.licenses enable row level security;

create policy "Users can read own licenses"
on public.licenses
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.licenses from anon, authenticated;
grant select on public.licenses to authenticated;   -- read-own ONLY; no insert/update/delete => cannot self-grant
grant all on public.licenses to service_role;

revoke all on function public.grant_license(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.revoke_license(text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.has_active_license() from public, anon;

grant execute on function public.grant_license(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.revoke_license(text, text, uuid, text, jsonb) to service_role;
grant execute on function public.has_active_license() to authenticated, service_role;
```

- [ ] **Step 2: Apply migrations locally**

Run: `supabase db reset`
Expected: completes without error; output lists `20260529120000_create_licenses.sql` applied.

- [ ] **Step 3: Write the transactional assertion script**

Create a scratch file `/tmp/licenses_check.sql` (not committed):

```sql
begin;
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000',
        '11111111-1111-1111-1111-111111111111',
        'authenticated', 'authenticated', 'lic-test@example.com', now(), now());

do $$
declare r public.licenses%rowtype; n int;
begin
  -- grant is active
  r := public.grant_license('11111111-1111-1111-1111-111111111111', 'stripe', 'pi_1');
  if r.status <> 'active' then raise exception 'FAIL: first grant not active'; end if;

  -- replay returns same row, no duplicate
  r := public.grant_license('11111111-1111-1111-1111-111111111111', 'stripe', 'pi_1');
  select count(*) into n from public.licenses where user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 1 then raise exception 'FAIL: replay duplicated (n=%)', n; end if;

  -- a different payment_intent for an already-active user returns existing active, no new active row
  r := public.grant_license('11111111-1111-1111-1111-111111111111', 'stripe', 'pi_2');
  select count(*) into n from public.licenses
    where user_id = '11111111-1111-1111-1111-111111111111' and status = 'active';
  if n <> 1 then raise exception 'FAIL: second active license created (n=%)', n; end if;

  -- revoke by payment_intent
  r := public.revoke_license('stripe', 'pi_1', '11111111-1111-1111-1111-111111111111', 'refund');
  if r.status <> 'revoked' or r.revoked_at is null then raise exception 'FAIL: revoke did not tombstone'; end if;

  -- revoke is idempotent
  r := public.revoke_license('stripe', 'pi_1', '11111111-1111-1111-1111-111111111111', 'refund');
  if r.status <> 'revoked' then raise exception 'FAIL: revoke not idempotent'; end if;

  -- refund-before-grant: tombstone, then a late grant does NOT activate
  r := public.revoke_license('stripe', 'pi_3', '11111111-1111-1111-1111-111111111111', 'refund');
  if r.status <> 'revoked' then raise exception 'FAIL: pre-grant tombstone not revoked'; end if;
  r := public.grant_license('11111111-1111-1111-1111-111111111111', 'stripe', 'pi_3');
  if r.status <> 'revoked' then raise exception 'FAIL: late grant reactivated a refunded charge'; end if;

  raise notice 'ALL LICENSE RPC ASSERTIONS PASSED';
end $$;
rollback;
```

- [ ] **Step 4: Run the assertion script**

Run: `psql "$DB_URL" -f /tmp/licenses_check.sql`
Expected: `NOTICE: ALL LICENSE RPC ASSERTIONS PASSED` and `ROLLBACK`. No `FAIL:` lines.

- [ ] **Step 5: Verify a user cannot self-grant (RLS)**

Run:
```bash
psql "$DB_URL" -c "set role authenticated; insert into public.licenses (user_id, source, source_id) values (gen_random_uuid(), 'stripe', 'pi_hack');"
```
Expected: `ERROR: permission denied for table licenses` (authenticated has SELECT only). Reset role with `psql "$DB_URL" -c "reset role;"`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260529120000_create_licenses.sql
git commit -m "feat(db): licenses table + grant/revoke/has_active_license RPCs"
```

---

## Task 2: Grandfather backfill (migration, deploy-deferred)

**Files:**
- Create: `supabase/migrations/20260529130000_grandfather_backfill.sql`

> This migration is written now but **pushed to prod only after the launch cutoff instant has passed** (rollout step 6). Locally it is harmless: with the placeholder far-future cutoff it grandfathers all local users.

- [ ] **Step 1: Write the backfill migration**

Create `supabase/migrations/20260529130000_grandfather_backfill.sql`:

```sql
-- One-time, idempotent grandfather backfill: every user created BEFORE the launch
-- cutoff gets a free lifetime license. Re-runs are no-ops (on conflict do nothing).
-- IMPORTANT: push this to prod only AFTER the cutoff instant has passed, so no
-- eligible row can be created between the SELECT and the cutoff.
--
-- TODO(launch): replace the placeholder below with the real launch instant (UTC).
-- The placeholder grandfathers everyone, which is correct for local/staging.

insert into public.licenses (user_id, kind, status, source, source_id, granted_at, metadata)
select
  u.id,
  'lifetime',
  'active',
  'grandfather',
  u.id::text,
  now(),
  jsonb_build_object('reason', 'pre_launch_grandfather')
from auth.users u
where u.created_at < '2099-01-01T00:00:00Z'::timestamptz   -- TODO(launch): set real cutoff
on conflict (source, source_id) do nothing;
```

- [ ] **Step 2: Apply and verify idempotency**

Run: `supabase db reset`
Then:
```bash
psql "$DB_URL" -c "select count(*) as licenses, (select count(*) from auth.users) as users from public.licenses where source='grandfather';"
```
Expected: `licenses` equals `users` (every local user grandfathered). Re-running `supabase db reset` keeps counts equal (no duplicates) because of `on conflict do nothing`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260529130000_grandfather_backfill.sql
git commit -m "feat(db): grandfather backfill for pre-launch users (deploy after cutoff)"
```

---

## Task 3: Stripe $99 Product/Price + env + webhook event registration

**Files:**
- Modify: `.env.example`

> Config task — no app code. Do this in the Stripe **test** account first; repeat in **live** at launch.

- [ ] **Step 1: Create the $99 Product + Price (Stripe CLI)**

Run (test mode):
```bash
stripe products create --name "Woven Lifetime License" \
  --description "One-time lifetime license to use Woven. Includes \$5 in hosted credits."
# note the returned product id (prod_...), then:
stripe prices create --product prod_XXX --currency usd --unit-amount 9900
```
Expected: a `price_...` id. (Equivalent to Dashboard → Products → add a one-time price of $99.00 USD.)

- [ ] **Step 2: Set the price id in local env**

Add to `.env.local` (not committed): `STRIPE_LICENSE_PRICE_ID=price_XXX`.
For Supabase Functions, ensure the same key is in the env file passed to `supabase functions serve --env-file .env.local`.

- [ ] **Step 3: Document the new env vars**

Add to `.env.example` (after `STRIPE_WEBHOOK_SECRET`):

```bash
# Stripe Price id for the $99 one-time lifetime license (separate test vs live values).
STRIPE_LICENSE_PRICE_ID=price_xxx
# Server-side hosted-route license enforcement. Keep "false" until the license-aware
# harness build has adoption; flip to "true" to start returning 403 license_required.
WOVEN_ENFORCE_LICENSE=false
```

- [ ] **Step 4: Register `charge.refunded` on the prod webhook endpoint**

In the Stripe Dashboard → Developers → Webhooks → the woven endpoint, add events `checkout.session.completed` (already present) and **`charge.refunded`**. (An unregistered event is silently never delivered.) For local testing, `stripe listen` forwards all events automatically.

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "chore(env): add STRIPE_LICENSE_PRICE_ID and WOVEN_ENFORCE_LICENSE"
```

---

## Task 4: Webhook — `purpose` branch, $5 bonus, refund→revoke

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`

- [ ] **Step 1: Replace the webhook with the branched version**

Overwrite `supabase/functions/stripe-webhook/index.ts` with:

```ts
import Stripe from "stripe";

import {
  errorResponse,
  HttpError,
  jsonResponse,
  requiredEnv,
} from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const USD_MICROS_PER_CENT = 10_000;
const LICENSE_BONUS_USD_MICROS = 5_000_000; // $5 starter credits bundled with a paid license

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2026-04-22.dahlia",
    });
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      throw new HttpError(400, "missing_stripe_signature");
    }

    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      requiredEnv("STRIPE_WEBHOOK_SECRET"),
    );

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(
        stripe,
        event.data.object as Stripe.Checkout.Session,
      );
    } else if (event.type === "charge.refunded") {
      await handleChargeRefunded(stripe, event.data.object as Stripe.Charge);
    }

    return jsonResponse({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
});

async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return;
  }

  const admin = createServiceClient();
  const userId = session.metadata?.user_id ?? session.client_reference_id;
  const purpose = session.metadata?.purpose ?? "topup";

  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id;

  if (customerId && userId) {
    const { error: profileError } = await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", userId);

    if (profileError) {
      throw new HttpError(500, "failed_to_store_stripe_customer", profileError);
    }
  }

  // ---- LICENSE purchase (must be handled BEFORE any amount parsing) ----
  if (purpose === "license") {
    if (!userId) {
      throw new HttpError(400, "license_session_missing_user");
    }
    // payment_intent must be a real string so the grant key == the refund-lookup key.
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : null;

    if (!paymentIntentId) {
      throw new HttpError(400, "license_session_missing_payment_intent");
    }

    const { error: licenseError } = await admin.rpc("grant_license", {
      p_user_id: userId,
      p_source: "stripe",
      p_source_id: paymentIntentId,
      p_metadata: {
        checkout_session_id: session.id,
        payment_intent_id: paymentIntentId,
      },
    });

    if (licenseError) {
      throw new HttpError(500, "failed_to_grant_license", licenseError);
    }

    // Bundled $5 starter credits — idempotent on (source, source_id, kind).
    const { error: bonusError } = await admin.rpc("grant_balance", {
      p_user_id: userId,
      p_amount_usd_micros: LICENSE_BONUS_USD_MICROS,
      p_source: "license_bonus",
      p_source_id: paymentIntentId,
      p_kind: "promo",
      p_metadata: { reason: "license_bonus", payment_intent_id: paymentIntentId },
    });

    if (bonusError) {
      throw new HttpError(500, "failed_to_grant_license_bonus", bonusError);
    }

    return;
  }

  // ---- TOPUP (existing behavior; legacy sessions with no purpose land here) ----
  const topUpId = session.metadata?.top_up_id ?? session.metadata?.pack_id;
  const amountCents = Number(
    session.metadata?.amount_cents ?? session.amount_total,
  );
  const amountUsdMicros = amountCents * USD_MICROS_PER_CENT;

  if (!userId || !Number.isInteger(amountCents) || amountCents <= 0) {
    throw new HttpError(400, "checkout_session_missing_balance_metadata");
  }

  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.id;

  const { error } = await admin.rpc("grant_balance", {
    p_user_id: userId,
    p_amount_usd_micros: amountUsdMicros,
    p_source: "stripe",
    p_source_id: paymentIntentId,
    p_kind: "purchase",
    p_metadata: {
      checkout_session_id: session.id,
      payment_intent_id: paymentIntentId,
      top_up_id: topUpId,
      amount_cents: amountCents,
      amount_usd_micros: amountUsdMicros,
      amount_total: session.amount_total,
      currency: session.currency,
    },
  });

  if (error) {
    throw new HttpError(500, "failed_to_grant_balance", error);
  }
}

async function handleChargeRefunded(stripe: Stripe, charge: Stripe.Charge) {
  // Only a FULL refund of a LICENSE charge revokes the license. Partial refunds and
  // top-up refunds are no-ops here (no credit clawback).
  if (charge.amount_refunded !== charge.amount) {
    return;
  }

  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : null;

  if (!paymentIntentId) {
    return;
  }

  // PaymentIntent metadata carries purpose + user_id (set at checkout creation).
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.metadata?.purpose !== "license") {
    return;
  }
  const userId = pi.metadata?.user_id;

  const admin = createServiceClient();
  const { error } = await admin.rpc("revoke_license", {
    p_source: "stripe",
    p_source_id: paymentIntentId,
    p_user_id: userId ?? null,
    p_reason: "refund",
    p_metadata: { charge_id: charge.id, payment_intent_id: paymentIntentId },
  });

  if (error) {
    throw new HttpError(500, "failed_to_revoke_license", error);
  }
}
```

- [ ] **Step 2: Serve functions + listen for Stripe events**

In two terminals:
```bash
supabase functions serve --env-file .env.local
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
```
Copy the `whsec_...` from `stripe listen` into `.env.local` as `STRIPE_WEBHOOK_SECRET` and restart `functions serve`.

- [ ] **Step 3: Verify a license `checkout.session.completed` grants a license + $5 (not $99 credits)**

The cleanest end-to-end check is via Task 5's checkout (do Task 5 first if iterating). For an isolated webhook check, drive a real test purchase after Task 5, then assert in SQL:
```bash
psql "$DB_URL" -c "select status, source from public.licenses order by created_at desc limit 1;"
psql "$DB_URL" -c "select kind, source, amount_usd_micros from public.ledger_entries where source='license_bonus' order by created_at desc limit 1;"
```
Expected: one `active`/`stripe` license; one `promo`/`license_bonus` ledger entry of `5000000`. **No** `purchase` entry of `9900*10000` for that payment_intent.

- [ ] **Step 4: Type-check the function**

Run: `deno check supabase/functions/stripe-webhook/index.ts` (if Deno installed) or rely on `supabase functions serve` starting without error.
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(stripe): webhook branches license vs topup, grants \$5 bonus, revokes on refund"
```

---

## Task 5: Checkout function — `purpose` switch + license branch

**Files:**
- Modify: `supabase/functions/create-checkout-session/index.ts`

- [ ] **Step 1: Add a license branch to the checkout function**

In `supabase/functions/create-checkout-session/index.ts`, inside `Deno.serve`'s `try` block, **after** `const user = await requireAuthenticatedUser(req);` and `const body = await req.json().catch(() => ({}));`, insert the license branch **before** the existing top-up parsing (`const topUp = getTopUpFromBody(body);`):

```ts
    const admin = createServiceClient();
    const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2026-04-22.dahlia",
    });
    const siteUrl = Deno.env.get("WOVEN_SITE_URL") ?? "http://localhost:3000";

    const ensureResult = await admin.rpc("ensure_billing_account", {
      p_user_id: user.id,
    });
    if (ensureResult.error) {
      throw new HttpError(500, "failed_to_ensure_billing_account", ensureResult.error);
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("email, stripe_customer_id")
      .eq("id", user.id)
      .single();
    if (profileError) {
      throw new HttpError(500, "failed_to_load_profile", profileError);
    }

    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email ?? user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      const { error: updateError } = await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
      if (updateError) {
        throw new HttpError(500, "failed_to_store_stripe_customer", updateError);
      }
    }

    // ---- LICENSE checkout ----
    if (body.purpose === "license") {
      const { data: existing, error: existingError } = await admin
        .from("licenses")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      if (existingError) {
        throw new HttpError(500, "failed_to_check_license", existingError);
      }
      if (existing) {
        return jsonResponse({ alreadyLicensed: true });
      }

      const licenseMetadata = { user_id: user.id, purpose: "license" };
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        client_reference_id: user.id,
        payment_method_types: ["card"],
        line_items: [
          { price: requiredEnv("STRIPE_LICENSE_PRICE_ID"), quantity: 1 },
        ],
        metadata: licenseMetadata,
        payment_intent_data: { metadata: licenseMetadata },
        success_url: `${siteUrl}/account?license=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/account?license=cancelled`,
      });

      return jsonResponse({ url: session.url });
    }
```

Then in the **existing** top-up path that follows, **remove the now-duplicated** `admin`, `stripe`, `siteUrl`, `ensure_billing_account`, profile-load, and customer-create blocks (they were hoisted above) — keep from `const topUp = getTopUpFromBody(body);` onward, and set `topup`-classifying metadata. Update the top-up `metadata` object to include `purpose: "topup"`:

```ts
    const topUp = getTopUpFromBody(body);

    if (!topUp || topUp.amountCents < MIN_TOP_UP_CENTS || topUp.amountCents > MAX_TOP_UP_CENTS) {
      throw new HttpError(400, "invalid_top_up_amount");
    }

    // No credit purchase without a license. Same flag as the hosted-route gate, so
    // this is a no-op pre-launch and during the deploy->backfill window.
    if (Deno.env.get("WOVEN_ENFORCE_LICENSE") === "true") {
      const { data: licenseRow, error: licenseCheckError } = await admin
        .from("licenses")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      if (licenseCheckError) {
        throw new HttpError(500, "failed_to_check_license", licenseCheckError);
      }
      if (!licenseRow) {
        throw new HttpError(403, "license_required");
      }
    }

    const metadata = {
      user_id: user.id,
      purpose: "topup",
      top_up_id: topUp.topUpId,
      amount_cents: String(topUp.amountCents),
      amount_usd_micros: String(topUp.amountCents * USD_MICROS_PER_CENT),
      currency: "usd",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Add $${formatUsd(topUp.amountCents)} to Woven balance` },
            unit_amount: topUp.amountCents,
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${siteUrl}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/account?checkout=cancelled`,
    });

    return jsonResponse({ url: session.url });
```

(Net effect: `body.purpose` defaults to top-up; the shared auth/customer setup runs once for both paths.)

- [ ] **Step 2: Restart functions serve and get a test bearer token**

With `supabase functions serve --env-file .env.local` running, obtain a local user access token (sign in once at `http://localhost:3000/login` and copy the `access_token` from the Supabase session cookie, or mint one via `supabase` admin). Export it: `export TOKEN='<access_token>'`.

- [ ] **Step 3: Verify the license checkout returns a URL (or alreadyLicensed)**

Run:
```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/create-checkout-session \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"purpose":"license"}'
```
Expected: `{"url":"https://checkout.stripe.com/..."}` for an unlicensed user, or `{"alreadyLicensed":true}` if they already hold a license (e.g. a grandfathered local user — temporarily revoke locally to test the URL path).

- [ ] **Step 4: Verify top-up still works unchanged**

Run:
```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/create-checkout-session \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"amountCents":2000}'
```
Expected: `{"url":"https://checkout.stripe.com/..."}` with the flag off. With `WOVEN_ENFORCE_LICENSE=true` (restart `functions serve` with it set) and a locally-revoked user, the same call returns a 403 `{"error":"license_required"}` — no credit purchase without a license.

- [ ] **Step 5: Full end-to-end (with Stripe test card)**

Open the license `url`, pay with `4242 4242 4242 4242`. Then run the SQL asserts from Task 4 Step 3.
Expected: active license + $5 promo credit; redirected to `/account?license=success`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/create-checkout-session/index.ts
git commit -m "feat(stripe): create-checkout-session supports purpose=license (\$99, card-only)"
```

---

## Task 6: Add `license` to the balance endpoint

**Files:**
- Modify: `app/api/v1/billing/balance/route.ts`

- [ ] **Step 1: Add an additive `license` field**

Replace the body of `GET` in `app/api/v1/billing/balance/route.ts` with:

```ts
import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const supabase = authResult.auth.supabase;

  const { data, error } = await supabase.rpc("get_billing_balance");

  if (error) {
    return apiError(error.message, 500, "balance_lookup_failed");
  }

  const row = Array.isArray(data) ? data[0] : null;
  const balanceUsdMicros = Number(row?.balance_usd_micros ?? 0);

  // Additive license object. RLS-scoped read of the user's own license.
  // Omit the field on a read error so the client falls back to its own cache
  // (fail-open within its grace window) rather than us asserting a state.
  let license: { active: boolean; granted_at: string | null } | undefined;
  const { data: licenseRow, error: licenseError } = await supabase
    .from("licenses")
    .select("granted_at")
    .eq("status", "active")
    .maybeSingle();

  if (!licenseError) {
    license = {
      active: licenseRow !== null,
      granted_at: licenseRow?.granted_at ?? null,
    };
  }

  return Response.json({
    currency: row?.currency ?? "usd",
    balance_usd_micros: balanceUsdMicros,
    balance_usd: balanceUsdMicros / 1_000_000,
    ...(license ? { license } : {}),
  });
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the field is present and correct**

With `pnpm dev` running and `$TOKEN` set:
```bash
curl -s http://localhost:3000/api/v1/billing/balance -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
Expected (grandfathered local user): includes `"license": {"active": true, "granted_at": "..."}` alongside the existing balance fields.

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/billing/balance/route.ts
git commit -m "feat(api): billing/balance returns additive license status"
```

---

## Task 7: License gate helper + wire into hosted routes (deploy-gated)

**Files:**
- Create: `lib/api/license.ts`
- Modify: `app/api/v1/chat/completions/route.ts`, `app/api/v1/web/search/route.ts`, `app/api/v1/web/fetch/route.ts`, `app/api/v1/reel-captions/jobs/route.ts`

- [ ] **Step 1: Write the shared gate helper**

Create `lib/api/license.ts`:

```ts
import type { ApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";

/**
 * Returns a 403 license_required Response if the authed user has no active license,
 * or null to proceed. Deploy-gated: when WOVEN_ENFORCE_LICENSE !== "true" this is a
 * no-op (returns null) so the code can ship before the license-aware harness has
 * adoption. Fails OPEN on any infra/DB error — a transient failure must never wrongly
 * lock out a licensed user.
 */
export async function licenseGateResponse(auth: ApiAuth): Promise<Response | null> {
  if (process.env.WOVEN_ENFORCE_LICENSE !== "true") {
    return null;
  }

  const { data, error } = await auth.supabase.rpc("has_active_license");

  if (error) {
    console.error("has_active_license check failed (failing open):", error.message);
    return null;
  }

  if (data === true) {
    return null;
  }

  return apiError(
    "A Woven license is required to use hosted models.",
    403,
    "license_required",
  );
}
```

- [ ] **Step 2: Gate `chat/completions`**

In `app/api/v1/chat/completions/route.ts`: add the import near the other `@/lib/api` imports:

```ts
import { licenseGateResponse } from "@/lib/api/license";
```

Then in `POST`, immediately **after** the `if (!authResult.ok) { return authResult.response; }` block and **before** `const payload = await request.json()...`, insert:

```ts
  const licenseError = await licenseGateResponse(authResult.auth);
  if (licenseError) {
    return licenseError;
  }
```

- [ ] **Step 3: Gate `web/search` and `web/fetch`**

In each of `app/api/v1/web/search/route.ts` and `app/api/v1/web/fetch/route.ts`: add `import { licenseGateResponse } from "@/lib/api/license";` and, right after `if (!authResult.ok) return authResult.response;`, insert:

```ts
  const licenseError = await licenseGateResponse(authResult.auth);
  if (licenseError) return licenseError;
```

- [ ] **Step 4: Gate `reel-captions/jobs` (POST only — admission time)**

In `app/api/v1/reel-captions/jobs/route.ts`: add the import, and right after the `POST`'s `if (!authResult.ok) return authResult.response;`, insert the same two lines as Step 3. **Do not** gate `[jobId]/process/route.ts` or `[jobId]/route.ts` — in-flight jobs must finish (spec §8).

- [ ] **Step 5: Type-check + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Verify gate is OFF by default (no 403)**

With `pnpm dev` (and `WOVEN_ENFORCE_LICENSE` unset/false), and `$TOKEN` for a user you've locally revoked (`psql "$DB_URL" -c "update public.licenses set status='revoked', revoked_at=now(), revoke_reason='admin' where user_id='<id>';"`):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/v1/web/search \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"query":"test"}'
```
Expected: **not** 403 (e.g. 200 or a 503 exa-not-configured) — enforcement is off.

- [ ] **Step 7: Verify gate returns 403 when ON**

Stop `pnpm dev`, restart with `WOVEN_ENFORCE_LICENSE=true pnpm dev`, repeat the curl from Step 6 for the revoked user.
Expected: `403`. Body: `{"error":{"message":"A Woven license is required to use hosted models.","type":"license_required","code":"license_required"}}`. Re-grant the local user afterward and confirm 403 disappears.

- [ ] **Step 8: Commit**

```bash
git add lib/api/license.ts app/api/v1/chat/completions/route.ts app/api/v1/web/search/route.ts app/api/v1/web/fetch/route.ts app/api/v1/reel-captions/jobs/route.ts
git commit -m "feat(api): deploy-gated 403 license_required on hosted routes"
```

---

## Task 8: Account page — license CTA + status + success banner

**Files:**
- Create: `components/account/license-cta.tsx`
- Modify: `app/account/actions.ts`, `app/account/page.tsx`

- [ ] **Step 1: Add the license checkout server action**

In `app/account/actions.ts`, add a new exported action (reuses the existing auth + fetch pattern):

```ts
export async function createLicenseCheckoutSession() {
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

  try {
    const response = await fetch(`${url}/functions/v1/create-checkout-session`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ purpose: "license" }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      url?: string;
      alreadyLicensed?: boolean;
      error?: string;
      msg?: string;
      message?: string;
    };

    if (payload.alreadyLicensed) {
      redirect(searchParamUrl("/account", { license: "already" }));
    }

    if (!response.ok) {
      errorMessage =
        payload.error ?? payload.msg ?? payload.message ??
        `Unable to start license checkout. (${response.status})`;
    } else {
      checkoutUrl = payload.url;
    }
  } catch {
    errorMessage = "Checkout function is not reachable.";
  }

  if (!checkoutUrl) {
    redirect(searchParamUrl("/account", { error: errorMessage }));
  }

  redirect(checkoutUrl);
}
```

- [ ] **Step 2: Write the license CTA component**

Create `components/account/license-cta.tsx`:

```tsx
import { CheckCircle2Icon } from "lucide-react";

import { createLicenseCheckoutSession } from "@/app/account/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LicenseCta({ licensed }: { licensed: boolean }) {
  if (licensed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2Icon className="size-5 text-foreground/70" />
            Lifetime license active
          </CardTitle>
          <CardDescription>
            You have full access to Woven, forever. Hosted models draw from your
            prepaid balance below.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get your Woven lifetime license</CardTitle>
        <CardDescription>
          $99 one-time — yours forever. Includes $5 in hosted credits to start.
          7-day money-back guarantee.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <form action={createLicenseCheckoutSession} className="border-t bg-muted/20 px-4 py-4">
          <Button type="submit" className="h-10 rounded-lg px-5">
            Buy lifetime license — $99
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Render license status + handle `?license=*` in the account page**

In `app/account/page.tsx`:
- Add to the imports: `import { LicenseCta } from "@/components/account/license-cta";`
- Extend `AccountPageProps.searchParams` type to include `license?: string | string[];`.
- In the component, read it: `const license = firstSearchParam(params.license);`
- Add a `get_billing_balance`-adjacent license read. After the existing `Promise.all`, add:

```tsx
  const { data: licenseRows } = await supabase
    .from("licenses")
    .select("id")
    .eq("status", "active")
    .limit(1);
  const licensed = Array.isArray(licenseRows) && licenseRows.length > 0;
  // No top-up without a license once enforcement is on (same flag as the API gate).
  const enforceLicense = process.env.WOVEN_ENFORCE_LICENSE === "true";
  const canTopUp = !enforceLicense || licensed;
```

- Add success/info banners next to the existing `checkout` banners:

```tsx
      {license === "success" ? (
        <Alert tone="success">
          License purchase complete. Welcome to Woven — your $5 in starter credits
          is on its way.
        </Alert>
      ) : null}
      {license === "already" ? (
        <Alert tone="info">You already have a lifetime license.</Alert>
      ) : null}
      {license === "cancelled" ? (
        <Alert tone="info">License checkout cancelled.</Alert>
      ) : null}
```

- Render `<LicenseCta licensed={licensed} />` as a new `<section>` directly above the top-up section. Then render the existing `<BalanceTopUpForm />` section **only when `canTopUp`** — an unlicensed user (enforcement on) sees the buy CTA but no top-up form:

```tsx
      {canTopUp ? (
        <section>
          <BalanceTopUpForm />
        </section>
      ) : null}
```

- [ ] **Step 4: Type-check + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Verify in the browser**

`pnpm dev`, sign in, visit `/account`.
Expected: a grandfathered (licensed) user sees "Lifetime license active"; a locally-revoked user sees the "Buy lifetime license — $99" CTA that opens Stripe Checkout. `/account?license=success` shows the success banner.

- [ ] **Step 6: Commit**

```bash
git add app/account/actions.ts components/account/license-cta.tsx app/account/page.tsx
git commit -m "feat(account): license CTA, status, and checkout success banners"
```

---

## Task 9: Pricing page — retire free tier, reframe as $99 license + credits

**Files:**
- Modify: `app/pricing/page.tsx`

- [ ] **Step 1: Update metadata + hero copy**

In `app/pricing/page.tsx`, change the `metadata.description` and the `PricingHero` copy:

```tsx
export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Woven is a $99 one-time lifetime license — yours forever, includes $5 in hosted credits, with a 7-day money-back guarantee. Add prepaid credits anytime for Woven-hosted frontier models at published per-model rates.",
  alternates: { canonical: "/pricing" },
};
```

In `PricingHero`, replace the `h1` + `p`:

```tsx
        <h1 className="mt-6 max-w-2xl text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-6xl">
          One price. Yours forever.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
          $99 one-time for a lifetime license — includes $5 in hosted credits and a
          7-day money-back guarantee. Use your own keys, or top up to run
          Woven-hosted models at published per-model rates.
        </p>
```

- [ ] **Step 2: Replace `Plans()` with a required-license card + subordinate optional add-on bar**

This expresses "the $99 license is the required base; pay-as-you-go credits are an optional add-on **on top**" — NOT two peer plans. A single centered, accent-ringed license card with a `Required` tag, followed by a visually subordinate full-width add-on bar (muted, smaller, "+ Optional add-on") that links down to the rate tables. Replace the whole `Plans` function with:

```tsx
function Plans() {
  const licenseBullets = [
    "Lifetime access — no subscription",
    "$5 in Woven-hosted credits included",
    "Use your own Anthropic/OpenAI keys, or sign in with ChatGPT",
    "7-day money-back guarantee",
  ];

  return (
    <section className="pb-12">
      <div className="mx-auto w-full max-w-xl px-6">
        {/* Required base: the lifetime license */}
        <div className="flex flex-col gap-5 rounded-3xl bg-card p-8 ring-2 ring-foreground">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">Lifetime license</h2>
              <p className="text-xs text-muted-foreground">One-time — yours forever</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
              Required
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold tracking-tight">$99</span>
            <span className="text-sm text-muted-foreground">once</span>
          </div>
          <p className="text-sm text-muted-foreground">
            The full Woven app on your Mac, forever. Includes $5 in hosted credits
            to start. 7-day money-back guarantee.
          </p>
          <ul className="mt-2 flex flex-col gap-3 border-t border-border pt-6 text-sm">
            {licenseBullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                  <CheckIcon className="size-3" />
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/login?next=/account"
            className={cn(
              buttonVariants(),
              "mt-auto h-11 w-full rounded-full text-sm font-medium",
            )}
          >
            Get your license — $99
            <ArrowRightIcon className="size-4" />
          </Link>
        </div>

        {/* Optional add-on: hosted credits, layered on top */}
        <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-border bg-muted/30 p-6">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5">
              + Optional add-on
            </span>
            <span>Pay-as-you-go</span>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Hosted credits from $5.</span>{" "}
            Top up a prepaid balance anytime to run Woven-hosted models — layered on
            top of your license, no key management.{" "}
            <Link
              href="#models"
              className="font-medium text-foreground underline underline-offset-4"
            >
              See per-model rates ↓
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Delete unused bullet consts + update `Notes`/`CtaBand` copy**

Both `localBullets` and `hostedBullets` are now unused — **delete both consts** (the add-on bar is plain copy, no bullet list). Update the third `NoteCard` in `Notes` (was "Bring your own keys instead") to:

`localBullets` is no longer used — delete the `localBullets` const. Update the third `NoteCard` in `Notes` (was "Bring your own keys instead") to:

```tsx
          <NoteCard title="Use your own keys">
            Your license covers the full app whether you bring your own Anthropic/
            OpenAI keys (pay providers directly) or sign in with ChatGPT. Hosted
            credits are only needed for Woven-hosted models.
          </NoteCard>
```

Update `CtaBand`'s heading/copy and button:

```tsx
        <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
          Buy once. Use forever.
        </h2>
        <p className="max-w-xl text-base text-muted-foreground md:text-lg">
          $99 one-time, includes $5 in hosted credits, 7-day money-back guarantee.
        </p>
        <Button
          nativeButton={false}
          className="h-12 rounded-full px-7 text-base font-medium"
          render={<a href={DOWNLOAD_URL} download />}
        >
          <AppleIcon className="size-4" />
          Download for Mac
        </Button>
```

- [ ] **Step 4: Type-check + lint + build**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors, no unused-var warnings for `localBullets` or `hostedBullets` (confirm both were deleted).

- [ ] **Step 5: Verify in the browser**

`pnpm dev`, visit `/pricing`.
Expected: "$99 lifetime license (+$5, 7-day guarantee)" as the primary card; "Hosted credits from $5" as the optional add-on; no "$0 forever / Free" tier; model + tool rate tables unchanged.

- [ ] **Step 6: Commit**

```bash
git add app/pricing/page.tsx
git commit -m "feat(pricing): retire free tier; \$99 lifetime license + optional credits"
```

---

## Task 10: Final type/lint/build gate

**Files:** none (verification only)

- [ ] **Step 1: Full type-check + lint + production build**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: all pass. `pnpm build` compiles all routes including the modified API routes.

- [ ] **Step 2: Full local smoke (optional but recommended)**

With `supabase start`, `supabase functions serve --env-file .env.local`, `stripe listen`, and `pnpm dev`: complete a license purchase with `4242…`, confirm `/account` flips to "Lifetime license active", `GET /api/v1/billing/balance` shows `license.active=true` and balance includes the $5, and (with `WOVEN_ENFORCE_LICENSE=true`) a revoked user gets 403 on `/api/v1/web/search`.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A && git commit -m "chore: license backend final type/lint/build pass"
```

---

## Deployment notes (rollout — see spec §7)

Deploy in this order; do **not** flip `WOVEN_ENFORCE_LICENSE=true` until the license-aware harness build has adoption:

1. Push Task 1 migration (`create_licenses`).
2. Create the live Stripe Product/Price; set `STRIPE_LICENSE_PRICE_ID` (live) in Supabase Function env + Vercel; register `charge.refunded` on the live webhook endpoint.
3. Deploy the webhook (Task 4) **before** the checkout (Task 5) is reachable.
4. Deploy checkout (Task 5), balance endpoint (Task 6), the gate code (Task 7, flag **off**), account + pricing pages (Tasks 8–9).
5. Set the real cutoff literal in the Task 2 migration; **after the cutoff instant passes**, push the `grandfather_backfill` migration; verify counts on staging first.
6. Ship the license-aware harness (separate plan).
7. Only then set `WOVEN_ENFORCE_LICENSE=true` in production.

---

## Self-review notes

- **Spec coverage:** §1 data model → Task 1; §1 RPCs → Task 1; §2 Stripe product/checkout → Tasks 3, 5; §2 webhook + $5 bonus + refund → Task 4; §3 balance field → Task 6; §3 hosted-route 403 (+`/models` ungated, deploy-gated) → Task 7; §5 account → Task 8; §5 pricing → Task 9; §6 grandfather backfill + unchanged trigger → Task 2 (trigger intentionally untouched). §4 harness → out of scope (separate plan), called out in header + rollout.
- **Money-back window:** spec says **7 days**; Task 8 copy includes a 30→7 correction note and Task 9 uses 7-day. Ensure all surfaces say 7 days.
- **Type consistency:** RPC param names (`p_user_id`, `p_source`, `p_source_id`, `p_kind`, `p_metadata`, `p_reason`) match between migration and the edge-function `admin.rpc(...)` calls; `licenseGateResponse(auth: ApiAuth)` matches `requireApiAuth`'s `authResult.auth` shape; `has_active_license` returns boolean consumed as `data === true`.
- **Deploy-gated enforcement:** `WOVEN_ENFORCE_LICENSE` defaults off so Task 7 ships dark; balance endpoint (Task 6) always returns license status regardless, so the harness gate can work client-side before server enforcement.
