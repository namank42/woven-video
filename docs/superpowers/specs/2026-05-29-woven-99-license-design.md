# Woven $99 one-time lifetime license — design spec

**Date:** 2026-05-29
**Status:** Implemented on `feat/99-license` (PR #13). NOTE: grandfathering was changed from a one-time backfill to **read-time derivation** during implementation — this doc reflects the as-built design.
**Spans two repos:** `woven-video` (Next.js site + Supabase/Stripe billing backend) and `woven-harness` (native macOS Swift/SwiftUI app)

## Problem

Woven is free today. The macOS app runs locally with the user's own provider
keys (BYOK) at no charge, and money only flows through an **optional** prepaid
USD credit balance used for Woven-hosted models, captions, and web tools. There
is **no concept of license / entitlement / paid / access anywhere** in the
codebase — only the prepaid balance ledger.

We are changing pricing from **free** to a **$99 one-time lifetime license**.
Users are prompted to buy it during onboarding in the harness app (after Google
sign-in, where they already see balance + "Add credits"). To make the $99 feel
substantial, **every paid license also includes $5 of hosted credits**.

**Three ways to run models under the license:** bring your own Anthropic/OpenAI keys, sign in with ChatGPT (GPT-5+ on an existing Plus/Pro/Team plan), or Woven-hosted prepaid credits. All three sit on top of the one-time license; ChatGPT-Codex is gated and best-effort client-side like BYOK (decision #1).

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| What $99 buys | A **lifetime license** to use the Woven app — a boolean entitlement, **not** credits. Required for **everyone** (BYOK, ChatGPT-Codex, and hosted alike). |
| Free tier | The old "$0 forever / BYOK" tier is **retired**. $99 is the floor. |
| Bundled value | Every **paid** $99 purchase also grants **$5 of hosted credits** (promo grant). |
| Hosted credits | Remain a **separate, optional** prepaid top-up ($5–$100) layered on top of the license. The two subsystems never share math. |
| Gate | **Hard gate**: after Google sign-in, block the editor and ALL model use until the user holds an active license. |
| Existing users | **Grandfather everyone**: every user created before a fixed launch cutoff is treated as licensed — **derived at read time** from `created_at < license_cutoff()` (no backfill row needed). They do **not** get the $5 bonus (that is tied to the paid purchase). |
| Money-back guarantee | **7 days**, fully manual via the Stripe Dashboard. A refund auto-revokes the license; the $5 bonus is **not** clawed back. |
| Credit-purchase gating | **Buying credits requires an active license too** — the license is the single gate; no top-up without it. Enforced via the same `WOVEN_ENFORCE_LICENSE` flag as the hosted routes (off until launch, so nobody is blocked pre-launch). |
| BYOK/Codex enforcement | Accept **best-effort client-only** enforcement (those calls never touch Woven's servers). |
| Launch cutoff | The `license_cutoff()` SQL function (single source of truth); set to `2026-05-28` during build, finalized to the real launch instant at go-live. |

## Enforcement reality (sign off on this)

BYOK and ChatGPT-Codex inference calls go **provider-direct and never traverse
`woven-video`** (verified in `woven-harness` `ChatView.prepareModelRequest`: the
Woven token is attached only optionally and never blocks). Therefore:

- The server-side `has_active_license()` **403** is a true hard gate **only for
  Woven-hosted / credit-consuming routes** (`/chat/completions`, `/web/*`,
  `/reel-captions`).
- For BYOK/Codex, the **client paywall + `ChatView` guard + time-bounded cache**
  are the *only* control and are necessarily **best-effort**. A deliberately
  patched binary calling Anthropic/OpenAI with the user's own keys is inherently
  unblockable — and acceptable, since the user pays that provider directly.

## Non-goals

- No in-app admin console, no DB refund-window state machine, no self-serve
  refunds (refunds are a manual Stripe Dashboard action).
- No credit clawback on license refund (subsystems stay orthogonal; clawback
  would risk a negative balance, which the ledger forbids).
- No proxying of BYOK/Codex inference through the server.
- No automated chargeback/dispute handling at launch (handled manually).
- No change to the existing credit top-up flow ($5–$100, inline `price_data`).

---

## 1. Data model — new `public.licenses` table

A dedicated table (not columns on `profiles`, not a `ledger_entries` kind). It
clones the ledger's idempotency + RLS + service-role-write conventions.

```sql
create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'lifetime' check (kind in ('lifetime')),
  status text not null default 'active' check (status in ('active','revoked')),
  source text not null,            -- 'stripe' | 'grandfather'
  source_id text not null,         -- stripe: payment_intent id; grandfather: user_id::text
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason in ('refund','dispute','admin')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id),
  check ((status = 'revoked') = (revoked_at is not null))
);

-- A user can never hold two ACTIVE licenses:
create unique index licenses_one_active_per_user
  on public.licenses(user_id) where status = 'active';
create index licenses_user_idx on public.licenses(user_id);

create trigger set_licenses_updated_at before update on public.licenses
  for each row execute function public.set_updated_at();

alter table public.licenses enable row level security;
create policy "Users can read own licenses" on public.licenses
  for select to authenticated using (user_id = auth.uid());
revoke all on public.licenses from anon, authenticated;
grant select on public.licenses to authenticated;   -- read-own ONLY; no insert/update/delete => cannot self-grant
grant all on public.licenses to service_role;
```

**Two DB-enforced invariants:** `unique(source, source_id)` makes Stripe webhook
delivery replay-safe; the partial unique index makes a second *active* license
impossible.

### RPCs (all `security definer`, `set search_path = public, extensions`)

- **`grant_license(p_user_id uuid, p_source text, p_source_id text, p_kind text default 'lifetime', p_metadata jsonb default '{}') returns public.licenses`** — service-role only.
  Explicit body (NOT a bare `on conflict do nothing`, which returns zero rows
  and can't read back the existing row):
  1. `SELECT` by `(source, source_id)`; if found, return it **unchanged** (true
     replay; also: a refunded *tombstone* is returned and **not** re-activated —
     closes the out-of-order refund-before-grant hole).
  2. Else `INSERT`; on the partial-active-index `unique_violation` (a genuine
     second payment_intent for an already-active user — the two-tab race), catch
     `exception when unique_violation` and return the existing active row
     without inserting (deterministic, no 500/retry loop).
  - **Does NOT call `ensure_billing_account`** — a license FKs `auth.users`
    directly and has no billing-account coupling; calling it would 500 if the
    auth row was hard-deleted and needlessly couple the orthogonal subsystems.
- **`revoke_license(p_source text, p_source_id text, p_reason text default 'refund', p_metadata jsonb default '{}') returns public.licenses`** — service-role only.
  **Keyed on payment_intent, not user_id.** UPSERT by `(source, source_id)`: if
  an active row exists, flip to `revoked` + set `revoked_at`/`revoke_reason`; if
  **no** row exists (refund/dispute arrived before the grant), INSERT a
  `revoked` **tombstone** so the later `grant_license` collides and does not
  activate. Idempotent (already-revoked → no-op). Append-preserving; never
  deletes. This makes it impossible to revoke a grandfather row or a legitimate
  re-purchase by mistake.
- **`license_cutoff() returns timestamptz`** — `immutable`; the single source of
  truth for the grandfather cutoff (a hardcoded UTC literal — `2026-05-28` during
  build, set to the real launch instant at go-live).
- **`user_has_active_license(p_user_id uuid) returns boolean`** — `stable`,
  `security definer`. The shared eligibility check: `exists(active license row
  for p_user_id) OR exists(auth.users where id = p_user_id and created_at <
  license_cutoff())`. **Grandfathering is derived here, at read time** — no
  pre-written row. Granted to `authenticated` + `service_role` so the edge
  function can call it with an explicit user id (and so refunds-vs-grandfather
  resolve correctly: a refund flips only the *paid* row; a pre-cutoff user stays
  licensed via the second disjunct).
- **`has_active_license() returns boolean`** — `stable`; `select
  user_has_active_license(auth.uid())`. Must be called via the route's
  **RLS-scoped** client (`authResult.auth.supabase`), not the service-role admin
  client (which has no `auth.uid()`). Reused by the balance route, the hosted
  routes, the account page, and the checkout pre-checks. Because eligibility is
  derived, a paid (`stripe`) row and a pre-cutoff signup both resolve to licensed
  uniformly.

---

## 2. Stripe integration

**Product/Price:** one **real reusable Stripe Price** (`STRIPE_LICENSE_PRICE_ID`
per environment, `unit_amount = 9900`, non-recurring) — **not** inline
`price_data`. Inline `price_data` stays only for the variable $5–$100 top-up.

**Checkout (reuse the single `create-checkout-session` Edge Function):** add an
internal `purpose` switch. Body `purpose` defaults to `'topup'` so existing
callers are untouched.

- `purpose === 'license'`:
  - Pre-check via active-license lookup → if already active, return
    `200 { alreadyLicensed: true }` with **no session** (covers grandfathered
    users too).
  - Ignore any client-supplied amount.
  - `line_items` from `STRIPE_LICENSE_PRICE_ID`.
  - **`payment_method_types: ['card']`** — so `payment_status` is always `'paid'`
    at `checkout.session.completed`. (Delayed methods like ACH complete as
    `processing` and only confirm via `checkout.session.async_payment_succeeded`,
    which we do not subscribe to — card-only avoids stranding a buyer.)
  - `metadata: { user_id, purpose: 'license' }` on **both** the session **and**
    `payment_intent_data` (so charge/refund/dispute events can classify).
  - `success_url = /account?license=success`.

**Webhook (`stripe-webhook`, single endpoint).** Subscribed events at launch:
**`checkout.session.completed`** and **`charge.refunded`** (the latter must be
explicitly registered on the endpoint's enabled-events list, or it is silently
never delivered).

- **`checkout.session.completed` ordering is load-bearing.** Inside
  `handleCheckoutCompleted`, immediately **after** the
  `mode === 'payment' && payment_status === 'paid'` guard and **before** the
  amount parsing/validation, branch on `session.metadata.purpose`:
  - `'license'`: require `session.payment_intent` to be a non-empty **string**
    (throw — do **not** fall back to `session.id`, so the grant key equals the
    refund-lookup key). Write the customer id, then:
    - `grant_license(p_source: 'stripe', p_source_id: payment_intent)`
    - `grant_balance(5_000_000 usd_micros, source: 'license_bonus', source_id:
      payment_intent, kind: 'promo', metadata: { reason: 'license_bonus' })`
      — the **$5 starter credit bonus**. Idempotent on
      `(source, source_id, kind)`; distinct keyspace from real top-ups
      (`source='stripe'`/`kind='purchase'`). Surfaces in account activity as
      "Promotional balance · License Bonus".
    - Return. **Never** touch `amountCents`.
  - `'topup'` or **missing** (legacy in-flight sessions): the existing
    amount-validation + `grant_balance(kind: 'purchase')` path.
  - *Why this matters:* today every paid session falls through to
    `grant_balance` using `amount_total` — a $99 license session would mint $99
    of credits. The `purpose` branch MUST ship in the same change as the license
    checkout.
- **`charge.refunded`:** read `charge.payment_intent`, classify via
  `payment_intent` metadata `purpose === 'license'` (and resolve the license
  directly by `source_id = payment_intent`). **Only** when
  `charge.amount_refunded === charge.amount` (full refund of the $99 SKU) call
  `revoke_license(source: 'stripe', source_id: payment_intent, reason:
  'refund')`. A `charge.refunded` for a `topup` is intentionally a **no-op** for
  licenses (no credit clawback). The $5 bonus is **not** reversed.

**Idempotency / races resolved:** duplicate `checkout.session.completed` →
`grant_license` returns the existing row; two-tab double-pay → partial-unique
index + caught `unique_violation`; refund-before-grant → tombstone. The rare
genuine double-charge is handled by the **same manual Dashboard refund** as the
guarantee (optionally Slack-notify a human). No in-webhook auto-refund machinery.

---

## 3. API changes (`woven-video`)

- **`GET /api/v1/billing/balance`** — fold license into the **existing**
  `get_billing_balance` reader (no new `get_account_state` RPC). After the
  existing call, the route adds a `license: { active, granted_at }` object by
  calling `has_active_license()` (or a direct RLS-scoped select) via
  `authResult.auth.supabase`. Preserve all current fields (`currency`,
  `balance_usd_micros`, `balance_usd`), keep `dynamic = 'force-dynamic'`.
  `has_active_license()` **fails open** server-side on infra/DB error. This is
  the one call the harness gate reads.
- **`POST /api/v1/chat/completions`** — after `requireApiAuth` and **before**
  `createChatJob`/`reserveChatBalance`, call `has_active_license()` via the
  RLS-scoped client; if false → **`403 license_required`** (distinct from
  `402 insufficient_balance`). **Fail open** on a DB/infra error.
- **`POST /api/v1/web/search`, `/api/v1/web/fetch`, `/api/v1/reel-captions`** —
  same `has_active_license()` admission check, same `403`, same fail-open.
  Admission-time only — no mid-stream re-check, so in-flight reserve/settle jobs
  finish cleanly (the check deliberately never touches `generation_jobs`).
- **`GET /api/v1/models`** — **NOT gated.** It is a catalog read; gating it would
  blank the model picker on older Sparkle builds that don't understand `403`.
- **`functions/v1/create-checkout-session`** — `purpose` switch (above). The
  `topup` branch also **pre-checks an active license** when `WOVEN_ENFORCE_LICENSE`
  is on and returns `403 license_required` for an unlicensed user (no credit
  purchase without a license). No-op when the flag is off, so existing behavior
  is unaffected until enforcement is turned on. Uses the derived
  `user_has_active_license(user.id)` (so grandfathered users — who have no row —
  are correctly allowed to top up once enforcement is on).
- **`functions/v1/stripe-webhook`** — `purpose` branch + `charge.refunded`
  handler (above).

---

## 4. Harness changes (`woven-harness`, Swift/SwiftUI)

- **`Stores/WovenAccountStore.swift`** — add `private(set) var license:
  WovenLicense?` next to `balance`, and an explicit **tri-state** gate (NOT a
  nil-coalesced boolean). Model license as `unknown / active / inactive`.
  `requiresLicense` returns:
  - `false` while not configured, `authState != .signedIn` (covers `.loading`
    **and** `.signingIn`), or the first license fetch this session is unresolved
    **and** there is no cache → **no paywall flash for grandfathered users**.
  - `true` only on (a) a fresh `200` with `license.active == false`, or (b) a
    cached not-active.
  - Persist last-good license to `UserDefaults` **with a timestamp + grace
    window** (**14 days**, tunable): **fail open** while fresh, **fail closed**
    once staler than the window (an unbounded fail-open would let a revoked BYOK user
    — invisible to the server — edit forever by staying offline). A `401` drops
    to signed-out (existing path); generic/network errors keep the bounded
    cache. Nil the license on `signOut` and `401`.
- **`ContentView.swift`** — add a branch in `body` **between**
  `else if wovenAccount.requiresSignIn` and `else if shouldShowOnboarding`:
  `else if wovenAccount.requiresLicense { LicensePaywallView() }`. Order is
  load-bearing — after sign-in, before onboarding, so an unlicensed user never
  reaches the workspace pickers / editor. `welcomeCompleted` stays orthogonal: a
  newly-licensed user falls through to existing onboarding.
- **`WovenBackendClient.swift`** — decode an **optional** `license` object from
  the existing balance response into `WovenLicense: Decodable, Equatable { var
  isActive: Bool { status == "active" } }`. Must be `WovenLicense?` (a
  non-optional field would make the plain `JSONDecoder` throw on any response
  lacking it — e.g. a stale server mid-rollout). `refreshBalance()` sets balance
  + license atomically from one decode.
- **`Views/LicensePaywallView.swift` (new)** — modeled on `SignInWelcomeView`:
  headline, **"$99 one-time — includes $5 in hosted credits, yours forever"**,
  what-you-get list (should mention all three inference paths: BYO Anthropic/OpenAI keys, sign in with ChatGPT, and Woven-hosted credits; note hosted credits beyond the $5 are a separate optional
  top-up), **7-day money-back** line, primary **"Buy lifetime license — $99"**
  opening web Checkout via `NSWorkspace.shared.open(accountURL?purchase=license)`
  (reuse `OnboardingView.openTopUp`), a manual **"Refresh / I already
  purchased"** button, and **Sign out** (wrong-account escape hatch). A
  re-gated-after-refund copy variant: "Your license was refunded. Repurchase
  anytime." Detect activation via `didBecomeActive` refresh + bounded backoff
  poll (immediate + ~5 attempts at growing delays). No `woven://` deep link.
- **`WovenHarnessApp.swift`** — in the existing
  `NSApplication.didBecomeActiveNotification` handler add `Task { await
  wovenAccount.refreshBalance() }` so returning from the Stripe browser tab
  refreshes license automatically.
- **`Views/ChatView.swift`** — defense-in-depth (the **only** gate for
  BYOK/Codex): in `prepareModelRequest` add an early **mode-agnostic** `guard
  wovenAccount.license?.isActive == true else { return .blocked }` covering
  `.woven`, `.bringYourOwnKey`, and `.chatgptCodex`, reading the **same
  time-bounded cache** as `requiresLicense`. Add a high-priority `composerNotice`
  "A Woven license is required to send messages." **with a "Buy license"
  action** wired to `accountURL?purchase=license` (a grandfathered user whose
  license was revoked hits the composer notice, not the top-level paywall).

---

## 5. Web changes (`woven-video`)

- **`app/pricing/page.tsx`** — retire the "Free $0 forever / BYOK" tier. Reframe:
  **Lifetime License $99 one-time** (required for everyone, BYOK + hosted),
  **includes $5 hosted credits**, **7-day money-back guarantee**, PLUS optional
  hosted-model prepaid credits ($5–$100 top-ups) as a separate add-on with the
  existing model-rate tables. State explicitly that the license is one-time and
  is **not** credits.
- **`app/account/page.tsx` + `app/account/actions.ts`** — add a license purchase
  path: a server action that POSTs `{ purpose: 'license' }` (no amount) to
  `create-checkout-session` and redirects to the returned Checkout URL, or shows
  "You have a lifetime license" on `{ alreadyLicensed: true }` (covers
  grandfathered users). Surface license status (Licensed / Buy lifetime license
  $99) from the `license` field now on the balance response. Handle
  `?license=success` alongside the existing `?checkout=success` banners.
- **`components/account/balance-top-up-form.tsx`** — the form component itself is
  unchanged. On `app/account/page.tsx`, render the top-up form **only when the user
  is licensed** (while `WOVEN_ENFORCE_LICENSE` is on); an unlicensed user sees
  **only** the "Buy lifetime license — $99" card, never a top-up they couldn't use.

---

## 6. Grandfathering (read-time, derived)

> Originally specced as a one-time backfill migration; replaced during
> implementation with read-time derivation. A snapshot migration only covers
> users that exist at migration-run time (so it can't be tested locally where
> `db reset` wipes users, and — critically — once enforcement is on, a
> grandfathered user with no row would be wrongly blocked from buying credits).
> Deriving eligibility on read removes all of that.

- **No backfill.** Grandfather eligibility is computed live by
  `user_has_active_license()` (§1): a user is licensed if they hold an active
  license row **or** `auth.users.created_at < license_cutoff()`. No migration
  materializes grandfather rows — so it's self-healing, identical locally and in
  prod, and immune to migration-timing races.
- **Cutoff** — `license_cutoff()` holds the single UTC literal (`2026-05-28`
  during build). Everyone with `created_at <` it is free, forever; `>=` pays
  $99. Moving this one value is what turns "free for everyone" (pre-launch) into
  "grandfather the old, charge the new." Dormant pre-cutoff users are covered
  automatically the next time they sign in (pure date math, not a snapshot).
- **Revocation interplay** — a refund revokes only the *paid* row; a pre-cutoff
  user can never be locked out (their `created_at < cutoff` disjunct is always
  true), which is the intended grandfather guarantee.
- **Signup trigger** — **unchanged.** `create_profile_and_billing_account` grants
  no entitlement; do **not** wire `grant_license` into any signup trigger.
- **No $5 bonus** for grandfathered users — that's tied to the paid purchase.

---

## 7. Rollout order (load-bearing)

1. **DB migration:** `public.licenses` (+ partial-unique-active index + CHECKs +
   RLS + grants) and the `grant_license` / `revoke_license` / `license_cutoff` /
   `user_has_active_license` / `has_active_license` RPCs (grandfathering derived
   at read time). No behavior change yet.
2. **Stripe:** create the $99 Product + reusable Price (card-eligible) in **test
   and live**; set `STRIPE_LICENSE_PRICE_ID` per env. **Register
   `charge.refunded`** on the webhook endpoint's enabled-events list.
3. **Webhook:** ship the `metadata.purpose` branch (license → `grant_license` +
   $5 `grant_balance`, placed **before** amount parsing; topup/absent → existing
   `grant_balance`) + the `charge.refunded` revoke-by-payment_intent handler.
   **Must land before any license checkout is reachable.**
4. **Checkout:** ship the `create-checkout-session` `purpose` switch (license
   branch: pre-check, `STRIPE_LICENSE_PRICE_ID`, card-only, mirrored metadata).
   License purchase now works end-to-end on web.
5. **Balance endpoint:** extend `GET /api/v1/billing/balance` to compose the
   `license` object (additive, backward-compatible, fail-open).
6. **Cutoff:** set `license_cutoff()` to the real launch instant (a one-line
   `create or replace` migration). No backfill needed — eligibility is derived,
   so pre-cutoff users read as licensed immediately and post-cutoff signups pay.
7. **Harness (Sparkle release):** ship the client that (a) handles `403
   license_required` gracefully and (b) adds the `requiresLicense` tri-state,
   `LicensePaywallView`, `didBecomeActive` refresh, `ChatView` guard, and
   time-bounded offline cache. Grandfathered users pass; new signups hit the
   paywall.
8. **Server gate:** after enough adoption of step 7's build, add the
   `has_active_license()` `403` gate to the hosted routes (`/chat/completions`,
   `/web/*`, `/reel-captions`) — fail-open on infra error; `/models` stays open.
9. **Web pages:** update pricing/account (retire free tier, license CTA, $5 +
   7-day copy, already-licensed copy for grandfathers).
10. **Launch:** flip the public cutoff / announce (Loops). Stripe retries (~3
    days) reconcile any in-flight purchase across the deploy boundary because
    `grant_license` is idempotent on payment_intent.

---

## 8. Edge cases & failure modes

| Scenario | Handling |
| --- | --- |
| Duplicate `checkout.session.completed` (at-least-once) | `grant_license` SELECT-by-`(source,source_id)` returns existing row; no double grant; `$5` `grant_balance` idempotent on `(source,source_id,kind)`. |
| Two tabs, two distinct payment_intents | Pre-check closes the common case; the race hits the partial-unique-active index → caught `unique_violation` returns the existing active row. Duplicate $99 → manual Dashboard refund. |
| $99 session vs today's webhook | `purpose` branch (license → grant, never `grant_balance` on amount) ships with the license checkout; fixes the latent "$99 mints $99 credits" bug. |
| Refund **before** the grant (out-of-order) | `revoke_license` writes a `revoked` tombstone keyed on payment_intent; the later `grant_license` returns it unchanged → never activates. |
| Refund/dispute carries a charge, not a session | `purpose`+`user_id` mirrored onto `payment_intent_data.metadata`; revoke resolves by `source_id = charge.payment_intent`. |
| Partial refund of $99 | Gate revocation on `amount_refunded === amount` (full only). A lifetime license is all-or-nothing. |
| Delayed-notification method (ACH) on license SKU | License Checkout is card-only → `payment_status` always `paid` at completion. |
| Refund of a **top-up** charge | Classified as `topup` → no-op for licenses (no credit clawback). |
| License refunded, $5 already spent | $5 bonus is **not** clawed back (would breach the ledger's `balance >= 0`); accepted cost over a 7-day window. |
| Harness offline / backend down | Fail **open** within the grace window (cached last-good); fail **closed** once stale-past-window. `401` → signed-out; network errors keep the bounded cache. |
| Cold launch / right after sign-in | Tri-state `requiresLicense` is `false` until the first fetch resolves or a cache exists → no flash for grandfathers. |
| Grant lands seconds after returning from browser | `didBecomeActive` refresh + bounded backoff poll converge; "I already purchased" is the guaranteed fallback. |
| Stale build hits a hosted route directly | Server `has_active_license()` `403` enforces hosted routes; BYOK/Codex is provider-direct so client guard is the only (best-effort) control. |
| In-flight reserved job when license revoked | License checked at admission only; `revoke_license` never touches `generation_jobs`. The user simply can't start new jobs. |
| Grandfather on any DB (local / preview / restore) | Derived from `created_at < license_cutoff()` at read time — no snapshot to replay or mis-time; always consistent, and post-cutoff signups never qualify. |
| User signed in on two Macs | License is per-user; the buying Mac unlocks via poll, the other on next foreground refresh. Expected. |
| Won chargeback (if a dispute ever happens) | Manual operator `grant_license` (idempotent on the original payment_intent) re-grants. Automated dispute handling deferred. |

---

## 9. Config / env vars introduced

- `STRIPE_LICENSE_PRICE_ID` — the $99 Stripe Price id (separate value for
  test vs live).
- `LICENSE_BONUS_USD_MICROS = 5_000_000` — named constant for the $5 bonus
  (single consumer in the webhook; no config table).
- `license_cutoff()` — SQL function holding the grandfather cutoff literal
  (`2026-05-28` during build); finalized to the real launch instant at go-live.

## 10. Deferred / future

- Automated dispute handling (`charge.dispute.created` revoke +
  `charge.dispute.closed status=won` re-grant) — only if dispute volume warrants.
- In-webhook auto-refund of genuine double-charges — only if ever observed.
- Team/org licenses — the table's `kind` column leaves room.
