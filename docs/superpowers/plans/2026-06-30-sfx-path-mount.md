# Woven SFX Path Mount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve Woven SFX canonically at `https://www.woven.video/sfx`, keep `woven-sfx` independently deployed, and redirect the old `sfx.woven.video` landing host.

**Architecture:** `woven-video` owns `www.woven.video` and uses Next rewrites to proxy `/sfx` requests to an independently deployed `woven-sfx` Vercel project. The Astro SFX site is built with `base: "/sfx"` and canonical metadata for `https://www.woven.video/sfx`, while Cloudflare R2 remains the `.wav` asset host.

**Tech Stack:** Vercel Projects, Next 16.2.3 rewrites, Astro 7.0.3 static output, React islands, Cloudflare Workers redirect, Cloudflare R2 audio assets.

**Docs digest:** `docs/superpowers/research/2026-06-30-sfx-path-routing-docs.md`

**Spec:** `docs/superpowers/specs/2026-06-30-sfx-path-mount-design.md`

---

## Implementation Assumptions

- The SFX Vercel project will be named `woven-sfx`, giving the upstream origin `https://woven-sfx.vercel.app`.
- Production `SFX_ORIGIN` on the `woven-video` Vercel project must be set to `https://woven-sfx.vercel.app`.
- If Vercel returns a different production domain during project creation, use that exact origin anywhere this plan says `https://woven-sfx.vercel.app`.
- Code changes touch two repos:
  - `/Users/naman/projects/woven-video`
  - `/Users/naman/projects/woven-sfx`

## File Map

### `woven-sfx`

| Path | Responsibility |
|---|---|
| `apps/web/astro.config.mjs` | Configure Astro `site` and `base` for `/sfx` |
| `apps/web/src/lib/site-paths.ts` | Shared helpers for base-prefixed public paths |
| `apps/web/src/pages/index.astro` | Base-aware favicon URLs |
| `apps/web/src/components/SiteHeader.astro` | Base-aware home/logo URLs |
| `apps/web/src/components/SiteFooter.astro` | Base-aware logo and machine-readable links |
| `apps/web/src/components/CatalogSection.tsx` | Fetch `/sfx/catalog.json` instead of root `/catalog.json` |
| `apps/web/src/components/SfxWaveform.tsx` | Fetch `/sfx/peaks/:id.json` instead of root `/peaks/:id.json` |
| `apps/web/src/lib/seo/constants.ts` | Canonical SFX URL and OG image URL |
| `apps/web/src/lib/seo/schema.ts` | JSON-LD paths derived from canonical SFX URL |
| `apps/web/src/lib/seo/faqs.ts` | Public copy mentioning catalog URL |
| `scripts/build-catalog.ts` | Generate canonical `peaks_url` values for the public catalog |
| `apps/web/public/robots.txt` | Canonical host/sitemap references |
| `apps/web/public/sitemap.xml` | Canonical `/sfx` URLs |
| `apps/web/public/llms.txt` | Canonical machine-readable catalog URL |
| `apps/web/public/install.sh` | Canonical displayed catalog URL |
| `apps/web/public/skill.md` | Canonical site references |
| `apps/web/src/worker.ts` | Legacy redirect behavior for `sfx.woven.video` |
| `apps/web/wrangler.jsonc` | Cloudflare Worker route for legacy redirect only |

### `woven-video`

| Path | Responsibility |
|---|---|
| `next.config.ts` | Proxy `/sfx` paths to `SFX_ORIGIN` |
| `components/site-footer.tsx` | Link Woven SFX to `/sfx` |
| `app/sitemap.ts` | Include canonical `/sfx` URL |

---

### Task 1: Configure Astro for `/sfx`

**Files:**
- Modify: `/Users/naman/projects/woven-sfx/apps/web/astro.config.mjs`
- Create: `/Users/naman/projects/woven-sfx/apps/web/src/lib/site-paths.ts`

- [ ] **Step 1: Update Astro config**

Replace `apps/web/astro.config.mjs` with:

