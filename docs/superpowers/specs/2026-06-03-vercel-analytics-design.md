# Vercel Web Analytics + Speed Insights

**Date:** 2026-06-03
**Status:** Approved — ready for implementation plan

## Summary

Add Vercel Web Analytics (page views, route changes) and Speed Insights (Core
Web Vitals on real visitors) to the marketing/app site as a clean drop-in. No
custom event instrumentation in this pass.

## Goal

Get baseline web traffic and real-user performance data flowing into the Vercel
dashboard with the smallest possible footprint, so future decisions (including
the $99 license funnel) have a measurement substrate to build on.

## Non-goals

- Custom `track()` events (e.g. pricing-viewed, checkout-started,
  purchase-success, download-clicked). Explicitly deferred — easy to layer on
  later.
- Sampling, `beforeSend` redaction, or any configuration props on the
  components.
- Any change to the existing Supabase `analytics_events` product-analytics
  stream. That is in-app behavior tracking and is unrelated to this web
  analytics work.

## Context

- Next.js 16.2.3, React 19, deployed on Vercel. Root layout
  (`app/layout.tsx`) is a server component.
- No web analytics exists today — `@vercel/analytics` is not installed and no
  `<Analytics/>` is rendered anywhere.
- `proxy.ts` (Next 16's renamed middleware) matches only `/account`, `/auth`,
  `/login`, `/api/*`. It does not touch `/_vercel/*`, so the injected analytics
  scripts are unaffected.
- No Content-Security-Policy headers are set, so the first-party scripts load
  without CSP changes.

## Dependencies

Installed via pnpm:

- `@vercel/analytics` (^2 — latest 2.0.1)
- `@vercel/speed-insights` (^2 — latest 2.0.0)

Both expose a `/next` subpath export that is the correct entry point for the
Next.js app router.

## Implementation

Single file changed: `app/layout.tsx`.

1. Add imports at the top, using the Next-specific subpaths (these wire up
   route-aware pageview tracking automatically for the app router):

   ```tsx
   import { Analytics } from "@vercel/analytics/next";
   import { SpeedInsights } from "@vercel/speed-insights/next";
   ```

2. Render both components as the last children inside `<body>`, after
   `{children}`:

   ```tsx
   <body className="min-h-full flex flex-col">
     {children}
     <Analytics />
     <SpeedInsights />
   </body>
   ```

   Both are client components internally; they mount fine inside this
   server-component layout. The layout does **not** need a `"use client"`
   directive.

## How data flows

- Each component injects a first-party script served from the visitor's own
  origin: `/_vercel/insights/*` (analytics) and `/_vercel/speed-insights/*`
  (speed insights). No third-party origin, so no CSP allowlist needed.
- Web Analytics is **cookieless** — no consent banner is required and no
  privacy-policy change is forced by this work.
- In local development the components are effectively no-ops (no beacons unless
  debug mode is on), so local runs will not pollute production data.

## Required manual step (outside code)

Web Analytics and Speed Insights each have a per-project enable toggle in the
Vercel dashboard (the project's **Analytics** and **Speed Insights** tabs). The
code is necessary but data is only collected once those toggles are on. This
step is performed by the user; it cannot be done from the codebase.

## Verification

- `pnpm install` adds both packages without peer-dependency errors.
- `pnpm build` and TypeScript typecheck pass.
- Both `<Analytics/>` and `<SpeedInsights/>` are present in the rendered layout.
- After deploy (with dashboard toggles on): loading the site fires a beacon to
  `/_vercel/insights/view` (visible in the browser Network tab), and the Vercel
  Analytics / Speed Insights dashboards begin showing data.

## Rollback

Remove the two imports and two JSX tags from `app/layout.tsx` and drop the two
packages. No data migrations, env vars, or infra changes are involved.
