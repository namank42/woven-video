# Woven SFX Path Mount Design

**Date:** 2026-06-30
**Status:** Approved design - pending written-spec review
**Canonical URL:** `https://www.woven.video/sfx`
**Repos:** `woven-video` owns the public domain; `woven-sfx` owns the SFX app and catalog
**Docs digest:** `docs/superpowers/research/2026-06-30-sfx-path-routing-docs.md`

---

## Purpose

Move Woven SFX from a standalone Cloudflare-hosted landing site at `sfx.woven.video` to the canonical path `https://www.woven.video/sfx`.

The goal is for users, crawlers, social cards, structured data, sitemaps, and internal links to read Woven SFX as part of `www.woven.video/sfx`, while keeping the SFX app independently deployable from the `woven-sfx` repo. The old `sfx.woven.video` host should become a permanent redirect. Cloudflare R2 remains the audio asset host at `assets.sfx.woven.video`.

Not in scope:

- Moving `.wav` files off Cloudflare R2.
- Putting `www.woven.video` behind Cloudflare just for SFX routing.
- Rebuilding the Astro SFX app inside the main Next app.
- Adding accounts, billing, or new SFX product features.

---

## Architecture

`www.woven.video` stays attached to the main `woven-video` Vercel project. `woven-sfx` is deployed as its own Vercel project from the separate `woven-sfx` repo. The SFX Vercel production domain is infrastructure only and is not shown to users or crawlers as the canonical URL.

The main Next app routes SFX traffic with external rewrites:

- `/sfx` rewrites to the SFX upstream root.
- `/sfx/:path*` rewrites to the matching upstream path.

The browser address remains `https://www.woven.video/sfx...` for all SFX landing, catalog, install, and static asset requests. The SFX Astro app must be built for the public base path `/sfx`, so generated script/style URLs, public asset URLs, catalog fetches, and peak fetches resolve under `/sfx`.

A scratch Astro build with `--base /sfx` confirmed the expected proxy shape: Astro keeps generated files at the upstream output root (`index.html`, `catalog.json`, `_astro/...`) while emitting public asset URLs prefixed with `/sfx`. Therefore the main Next rewrite strips the public `/sfx` prefix when proxying to the SFX upstream.

The old Cloudflare landing Worker is replaced by a redirect-only behavior for `sfx.woven.video`, then can be removed once redirects are stable. Cloudflare R2 stays in place for audio files, because `assets.sfx.woven.video/sfx/*.wav` are media assets rather than competing HTML pages.

---

## Chosen Approach

Use the Vercel path-mount composition pattern:

1. Deploy `woven-sfx` as a separate Vercel project.
2. Configure the SFX Astro app for `base: "/sfx"` and `site: "https://www.woven.video"`.
3. Configure `woven-video` with `SFX_ORIGIN` and Next rewrites for `/sfx`.
4. Make `/sfx` the only canonical public landing URL.
5. Redirect `sfx.woven.video/*` to `https://www.woven.video/sfx/*`.

This is preferred over moving SFX into the main Next app because SFX remains an open-source, independently deployable tool with its own catalog and MCP package. It is preferred over Cloudflare path routing because the main domain already serves from Vercel, and adding Cloudflare in front of `www.woven.video` would be unnecessary edge architecture for one static app.

Vercel Microfrontends are not required for this initial migration. A normal external rewrite is enough for one mounted Astro app. Microfrontends can be reconsidered later if Woven accumulates several independently deployed apps with shared production routing needs.

---

## Canonical And SEO Behavior

`https://www.woven.video/sfx` is the only canonical landing URL for Woven SFX.

Required signals:

- The SFX page canonical tag points to `https://www.woven.video/sfx`.
- OG and Twitter metadata use `https://www.woven.video/sfx` and `/sfx` image URLs.
- JSON-LD `Organization`, `WebSite`, `SoftwareApplication`, `Dataset`, and `WebPage` nodes use `/sfx` URLs.
- The SFX sitemap lists `https://www.woven.video/sfx...` URLs only.
- The main Woven sitemap includes `https://www.woven.video/sfx`.
- Main-site footer and navigation links use `/sfx`.
- `sfx.woven.video/*` permanently redirects to matching `https://www.woven.video/sfx/*` URLs.
- The SFX Vercel upstream domain is never included in public links, sitemaps, canonical tags, install copy, or structured data.

Direct requests to the SFX upstream Vercel host are treated as infrastructure access. The implementation should not add global `noindex` headers to the SFX Vercel project, because those headers may be forwarded through the main-site rewrite and accidentally noindex `/sfx`. If Vercel supports restricting or redirecting direct upstream-host traffic without affecting rewritten traffic, use it as defense in depth; otherwise rely on the canonical metadata, sitemap, internal links, and old-subdomain redirects all converging on `/sfx`.

R2 audio URLs remain at `https://assets.sfx.woven.video/sfx/*.wav`. They do not create duplicate landing-page risk because they are media files, not indexable HTML copies of the SFX site.

---

## Repo Boundaries

### `woven-sfx`

Responsibilities:

- Own the SFX Astro app, catalog, public machine-readable files, install copy, MCP package, and sound metadata.
- Build the static site with `/sfx` as the public base path.
- Keep all HTML metadata and structured data canonical to `https://www.woven.video/sfx`.
- Keep audio file URLs pointed at `assets.sfx.woven.video`.
- Provide a Vercel deployment that can act as the upstream for the main site rewrite.

Expected changes:

- Astro config gains `site: "https://www.woven.video"` and `base: "/sfx"`.
- Root-relative asset and fetch paths are replaced with base-aware helpers using Astro's `import.meta.env.BASE_URL`.
- `catalog.json` peak URLs and public files such as `robots.txt`, `sitemap.xml`, `llms.txt`, `skill.md`, and `install.sh` are updated to reference `/sfx` canonical URLs where they mention the public site.
- The Cloudflare Worker landing-site config is either removed from the primary deploy path or reduced to legacy-host redirects during migration.

### `woven-video`

Responsibilities:

- Own `www.woven.video` and route `/sfx` traffic to the SFX upstream.
- Keep SFX visible in the main site's internal link and sitemap graph.
- Avoid applying account/auth session refresh logic to `/sfx`.

Expected changes:

- `next.config.ts` defines rewrites for `/sfx` and `/sfx/:path*`.
- `SFX_ORIGIN` points to the SFX Vercel production origin.
- Footer links move from `https://sfx.woven.video` to `/sfx` and use a plain anchor rather than `next/link`.
- `app/sitemap.ts` includes `/sfx`.

### Cloudflare

Responsibilities:

- Continue serving audio files from R2 at `assets.sfx.woven.video`.
- Redirect old landing-site traffic from `sfx.woven.video` to `/sfx` during migration.

Cloudflare should not be introduced in front of `www.woven.video` as part of this change.

---

## Routing And Data Flow

### Page Request

1. User or crawler requests `https://www.woven.video/sfx`.
2. Vercel serves the `woven-video` project.
3. Next rewrite proxies the request to the SFX Vercel upstream root.
4. The response body is the Astro-generated SFX page, with public URLs pointing at `/sfx`.
5. Browser URL remains `https://www.woven.video/sfx`.

### Static Asset Request

1. SFX HTML references scripts, styles, images, and JSON under `/sfx/...`.
2. User requests `https://www.woven.video/sfx/_astro/...` or `https://www.woven.video/sfx/catalog.json`.
3. Next rewrite proxies the request to the matching upstream path.
4. SFX upstream returns the static file.

### Audio Preview Request

1. SFX catalog cards read `.wav` URLs from `catalog.json`.
2. Audio elements request `https://assets.sfx.woven.video/sfx/<id>.wav`.
3. Cloudflare R2 serves the media directly.

### Legacy Request

1. User or crawler requests `https://sfx.woven.video/catalog.json`.
2. Legacy host responds with `301 Location: https://www.woven.video/sfx/catalog.json`.
3. User or crawler follows the canonical `/sfx` URL.

---

## Error Handling And Rollback

The main failure mode is a broken `/sfx` rewrite or an SFX build that still emits root-relative URLs. Verification must explicitly check HTML, catalog JSON, peaks JSON, images, JS, CSS, and audio preview behavior under `www.woven.video/sfx`.

Rollback options:

- Roll back the `woven-video` Vercel deployment if the public rewrite is broken.
- Point `SFX_ORIGIN` back to a known-good SFX upstream deployment if only the SFX deploy is broken.
- Temporarily restore `sfx.woven.video` as a landing host only if `/sfx` cannot be stabilized quickly. This is a fallback, not the target architecture.

The rollout should avoid long periods where both `sfx.woven.video` and `/sfx` return indexable 200 HTML responses for the same page.

---

## Verification

Local verification:

- Start the SFX app locally and confirm it emits `/sfx` base-path URLs.
- Start the main app with `SFX_ORIGIN` pointing to the local SFX server.
- Confirm `http://localhost:<main>/sfx`, `/sfx/catalog.json`, `/sfx/llms.txt`, and `/sfx/peaks/<id>.json` return `200`.
- Confirm page HTML contains canonical `https://www.woven.video/sfx`, `/sfx/_astro`, and `/sfx/catalog.json`.

Production verification:

- `https://www.woven.video/sfx` returns `200`.
- `https://www.woven.video/sfx/catalog.json` returns `200`.
- `https://www.woven.video/sfx/llms.txt` returns `200`.
- `https://www.woven.video/sfx/peaks/<id>.json` returns `200`.
- The SFX page renders catalog cards and plays audio from R2.
- `https://sfx.woven.video` returns `301` to `https://www.woven.video/sfx`.
- `https://sfx.woven.video/catalog.json` returns `301` to `https://www.woven.video/sfx/catalog.json`.
- The upstream Vercel URL is not present in HTML, sitemap, robots, JSON-LD, or public docs.
- The main sitemap includes `/sfx`; SFX public files reference `/sfx`.

Post-launch:

- Submit or refresh the `www.woven.video` sitemap in Search Console.
- Inspect `https://www.woven.video/sfx` in Search Console after deployment.
- Monitor for crawl/indexing of the old subdomain or upstream Vercel domain and tighten redirects/noindex signals if needed.

---

## Implementation Input

No product decisions remain open. The implementation plan still needs the exact SFX Vercel project production domain after the project is created, and `SFX_ORIGIN` should use that value.