```js
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  site: "https://www.woven.video",
  base: "/sfx",
  output: "static",
  integrations: [react()],
  vite: {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    plugins: [tailwindcss()],
  },
});
```

- [ ] **Step 2: Add base-path helper**

Create `apps/web/src/lib/site-paths.ts`:

```ts
const baseUrl = import.meta.env.BASE_URL;

export const SITE_BASE_PATH = baseUrl.endsWith("/")
  ? baseUrl.slice(0, -1)
  : baseUrl;

export function withSiteBase(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_BASE_PATH}${normalizedPath}`;
}
```

- [ ] **Step 3: Build to verify config loads**

Run:

```bash
pnpm --dir /Users/naman/projects/woven-sfx/apps/web build
```

Expected: Astro build succeeds. At this point some site links may still be root-relative; later tasks fix those.

- [ ] **Step 4: Commit**

Run:

```bash
cd /Users/naman/projects/woven-sfx
git add apps/web/astro.config.mjs apps/web/src/lib/site-paths.ts
git commit -m "feat(web): configure sfx base path"
```

Expected: commit succeeds in the `woven-sfx` repo.

---

### Task 2: Make SFX Page And Component URLs Base-Aware

**Files:**
- Modify: `/Users/naman/projects/woven-sfx/apps/web/src/pages/index.astro`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/src/components/SiteHeader.astro`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/src/components/SiteFooter.astro`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/src/components/CatalogSection.tsx`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/src/components/SfxWaveform.tsx`

- [ ] **Step 1: Update `index.astro` favicon paths**

Add the helper import:

```astro
---
import "../styles/global.css";
import SeoHead from "../components/SeoHead.astro";
import SiteHeader from "../components/SiteHeader.astro";
import SiteFooter from "../components/SiteFooter.astro";
import Hero from "../components/Hero.astro";
import CatalogSection from "../components/CatalogSection.tsx";
import { withSiteBase } from "../lib/site-paths";
---
```

Change favicon links to:

```astro
<link rel="icon" href={withSiteBase("/icon.png")} type="image/png" />
<link rel="icon" href={withSiteBase("/favicon.ico")} sizes="any" />
```

- [ ] **Step 2: Update `SiteHeader.astro`**

Add:

```astro
---
import { withSiteBase } from "../lib/site-paths";

const externalLinkClass =
  "inline-flex items-center gap-1 transition-colors hover:text-foreground";
---
```

Change the home/logo block to:

```astro
<a href={withSiteBase("/")} class="flex items-center gap-2" aria-label="Woven SFX home">
  <img
    src={withSiteBase("/woven-logo.png")}
    alt=""
    width="28"
    height="28"
    class="size-7 shrink-0 rounded-md dark:invert"
  />
  <span class="font-heading text-base font-medium">Woven SFX</span>
</a>
```

Change the Woven link to the canonical main site:

```astro
href="https://www.woven.video"
```

- [ ] **Step 3: Update `SiteFooter.astro`**

Add:

```astro
---
import { withSiteBase } from "../lib/site-paths";

const externalLinkClass =
  "inline-flex items-center gap-1 transition-colors hover:text-foreground";
---
```

Change footer logo and local links:

```astro
<img
  src={withSiteBase("/woven-logo.png")}
  alt="Woven"
  width="100"
  height="28"
  class="h-5 w-auto dark:invert"
