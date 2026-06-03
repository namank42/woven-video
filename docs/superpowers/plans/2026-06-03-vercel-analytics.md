# Vercel Web Analytics + Speed Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vercel Web Analytics and Speed Insights to the site as a clean drop-in so baseline page-view traffic and real-user Core Web Vitals flow into the Vercel dashboard.

**Architecture:** Install the two official Vercel packages and render their components (`<Analytics/>`, `<SpeedInsights/>`) once, at the end of `<body>` in the root server-component layout. Each injects a first-party script served from `/_vercel/*` on our own origin. No custom events, no config props, no env vars.

**Tech Stack:** Next.js 16.2.3 (app router), React 19, `@vercel/analytics@^2`, `@vercel/speed-insights@^2`, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-03-vercel-analytics-design.md`

**Note on testing:** This repo has no unit-test runner (only `dev`/`build`/`start`/`lint`). For a one-file third-party-component integration, the meaningful gates are TypeScript typecheck, `pnpm build`, `pnpm lint`, and a post-deploy network-beacon check. The plan uses those instead of fabricating a test framework.

---

### Task 1: Install the two Vercel packages

**Files:**
- Modify: `package.json` (dependencies — written by pnpm)
- Modify: `pnpm-lock.yaml` (written by pnpm)

- [ ] **Step 1: Install both packages**

Run from the repo root (`/Users/naman/projects/woven-video`):

```bash
pnpm add @vercel/analytics @vercel/speed-insights
```

- [ ] **Step 2: Verify they resolved to v2 and exist on disk**

Run:

```bash
node -e "const p=require('./package.json'); console.log(p.dependencies['@vercel/analytics'], p.dependencies['@vercel/speed-insights'])"
ls node_modules/@vercel/analytics/dist/next/index.mjs node_modules/@vercel/speed-insights/dist/next/index.mjs
```

Expected: two version strings printed (e.g. `^2.0.1 ^2.0.0`), and both `dist/next/index.mjs` paths exist (no "No such file" error). The `/next` subpath is the entry point used in Task 2.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add @vercel/analytics and @vercel/speed-insights"
```

---

### Task 2: Render the components in the root layout

**Files:**
- Modify: `app/layout.tsx` (imports near top; two JSX tags inside `<body>` at lines ~95)

- [ ] **Step 1: Add the two imports**

In `app/layout.tsx`, add these imports immediately after the existing `import "./globals.css";` line (line 3):

```tsx
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
```

Use the `/next` subpaths exactly — they wire up app-router-aware pageview tracking automatically. Do **not** add a `"use client"` directive to the layout; these are client components but mount fine inside the server-component layout.

- [ ] **Step 2: Render both components as the last children of `<body>`**

Replace the current body element:

```tsx
      <body className="min-h-full flex flex-col">{children}</body>
```

with:

```tsx
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
```

- [ ] **Step 3: Typecheck and lint**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: both pass with no errors. If `tsc --noEmit` complains about an unrelated pre-existing error, confirm it is not in `app/layout.tsx` and not about the `@vercel/*` imports before proceeding.

- [ ] **Step 4: Production build**

Run:

```bash
pnpm build
```

Expected: build completes successfully. The `/` route and others still compile; no module-resolution error for `@vercel/analytics/next` or `@vercel/speed-insights/next`.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: add Vercel Web Analytics and Speed Insights"
```

---

### Task 3: Local smoke check

**Files:** none (runtime verification only)

- [ ] **Step 1: Start the dev server**

Run:

```bash
pnpm dev
```

- [ ] **Step 2: Confirm the page renders and the scripts mount**

Load `http://localhost:3000` in a browser. In DevTools → Network, filter for `_vercel`. In local dev the beacons are no-ops (this is expected — they only collect in production), but the page must render without console errors referencing `@vercel/analytics` or `@vercel/speed-insights`.

Expected: home page renders normally; no analytics-related runtime errors in the console.

- [ ] **Step 3: Stop the dev server**

Stop the `pnpm dev` process (Ctrl-C). No commit — this task changes no files.

---

## Post-merge manual step (user, in the Vercel dashboard)

Not a code task — record it in the PR description so it is not missed:

Enable the per-project toggles in the Vercel dashboard — the project's **Analytics** tab and **Speed Insights** tab. Code is necessary but data only collects once both are on.

After deploy with the toggles enabled: load the production site, open DevTools → Network, and confirm a beacon fires to `/_vercel/insights/view`. Within a few minutes the Vercel Analytics and Speed Insights dashboards should begin showing data.

---

## Rollback

Remove the two imports and the two JSX tags from `app/layout.tsx`, then `pnpm remove @vercel/analytics @vercel/speed-insights`. No data migrations, env vars, or infra changes are involved.
