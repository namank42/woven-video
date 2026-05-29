# App-originated Checkout Return Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sending app-originated license buyers to `/account` (which bounces unauthenticated browsers to `/login`); instead land them on dedicated public confirmation pages that reassure them and tell them to return to the Woven app.

**Architecture:** Two new **public, static** Next.js pages (`/checkout/success`, `/checkout/cancelled`) sharing one presentational component, plus a whitelisted `origin` switch in the `create-checkout-session` Supabase Edge Function that picks the Stripe redirect URLs. The Stripe webhook remains the source of truth for granting the license; these pages grant nothing and read no auth. A one-line change in `woven-harness` makes the app send `origin: "app"`.

**Tech Stack:** Next.js (App Router, repo-specific build — see `node_modules/next/dist/docs/`), TypeScript, Tailwind, `lucide-react`, Supabase Edge Functions (Deno), Swift (harness).

**Spec:** `docs/superpowers/specs/2026-05-30-app-checkout-return-design.md`

---

## Repo notes (read before starting)

- **This is a customized Next.js** (see `AGENTS.md`). Before writing any page/route code, skim `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md` and `.../05-server-and-client-components.md` for any API differences from upstream. The pages here are plain async server components with `export const metadata` — standard, but verify.
- **No unit-test harness exists** in `woven-video` (eslint only — no vitest/jest/playwright). Per "follow existing patterns," this plan does **not** introduce one. Verification is `tsc --noEmit`, `lint`, `build`, and direct route loads — the same approach the license backend plan used.
- **Root layout** (`app/layout.tsx`) renders only fonts + a `<Toaster>` — no global nav/header/footer. New pages must center their own content in a full-height container.
- **Package manager is `pnpm`** (not npm).
- Work happens on branch **`feat/app-checkout-return`** (already created; the spec commit is its first commit). Confirm with `git branch --show-current` before starting.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `components/checkout/checkout-result.tsx` (create) | Shared presentational component. Takes `variant: "success" \| "cancelled"`, renders the centered card, icon, copy, and footer link. All copy lives here. |
| `app/checkout/success/page.tsx` (create) | Thin public route → `<CheckoutResult variant="success" />` + page metadata (noindex). |
| `app/checkout/cancelled/page.tsx` (create) | Thin public route → `<CheckoutResult variant="cancelled" />` + page metadata (noindex). |
| `supabase/functions/create-checkout-session/index.ts` (modify, license branch ~L116–147) | Resolve a whitelisted `origin`; select `success_url`/`cancel_url`. Web path unchanged. |
| `woven-harness` `Sources/WovenHarness/WovenBackendClient.swift` (modify, ~L81) | Add `"origin": "app"` to the license checkout request body. |

---

## Task 1: Shared `CheckoutResult` component

**Files:**
- Create: `components/checkout/checkout-result.tsx`

- [ ] **Step 1: Create the component**

This is a server component (no client interactivity). It depends only on `lucide-react` and standard Tailwind design tokens already used across the app (`bg-background`, `text-foreground`, `text-muted-foreground`, `border`). It does NOT import `Button`/`Card` — keeps it self-contained and avoids coupling to those APIs.

```tsx
import Link from "next/link";
import { CheckCircle2Icon, InfoIcon } from "lucide-react";

type CheckoutResultProps = {
  variant: "success" | "cancelled";
};

const COPY = {
  success: {
    Icon: CheckCircle2Icon,
    iconClass: "text-emerald-500",
    headline: "You're all set.",
    body:
      "Your Woven lifetime license is active, and $5 in hosted credits have been added to your balance.",
    backToApp:
      "Head back to the Woven app — it'll unlock automatically. You can close this tab.",
  },
  cancelled: {
    Icon: InfoIcon,
    iconClass: "text-muted-foreground",
    headline: "Checkout cancelled.",
    body: "No charge was made. Your card was not billed.",
    backToApp: "Head back to the Woven app whenever you're ready to try again.",
  },
} as const;

export function CheckoutResult({ variant }: CheckoutResultProps) {
  const { Icon, iconClass, headline, body, backToApp } = COPY[variant];

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
        <Icon className={`mx-auto mb-6 size-12 ${iconClass}`} aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {headline}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
        <p className="mt-6 text-sm font-medium text-foreground">{backToApp}</p>
        <div className="mt-8 border-t pt-6">
          <Link
            href="/account"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Manage billing →
          </Link>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no errors). If `lucide-react` icon names differ, adjust imports — confirm available icons with `grep -o "from \"lucide-react\"" -r app components` shows the package is already a dependency (it is — used in `app/account/page.tsx`).

- [ ] **Step 3: Commit**

```bash
git add components/checkout/checkout-result.tsx
git commit -m "feat(checkout): shared CheckoutResult component for post-payment pages"
```

---

## Task 2: `/checkout/success` page

**Files:**
- Create: `app/checkout/success/page.tsx`

- [ ] **Step 1: Create the page**

Public async server component. Ignores `searchParams` (Stripe appends none we use for the app variant). `robots: { index: false }` keeps this transactional page out of search.

```tsx
import type { Metadata } from "next";