/>
```

```astro
<a href={withSiteBase("/catalog.json")} class="hover:text-foreground">catalog.json</a>
<a href={withSiteBase("/llms.txt")} class="hover:text-foreground">llms.txt</a>
```

Change the Woven link to:

```astro
href="https://www.woven.video"
```

- [ ] **Step 4: Update catalog fetch**

In `CatalogSection.tsx`, add:

```ts
import { withSiteBase } from "@/lib/site-paths";
```

Change:

```ts
fetch("/catalog.json")
```

to:

```ts
fetch(withSiteBase("/catalog.json"))
```

- [ ] **Step 5: Update peaks fetch**

In `SfxWaveform.tsx`, add:

```ts
import { withSiteBase } from "@/lib/site-paths";
```

Change:

```ts
fetch(`/peaks/${id}.json`)
```

to:

```ts
fetch(withSiteBase(`/peaks/${id}.json`))
```

- [ ] **Step 6: Build and inspect emitted URLs**

Run:

```bash
pnpm --dir /Users/naman/projects/woven-sfx/apps/web build
rg -n 'href="/catalog\.json|href="/llms\.txt|src="/woven-logo\.png|src="/icon\.png|fetch\("/catalog\.json"|fetch\(`/peaks/|https://woven.video|https://sfx.woven.video' /Users/naman/projects/woven-sfx/apps/web/dist
```

Expected: build succeeds. The `rg` command may still find SEO/public-file references to `https://sfx.woven.video`; those are fixed in Task 3. It should not find root-relative `href="/catalog.json"`, `src="/woven-logo.png"`, `fetch("/catalog.json")`, or `fetch(\`/peaks/`.

- [ ] **Step 7: Commit**

Run:

```bash
cd /Users/naman/projects/woven-sfx
git add apps/web/src/pages/index.astro apps/web/src/components/SiteHeader.astro apps/web/src/components/SiteFooter.astro apps/web/src/components/CatalogSection.tsx apps/web/src/components/SfxWaveform.tsx
git commit -m "fix(web): prefix sfx public paths"
```

Expected: commit succeeds in the `woven-sfx` repo.

---

### Task 3: Move SFX SEO And Public Files To `/sfx`

**Files:**
- Modify: `/Users/naman/projects/woven-sfx/apps/web/src/lib/seo/constants.ts`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/src/lib/seo/faqs.ts`
- Modify: `/Users/naman/projects/woven-sfx/scripts/build-catalog.ts`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/public/catalog.json`
- Modify: `/Users/naman/projects/woven-sfx/packages/mcp/catalog.json`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/public/robots.txt`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/public/sitemap.xml`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/public/llms.txt`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/public/install.sh`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/public/skill.md`
- Modify: `/Users/naman/projects/woven-sfx/README.md`

- [ ] **Step 1: Update canonical constants**

In `apps/web/src/lib/seo/constants.ts`, change:

```ts
export const SITE_URL = "https://sfx.woven.video";
```

to:

```ts
export const SITE_URL = "https://www.woven.video/sfx";
```

`OG_IMAGE_URL` should continue to be:

```ts
export const OG_IMAGE_URL = `${SITE_URL}/og-image.png?v=20260629-2`;
```

- [ ] **Step 2: Update FAQ public URL copy**

In `apps/web/src/lib/seo/faqs.ts`, replace user-facing `sfx.woven.video/catalog.json` references with:

```text
www.woven.video/sfx/catalog.json
```

- [ ] **Step 3: Update catalog generator**

In `scripts/build-catalog.ts`, add:

```ts
const SFX_SITE_URL =
  process.env.SFX_SITE_URL ?? "https://www.woven.video/sfx";
```

Change generated `peaks_url` from:

```ts
peaks_url: sound.peaks_url ?? `/peaks/${sound.id}.json`,
```

to:

```ts
peaks_url: sound.peaks_url ?? `${SFX_SITE_URL}/peaks/${sound.id}.json`,
```

Keep `SFX_ASSET_BASE_URL` unchanged so audio files stay on:

```text
https://assets.sfx.woven.video/sfx/*.wav
```

- [ ] **Step 4: Regenerate catalog files**

Run:

```bash
pnpm --dir /Users/naman/projects/woven-sfx build:catalog
```

Expected: `apps/web/public/catalog.json` and `packages/mcp/catalog.json` are regenerated. Audio `url` values remain on `assets.sfx.woven.video`; `peaks_url` values use `https://www.woven.video/sfx/peaks/...`.

- [ ] **Step 5: Update public text assets**

Replace landing-site references:

```text
https://sfx.woven.video
```

with:

```text
https://www.woven.video/sfx
```

in:

```text
apps/web/public/robots.txt
apps/web/public/sitemap.xml
apps/web/public/llms.txt
apps/web/public/install.sh
apps/web/public/skill.md
README.md
```

