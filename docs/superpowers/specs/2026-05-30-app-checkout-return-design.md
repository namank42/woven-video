# App-originated checkout return experience — design spec

**Date:** 2026-05-30
**Status:** Approved (brainstorming) — ready for implementation plan
**Repos touched:** `woven-video` (Next.js — new pages + edge function tweak) and `woven-harness` (one-line change to the checkout call)

## Problem

The harness Mac app initiates a license purchase by calling the Supabase
`create-checkout-session` Edge Function directly
(`WovenBackendClient.swift:81`) and opening the returned Stripe Checkout URL in
the user's browser. After payment, Stripe redirects to the function's hardcoded
`success_url = ${WOVEN_SITE_URL}/account?license=success`
(`create-checkout-session/index.ts:142`).

`/account` requires a logged-in **browser** session — it bounces unauthenticated
visitors to `/login?next=/account` (`app/account/actions.ts:73`). An app buyer is
authenticated **in the app**, but frequently is **not** logged into the same
browser. So a successful purchase dumps them on a login wall, which reads as "my
payment failed." The cancel path (`/account?license=cancelled`) has the same flaw.

This only affects **app-originated** purchases. Web purchases (made while logged
into the browser) land on `/account` correctly and should keep doing so.

## Key insight (why this stays simple)

The license is granted by the **Stripe webhook** (`stripe-webhook`,
server-to-server, idempotent on `payment_intent`) — **not** by the redirect. The
browser landing page grants nothing. And the app already detects the new license
on its own: `NSApplication.didBecomeActiveNotification` triggers
`refreshBalance()` (`WovenHarnessApp.swift`), and the paywall has a manual
"I already purchased" refresh.

Therefore the post-checkout browser page has exactly two jobs: **reassure the
human** and **send them back to the app**. It does not need to verify payment,
read Stripe, or hold an authenticated session. It is purely presentational.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Verification depth | **Static reassurance.** No Stripe session lookup, no polling. The webhook is the source of truth; the app reconciles via its own refresh. |
| Web vs. app routing | **Split by origin.** Web buyers keep landing on `/account?license=success` (their real dashboard). App buyers land on a new public confirmation page. |
| Return-to-app mechanism | **Text instruction only.** "Head back to the Woven app — it'll unlock automatically." **No `woven://` deep link** (keeps the harness change to one line; no URL-scheme handler work, no browser "Open app?" prompt). |
| Cancel handling | **Dedicated public cancelled page** for app-cancel, mirroring the success page. Never lands an app user on a login wall. |
| Page composition | **One shared presentational component** + two thin route pages (success, cancelled). |
| Auth on new pages | **None.** Public, static. This is what makes the original login-wall bug structurally impossible. |
| `STRIPE_SECRET_KEY` in Vercel | **Not added.** Only the edge functions hold it; the static-reassurance choice means the Next.js app never needs it. |

## Non-goals

- No Stripe Checkout Session verification or `session_id` lookup (the page
  ignores the `session_id` query param Stripe appends).
- No polling for license-active state on the web page.
- No `woven://` deep link or any harness URL-scheme handler change.
- No embedded/in-app Stripe checkout (noted as a possible future direction; out
  of scope here).
- No change to the **web** purchase flow or to `/account`.
- No change to the top-up (credit) checkout — this is license-checkout only. (The
  `origin` switch is implemented generally enough that top-up could adopt it
  later, but this spec does not wire it in.)

---

## 1. Edge function change — `create-checkout-session`

In the `body.purpose === "license"` branch
(`supabase/functions/create-checkout-session/index.ts:116`), choose the redirect
URLs from a **whitelisted** origin rather than a hardcoded `/account` path.

```ts
// origin is whitelisted — never echo a client-supplied raw URL (open-redirect risk).
const origin = body.origin === "app" ? "app" : "web";

const successUrl = origin === "app"
  ? `${siteUrl}/checkout/success`
  : `${siteUrl}/account?license=success&session_id={CHECKOUT_SESSION_ID}`;
const cancelUrl = origin === "app"
  ? `${siteUrl}/checkout/cancelled`
  : `${siteUrl}/account?license=cancelled`;
```

- `origin` defaults to `"web"` when absent → **existing web behavior is
  byte-for-byte unchanged** (including the `session_id` param that `/account`
  already reads).
- Only `"app"` and `"web"` are honored; any other value collapses to `"web"`. No
  raw URL is ever accepted from the client.
- The app's confirmation page ignores `session_id`, so the app `successUrl` omits
  it (harmless to include; omitted for cleanliness).
- `siteUrl` is the existing `Deno.env.get("WOVEN_SITE_URL")` (already set in the
  function env and in Vercel).

## 2. New pages — `woven-video`

Next.js App Router. The root layout (`app/layout.tsx`) is minimal (fonts +
`<Toaster>`, no global nav/footer), so these pages render clean without fighting
chrome. Follow existing conventions: Tailwind, `components/ui` primitives
(`button`, `card`), `lucide-react` icons, the `cn` util.

### 2a. Shared component — `components/checkout/checkout-result.tsx`

A presentational, props-driven component (client or server — no state needed):

```ts
type CheckoutResultProps = {
  variant: "success" | "cancelled";
};
```

Renders a centered card:
- **Icon:** `CheckCircle2Icon` (success, emerald) / `XCircleIcon` or
  `InfoIcon` (cancelled, muted).