import { CheckoutResult } from "@/components/checkout/checkout-result";

export const metadata: Metadata = {
  title: "Purchase complete",
  robots: { index: false },
};

export default function CheckoutSuccessPage() {
  return <CheckoutResult variant="success" />;
}
```

- [ ] **Step 2: Type-check + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Verify it renders without auth**

Run: `pnpm dev`, then in another terminal:
`curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/checkout/success`
Expected: `200` with **no** redirect_url (i.e. it does NOT 307 to `/login`). Optionally open `http://localhost:3000/checkout/success` in a browser and confirm the success copy renders centered.

- [ ] **Step 4: Commit**

```bash
git add app/checkout/success/page.tsx
git commit -m "feat(checkout): public /checkout/success page"
```

---

## Task 3: `/checkout/cancelled` page

**Files:**
- Create: `app/checkout/cancelled/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import type { Metadata } from "next";

import { CheckoutResult } from "@/components/checkout/checkout-result";

export const metadata: Metadata = {
  title: "Checkout cancelled",
  robots: { index: false },
};

export default function CheckoutCancelledPage() {
  return <CheckoutResult variant="cancelled" />;
}
```

- [ ] **Step 2: Type-check + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Verify it renders without auth**

Run (with `pnpm dev` running):
`curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/checkout/cancelled`
Expected: `200` with no redirect_url. Browser-check the cancelled copy renders.

- [ ] **Step 4: Commit**

```bash
git add app/checkout/cancelled/page.tsx
git commit -m "feat(checkout): public /checkout/cancelled page"
```

---

## Task 4: `origin` switch in `create-checkout-session`

**Files:**
- Modify: `supabase/functions/create-checkout-session/index.ts` (license branch, currently ~L116–147)

The current license branch ends like this (verify by reading the file first):

```ts
      const licenseMetadata = { user_id: user.id, purpose: "license" };
      const licenseSession = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        client_reference_id: user.id,
        payment_method_types: ["card"],
        line_items: [
          { price: requiredEnv("STRIPE_LICENSE_PRICE_ID"), quantity: 1 },
        ],
        metadata: licenseMetadata,
        payment_intent_data: { metadata: licenseMetadata },
        success_url:
          `${siteUrl}/account?license=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/account?license=cancelled`,
      });

      return jsonResponse({ url: licenseSession.url });
```

- [ ] **Step 1: Add the origin resolution + URL selection**

Replace the block above with this. The only changes: a whitelisted `origin` derivation (before the `create` call) and the two `*_url` lines now read from `successUrl`/`cancelUrl`.

```ts
      const licenseMetadata = { user_id: user.id, purpose: "license" };

      // Whitelisted redirect target. App buyers are authenticated in the app but
      // usually NOT in this browser, so /account would bounce them to /login —
      // route them to the public confirmation pages instead. Any value other
      // than "app" (including absent) keeps the original web behavior. Never echo
      // a client-supplied raw URL (open-redirect).
      const origin = body.origin === "app" ? "app" : "web";
      const successUrl = origin === "app"
        ? `${siteUrl}/checkout/success`
        : `${siteUrl}/account?license=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = origin === "app"
        ? `${siteUrl}/checkout/cancelled`
        : `${siteUrl}/account?license=cancelled`;

      const licenseSession = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        client_reference_id: user.id,
        payment_method_types: ["card"],
        line_items: [
          { price: requiredEnv("STRIPE_LICENSE_PRICE_ID"), quantity: 1 },
        ],
        metadata: licenseMetadata,
        payment_intent_data: { metadata: licenseMetadata },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      return jsonResponse({ url: licenseSession.url });
```

`body` is already the parsed request JSON (`const body = await req.json().catch(() => ({}));` earlier in the handler), so `body.origin` requires no other change.

- [ ] **Step 2: Type-check the function (Deno)**

Run: `supabase functions serve create-checkout-session --no-verify-jwt` briefly to confirm it boots without a type error, OR if Deno is installed: `deno check supabase/functions/create-checkout-session/index.ts`.
Expected: no type errors. (If neither is convenient, the deploy in Step 4 surfaces type errors at bundle time.)

- [ ] **Step 3: Verify URL selection logic locally (optional but recommended)**

With `supabase start` + `supabase functions serve --env-file .env.local` + a valid user token, POST `{ "purpose": "license", "origin": "app" }` and confirm the returned Stripe URL's session was created with `success_url` ending `/checkout/success`. Then POST `{ "purpose": "license" }` (no origin) and confirm it still uses `/account?license=success`. (Inspect via the Stripe test dashboard's session, or log `successUrl` temporarily.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-checkout-session/index.ts
git commit -m "feat(checkout): route app-originated license checkout to public confirmation pages"
```