Do not replace `https://assets.sfx.woven.video`.

- [ ] **Step 6: Build and verify canonical output**

Run:

```bash
pnpm --dir /Users/naman/projects/woven-sfx/apps/web build
rg -n 'https://sfx\.woven\.video|href="/catalog\.json|href="/llms\.txt|src="/woven-logo\.png|src="/icon\.png|fetch\("/catalog\.json"|fetch\(`/peaks/' /Users/naman/projects/woven-sfx/apps/web/dist
```

Expected:

- No `https://sfx.woven.video` in `dist`.
- `https://assets.sfx.woven.video` may appear in `catalog.json`.
- HTML references `/sfx/_astro/...`, `/sfx/icon.png`, `/sfx/woven-logo.png`, `/sfx/catalog.json`, `/sfx/llms.txt`, and canonical `https://www.woven.video/sfx`.

- [ ] **Step 7: Commit**

Run:

```bash
cd /Users/naman/projects/woven-sfx
git add apps/web/src/lib/seo/constants.ts apps/web/src/lib/seo/faqs.ts scripts/build-catalog.ts apps/web/public/catalog.json packages/mcp/catalog.json apps/web/public/robots.txt apps/web/public/sitemap.xml apps/web/public/llms.txt apps/web/public/install.sh apps/web/public/skill.md README.md
git commit -m "fix(web): canonicalize sfx under woven video"
```

Expected: commit succeeds in the `woven-sfx` repo.

---

### Task 4: Add Main-Site `/sfx` Rewrites

**Files:**
- Modify: `/Users/naman/projects/woven-video/next.config.ts`
- Modify: `/Users/naman/projects/woven-video/components/site-footer.tsx`
- Modify: `/Users/naman/projects/woven-video/app/sitemap.ts`

- [ ] **Step 1: Add `SFX_ORIGIN` rewrite support**

Replace `next.config.ts` with:

```ts
import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const sfxOrigin =
  process.env.SFX_ORIGIN?.replace(/\/$/, "") ?? "https://woven-sfx.vercel.app";

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],
  async rewrites() {
    return [
      {
        source: "/sfx",
        destination: `${sfxOrigin}/`,
      },
      {
        source: "/sfx/:path*",
        destination: `${sfxOrigin}/:path*`,
      },
    ];
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
```

This strips the public `/sfx` prefix before proxying, which matches Astro's static output layout.

- [ ] **Step 2: Point footer link to canonical path**

In `components/site-footer.tsx`, replace:

```tsx
<a
  href="https://sfx.woven.video"
  className="hover:text-foreground"
>
  Woven SFX
</a>
```

with:

```tsx
<a href="/sfx" className="hover:text-foreground">
  Woven SFX
</a>
```

Keep this as a plain `<a>` tag because `/sfx` is a separate app behind a rewrite.

- [ ] **Step 3: Add `/sfx` to the main sitemap**

In `app/sitemap.ts`, add this object after the pricing entry:

```ts
{
  url: `${SITE_URL}/sfx`,
  lastModified: contentUpdated,
  changeFrequency: "monthly",
  priority: 0.75,
},
```

- [ ] **Step 4: Build the main site**

Run:

```bash
pnpm --dir /Users/naman/projects/woven-video build
```

Expected: Next build succeeds.

- [ ] **Step 5: Commit**

Run:

```bash
cd /Users/naman/projects/woven-video
git add next.config.ts components/site-footer.tsx app/sitemap.ts
git commit -m "feat(site): mount sfx under main domain"
```

Expected: commit succeeds in the `woven-video` repo.

---

### Task 5: Add Legacy `sfx.woven.video` Redirect

**Files:**
- Modify: `/Users/naman/projects/woven-sfx/apps/web/src/worker.ts`
- Modify: `/Users/naman/projects/woven-sfx/apps/web/wrangler.jsonc`

- [ ] **Step 1: Replace landing Worker behavior with redirect behavior**

Replace `apps/web/src/worker.ts` with:

```ts
interface Env {
  ASSETS: Fetcher;
}

const SFX_ASSET_ORIGIN = "https://assets.sfx.woven.video";
const CANONICAL_SFX_ORIGIN = "https://www.woven.video";

function canonicalSfxPath(pathname: string): string {
  if (pathname === "/" || pathname === "") {
    return "/sfx";
  }

  return `/sfx${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === "sfx.woven.video") {
      return Response.redirect(
        `${CANONICAL_SFX_ORIGIN}${canonicalSfxPath(url.pathname)}${url.search}`,
        301,
      );
    }

    if (url.pathname.startsWith("/sfx/")) {
      return Response.redirect(`${SFX_ASSET_ORIGIN}${url.pathname}`, 301);
    }

    return env.ASSETS.fetch(request);
  },
};
```

- [ ] **Step 2: Keep Cloudflare route limited to old host**

Keep `apps/web/wrangler.jsonc` route pattern as:

```jsonc
{
  "name": "woven-sfx",
  "main": "src/worker.ts",
  "compatibility_date": "2026-06-28",
  "routes": [
    {
      "pattern": "sfx.woven.video",
      "custom_domain": true
    }
  ],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "404-page"
  }
}
```

This Worker remains only to redirect old landing-site requests. It does not route `www.woven.video`.

- [ ] **Step 3: Build and deploy redirect Worker**

Run:

```bash
pnpm --dir /Users/naman/projects/woven-sfx/apps/web build
pnpm --dir /Users/naman/projects/woven-sfx/apps/web deploy
```

Expected: build succeeds and Wrangler deploys the Worker.

- [ ] **Step 4: Verify redirects**

Run:

```bash
curl -I https://sfx.woven.video
curl -I https://sfx.woven.video/catalog.json
curl -I https://sfx.woven.video/llms.txt
```

Expected:

- `https://sfx.woven.video` returns `301` with `location: https://www.woven.video/sfx`.
- `https://sfx.woven.video/catalog.json` returns `301` with `location: https://www.woven.video/sfx/catalog.json`.
- `https://sfx.woven.video/llms.txt` returns `301` with `location: https://www.woven.video/sfx/llms.txt`.

- [ ] **Step 5: Commit**

Run:

```bash
cd /Users/naman/projects/woven-sfx
git add apps/web/src/worker.ts apps/web/wrangler.jsonc
git commit -m "fix(web): redirect legacy sfx host"
```

Expected: commit succeeds in the `woven-sfx` repo.

---

### Task 6: Create And Configure The SFX Vercel Project

**Files:** none

- [ ] **Step 1: Create the `woven-sfx` Vercel project**

Use the Vercel dashboard or CLI with these settings:

```text
Project name: woven-sfx
Repository: woven-sfx
Framework preset: Astro
Root directory: .
Install command: pnpm install --frozen-lockfile
Build command: pnpm --dir apps/web build
Output directory: apps/web/dist
Node.js version: 22.x
Production domain: https://woven-sfx.vercel.app
```

Expected: the project deploys and `https://woven-sfx.vercel.app` returns the SFX Astro page.

- [ ] **Step 2: Verify the upstream root and files**

Run:

```bash
curl -I https://woven-sfx.vercel.app/
curl -I https://woven-sfx.vercel.app/catalog.json
curl -I https://woven-sfx.vercel.app/_astro/
```

Expected:

- Root returns `200`.
- `catalog.json` returns `200`.
- `_astro/` may return `404` because it is a directory, but concrete files under `_astro` are served when requested by HTML.

- [ ] **Step 3: Set `SFX_ORIGIN` in the main Vercel project**

Set this environment variable on the `woven-video` Vercel project for Production and Preview:

```text
SFX_ORIGIN=https://woven-sfx.vercel.app
```

Expected: future `woven-video` deployments proxy `/sfx` to the SFX upstream.

---

### Task 7: Verify Local Composition

**Files:** none

- [ ] **Step 1: Start local SFX server**

Run in one terminal:

```bash
pnpm --dir /Users/naman/projects/woven-sfx/apps/web dev:ui
```

Expected: Astro dev server starts on port `4321`.