- **Headline + body + "back to app" line** per variant (copy below).
- **Footer:** a small muted link to `/account` ("Manage billing") — useful for a
  web user who happens to land here, and harmless for app users.

Keep all copy in this one component, keyed by `variant`, so the two route files
stay thin.

### 2b. `app/checkout/success/page.tsx`

Public server component. Renders `<CheckoutResult variant="success" />`. Ignores
`searchParams` (Stripe appends none we use for the app variant; `session_id` is
intentionally unused). Sets `export const metadata = { title: "Purchase
complete" }` and `robots: { index: false }` (transactional page, keep it out of
search).

### 2c. `app/checkout/cancelled/page.tsx`

Public server component. Renders `<CheckoutResult variant="cancelled" />`. Same
metadata treatment (`title: "Checkout cancelled"`, noindex).

### Copy (final)

**Success**
- Headline: **"You're all set."**
- Body: **"Your Woven lifetime license is active, and $5 in hosted credits have
  been added to your balance."**
- Back-to-app line: **"Head back to the Woven app — it'll unlock automatically. You can close this tab."**
- Footer link: "Manage billing →" → `/account`

**Cancelled**
- Headline: **"Checkout cancelled."**
- Body: **"No charge was made. Your card was not billed."**
- Back-to-app line: **"Head back to the Woven app whenever you're ready to try again."**
- Footer link: "Manage billing →" → `/account`

## 3. Harness change — `woven-harness`

One line: when building the license checkout request body in
`WovenBackendClient` (the `create-checkout-session` call,
`WovenBackendClient.swift:81`), add `"origin": "app"` to the JSON body alongside
`"purpose": "license"`.

No URL-scheme, `.onOpenURL`, or paywall-UI changes. The existing
`didBecomeActive` → `refreshBalance()` path already unlocks the app when the user
returns to it.

---

## 4. Data flow

**App purchase (happy path)**
1. App → `create-checkout-session` with `{ purpose: "license", origin: "app" }`.
2. Function returns a Stripe Checkout URL; app opens it in the browser.
3. User pays. In parallel: Stripe fires `checkout.session.completed` →
   `stripe-webhook` → `grant_license` + `$5 grant_balance` (idempotent).
4. Stripe redirects the browser to `/checkout/success` (public, static).
5. User reads "you're all set," returns to the app.
6. App foregrounds → `didBecomeActive` → `refreshBalance()` → license reads
   active → paywall dismisses.

**App cancel:** step 3 → user cancels → `/checkout/cancelled`. No charge, no
grant. User returns to app, still gated, can retry.

**Web purchase:** `origin` absent → `successUrl = /account?license=success&...` →
unchanged behavior.

## 5. Error handling / edge cases

| Scenario | Handling |
| --- | --- |
| Webhook lag (page loads before grant lands) | Page makes no claim it can't back up — it's a fixed "payment received" message; the grant is near-instant + idempotent, and the app's refresh reconciles. Acceptable under the static-reassurance decision. |
| User never returns to the app | App unlocks on next foreground (`didBecomeActive`) or via the paywall's "I already purchased" button. No server state depends on the redirect. |
| Browser not logged in | Irrelevant — the new pages require no auth. This is the whole fix. |
| Web user lands on `/checkout/success` somehow | Sees a valid confirmation + a "Manage billing" link to `/account`. Harmless. |
| Client sends a bogus `origin` | Whitelist collapses anything ≠ `"app"` to `"web"`; no raw URL is honored (no open-redirect). |
| `WOVEN_SITE_URL` missing | Already set in both the function env and Vercel prod; falls back to `http://localhost:3000` locally (existing behavior). |

## 6. Testing / verification

This repo has **no unit-test harness** (eslint only) — follow existing patterns,
don't introduce one. Verify by:
- `pnpm exec tsc --noEmit && pnpm lint && pnpm build` — pages compile, routes
  register.
- Local: hit `/checkout/success` and `/checkout/cancelled` directly (no auth) →
  both render the right copy with no redirect to `/login`.
- Edge function: a `{ purpose: "license", origin: "app" }` session's
  `success_url` points at `/checkout/success`; a `{ purpose: "license" }`
  (no origin) session still points at `/account?license=success` (web
  regression check).
- End-to-end (prod, post-deploy): from the app, complete a real purchase with a
  **fresh post-cutoff account** (own account is grandfathered → returns
  `alreadyLicensed`, no checkout); confirm the browser lands on
  `/checkout/success` and the app unlocks on return.

## 7. Change surface (summary)

- `supabase/functions/create-checkout-session/index.ts` — ~6 lines (origin
  whitelist + URL selection) in the license branch.
- `components/checkout/checkout-result.tsx` — new shared component.
- `app/checkout/success/page.tsx` — new thin page.
- `app/checkout/cancelled/page.tsx` — new thin page.
- `woven-harness` `WovenBackendClient.swift` — one line (`"origin": "app"`).

## 8. Rollout

- **No new env vars**, no migration, no Stripe dashboard change.
- Ship `woven-video` (edge function redeploy + Vercel deploy of the pages) — safe
  and backward-compatible: web flow unchanged; the new pages are only reached
  once a client sends `origin: "app"`.
- Ship the harness one-liner whenever the next build goes out. Order doesn't
  matter: an old harness (no `origin`) keeps hitting `/account` exactly as today;
  a new harness reaches the new pages. No coordinated deploy required.