---

## Task 5: Full build gate (woven-video)

**Files:** none (verification only)

- [ ] **Step 1: Type-check + lint + production build**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: all pass; `pnpm build` registers `/checkout/success` and `/checkout/cancelled` in the route list (look for them in the build output) and compiles with no errors.

- [ ] **Step 2: Commit any final fixes (if needed)**

```bash
git add -A && git commit -m "chore(checkout): final type/lint/build pass"
```

---

## Task 6: Harness one-liner (`woven-harness`)

**Files:**
- Modify: `woven-harness` `Sources/WovenHarness/WovenBackendClient.swift` (license checkout body, ~L81)

> This is a **separate repo** (`~/projects/woven-harness`). Ships independently — order doesn't matter: an old harness (no `origin`) keeps hitting `/account` exactly as today; a new harness reaches the new pages.

- [ ] **Step 1: Locate the license checkout request body**

Run (from `~/projects/woven-harness`):
`grep -n "purpose" Sources/WovenHarness/WovenBackendClient.swift`
This finds where the request body for `create-checkout-session` sets `"purpose": "license"` (the function that builds the POST to `functions/v1/create-checkout-session`).

- [ ] **Step 2: Add the `origin` key**

In that request body (a `[String: ...]` dictionary or an `Encodable` struct), add `"origin": "app"` alongside `"purpose": "license"`. For a dictionary body it is literally:

```swift
// before
let body = ["purpose": "license"]
// after
let body = ["purpose": "license", "origin": "app"]
```

If the body is an `Encodable` struct, add an `origin` field defaulting to `"app"` and include it in `CodingKeys`. Only the license checkout call needs this; do not touch the top-up call.

- [ ] **Step 3: Build the app**

Run the project's normal build (e.g. `xcodebuild -scheme WovenHarness build` or open in Xcode and build).
Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add Sources/WovenHarness/WovenBackendClient.swift
git commit -m "feat(license): send origin=app so checkout returns to the confirmation page"
```

---

## Deployment notes (rollout — see spec §8)

No new env vars, no migration, no Stripe dashboard change.

1. Open a PR for `feat/app-checkout-return`; merge to `main` → Vercel auto-deploys the two new pages. (The pages are unreachable in the normal flow until a client sends `origin: "app"`, so this is safe to ship before the harness.)
2. Redeploy the edge function: `supabase functions deploy create-checkout-session`. Backward-compatible — web checkout (`origin` absent) is byte-for-byte unchanged.
3. Ship the harness change in the next build whenever convenient.
4. Post-deploy E2E: from the app, buy with a **fresh post-2026-05-28 account** (own/grandfathered accounts return `alreadyLicensed` with no checkout). Confirm the browser lands on `/checkout/success` and the app unlocks on return; cancel a checkout and confirm `/checkout/cancelled`.

---

## Self-review notes

- **Spec coverage:** §1 edge `origin` switch → Task 4; §2a shared component → Task 1; §2b success page → Task 2; §2c cancelled page → Task 3; §3 harness one-liner → Task 6; §4 data flow + §5 edge cases exercised by the verification steps in Tasks 2–4 and the E2E in deployment notes; §6 testing approach → Tasks 2,3,5; §7 change surface = Tasks 1–4,6; §8 rollout → deployment notes. Full build gate → Task 5.
- **Type consistency:** `CheckoutResult` prop is `variant: "success" | "cancelled"` in Task 1 and both consumers (Tasks 2,3) pass exactly those literals. `origin` is `"app" | "web"` (derived) in Task 4; harness sends the matching `"app"` string in Task 6.
- **No new types/functions referenced that aren't defined here.** Pages import only `CheckoutResult` (Task 1) and `next` `Metadata`. Component imports only `next/link` + `lucide-react` (already a dependency).
- **No-placeholder check:** all steps contain concrete code/commands; copy is final (matches spec §2 Copy); no TBD/TODO.
- **One soft spot (flagged):** Task 6's exact Swift edit depends on the current body shape in `WovenBackendClient.swift`, which should be re-read at execution time — Step 1's grep locates it and Step 2 covers both dictionary and `Encodable` forms.