- [ ] **Step 2: Start local main site against SFX server**

Run in another terminal:

```bash
cd /Users/naman/projects/woven-video
SFX_ORIGIN=http://127.0.0.1:4321 pnpm dev
```

Expected: Next dev server starts on port `3000`.

- [ ] **Step 3: Verify proxied local paths**

Run:

```bash
curl -I http://127.0.0.1:3000/sfx
curl -I http://127.0.0.1:3000/sfx/catalog.json
curl -I http://127.0.0.1:3000/sfx/llms.txt
curl -sS http://127.0.0.1:3000/sfx | rg 'canonical|/sfx/_astro|/sfx/catalog.json|https://www.woven.video/sfx'
```

Expected:

- `/sfx`, `/sfx/catalog.json`, and `/sfx/llms.txt` return `200`.
- HTML includes canonical `/sfx` metadata and `/sfx/_astro` asset URLs.

- [ ] **Step 4: Stop dev servers**

Stop both running dev server sessions with `Ctrl-C`.

Expected: no long-running sessions remain.

---

### Task 8: Deploy And Verify Production

**Files:** none

- [ ] **Step 1: Deploy SFX Vercel project**

Deploy `woven-sfx` to Vercel production.

Expected: `https://woven-sfx.vercel.app` serves the latest SFX build.

- [ ] **Step 2: Deploy main Woven site**

Deploy `woven-video` to Vercel production with:

```text
SFX_ORIGIN=https://woven-sfx.vercel.app
```

Expected: `https://www.woven.video/sfx` proxies to the SFX upstream.

- [ ] **Step 3: Verify production status codes**

Run:

```bash
curl -I https://www.woven.video/sfx
curl -I https://www.woven.video/sfx/catalog.json
curl -I https://www.woven.video/sfx/llms.txt
curl -I https://www.woven.video/sfx/peaks/base-drop.json
curl -I https://assets.sfx.woven.video/sfx/base-drop.wav
```

Expected: all return `200`.

- [ ] **Step 4: Verify production HTML signals**

Run:

```bash
curl -sS https://www.woven.video/sfx | rg 'rel="canonical"|https://www.woven.video/sfx|/sfx/_astro|/sfx/catalog.json|https://sfx.woven.video|https://woven-sfx.vercel.app'
```

Expected:

- Output includes canonical `https://www.woven.video/sfx`.
- Output includes `/sfx/_astro`.
- Output does not include `https://sfx.woven.video`.
- Output does not include `https://woven-sfx.vercel.app`.

- [ ] **Step 5: Verify old host redirects**

Run:

```bash
curl -I https://sfx.woven.video
curl -I https://sfx.woven.video/catalog.json
curl -I https://sfx.woven.video/llms.txt
```

Expected: all return `301` to matching `https://www.woven.video/sfx...` URLs.

- [ ] **Step 6: Verify sitemap**

Run:

```bash
curl -sS https://www.woven.video/sitemap.xml | rg 'https://www.woven.video/sfx'
```

Expected: sitemap contains `https://www.woven.video/sfx`.

---

### Task 9: Post-Launch SEO Cleanup

**Files:** none

- [ ] **Step 1: Inspect in Search Console**

Use Google Search Console URL inspection for:

```text
https://www.woven.video/sfx
```

Expected: Google can fetch the page, page is indexable, canonical is `https://www.woven.video/sfx`.

- [ ] **Step 2: Submit sitemap**

Submit or refresh:

```text
https://www.woven.video/sitemap.xml
```

Expected: sitemap submission succeeds and includes `/sfx`.

- [ ] **Step 3: Check for duplicate host indexing after crawl**

After Google recrawls, search for:

```text
site:sfx.woven.video
site:woven-sfx.vercel.app
```

Expected: no indexable SFX landing pages remain under the old host or upstream host.

If the upstream Vercel host appears in search results, add host-specific redirect handling in the SFX app or Vercel project settings that redirects direct `woven-sfx.vercel.app` requests to `https://www.woven.video/sfx` without changing responses served through the main-site rewrite.
