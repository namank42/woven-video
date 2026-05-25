# Changelog page — design spec

**Date:** 2026-05-25
**Status:** Approved, ready for implementation plan

## Problem

Releases of the Woven desktop app are cut from the **woven-harness** repo via the
`/release-woven` skill. That skill writes release notes into `CHANGELOG.md` and
`scripts/appcast.xml`, then uploads `appcast.xml` to Cloudflare R2, where it is
publicly readable at `https://release.woven.video/appcast.xml` (Sparkle
auto-update feed, served with `Cache-Control: max-age=60`).

The marketing website is a **separate** repo, **woven-video** (Next.js 16.2.3,
App Router, React 19, Tailwind 4, shadcn `base-nova`, Supabase, deployed on
Vercel). It has **no changelog page** today, and releases never touch this repo
or trigger a Vercel redeploy.

**Goal:** a public `/changelog` page on the website that updates automatically
when a release ships, plus a "See what's new in vX" teaser on the landing page —
without changing the release flow.

## Key constraint

Because a release never touches the website repo or triggers a redeploy, the
changelog page **cannot be baked at build time**. It must pull release data at
runtime / on a revalidate interval.

## Approach (decided)

**Pull from the existing public `appcast.xml`.** The website fetches and parses
the artifact the release already publishes. Single source of truth, zero new
release steps, no new infrastructure. Alternatives considered and rejected:
publishing a separate `changelog.json` from the release skill, a Supabase
`releases` table, and having the release skill commit into the website repo —
all add coupling to the release flow for no benefit.

### Two-layer content model

Sparkle's appcast carries only plain-text note bullets (`<ul><li>`), no media.
To support images/GIFs in entries we use a two-layer model:

```
appcast.xml   ──▶  version + date + text bullets   (automatic; every release; ~hourly)
                            ⊕
website repo  ──▶  optional media / lead prose for chosen versions   (manual; web PR)
                            ▼
        getReleases() merges by version  ──▶  render
```

- **Spine (automatic):** version, date, and text notes come from appcast for
  every release, with no manual step and no redeploy.
- **Enrichment (optional, manual):** a per-version data file in the website repo
  adds media and/or a lead paragraph for versions worth dressing up. Adding it is
  a normal website PR (which redeploys). This is appropriate — marketing
  screenshots don't exist at the instant the DMG ships.

## Data layer — `lib/changelog.ts`

Single isolated entry point; the page and the landing teaser only ever call this.
Parsing internals stay swappable behind the interface.

```ts
export type Media = {
  type: "image" | "video";
  src: string;        // e.g. "/changelog/0.1.34-codex-mcp.png"
  alt: string;
  caption?: string;
};

export type Release = {
  version: string;       // "0.1.34"
  buildNumber: number;   // 34 — used for sorting
  date: Date | null;
  notes: string[];       // plain-text bullets from appcast
  lead?: string;         // optional, from enrichment
  media?: Media[];       // optional, from enrichment
};

export async function getReleases(): Promise<Release[]>;
```

### Spine parsing rules

- `fetch("https://release.woven.video/appcast.xml", { next: { revalidate: 3600 } })`.
- **No new dependency.** A small focused extractor reads each `<item>`. The
  appcast is our own machine-generated, stable format; keeping the parser behind
  `getReleases()` means it can be swapped for a real XML parser later without
  touching consumers. (Taking `fast-xml-parser` instead is an acceptable
  alternative; if so, handle the single-`<item>`-returns-object trap and the
  `sparkle:` namespace.)
- **Version** comes from the enclosure's `sparkle:shortVersionString`
  (clean `0.1.34`), **not** from stripping `"Version "` off `<title>`.
- **Sort** by integer `sparkle:version` descending. Never trust file order.
- **Notes:** extract each `<li>` from the CDATA `<description>` as plain text.
  Apply a small entity decode (`&amp; &lt; &gt; &quot; &#39;` + numeric `&#NN;`)
  as defensive insurance. Render as a native JSX `<ul>` — **no
  `dangerouslySetInnerHTML`, no sanitizer.** This implies release notes are plain
  prose (no inline links/bold), which matches every entry today. Rich inline
  formatting, if ever needed, would be a future switch to a sanitized HTML render
  behind the same `getReleases()` interface.
- **Date:** parse `pubDate` (RFC 2822). Guard against `Invalid Date` (omit the
  date if unparseable). Format with fixed `en-US` locale and `timeZone: "UTC"` so
  the build server's timezone cannot shift the displayed day.

### Failure handling

`getReleases()` **never throws.** On fetch failure, non-200, or parse error it
returns `[]`. The page renders a graceful "changelog unavailable" state. This is
critical: throwing would fail the Vercel build if R2 hiccups during `next build`.
Residual risk: if R2 is unreachable *exactly* at build time, the empty state is
baked and frozen for the revalidate window (~1h), then self-heals on the next
revalidation.

## Enrichment layer — `lib/changelog-extras.ts`

```ts
export const changelogExtras: Record<
  string,                              // version, e.g. "0.1.34"
  { lead?: string; media?: Media[] }
> = {
  // "0.1.34": {
  //   lead: "Codex now speaks to your MCP servers.",
  //   media: [{ type: "image", src: "/changelog/0.1.34-codex-mcp.png",
  //             alt: "Codex using MCP servers", caption: "MCP tool calls inline in chat" }],
  // },
};
```

Merged into the spine by version key in `getReleases()`. Image/video assets live
in `public/changelog/` and render via `next/image`.

## Page — `app/changelog/page.tsx`

- Server component. Public route `/changelog`.
- Renders newest-first. Each entry: `v0.1.34 — May 25, 2026` heading → optional
  `lead` paragraph → text bullets → optional media gallery (`next/image` with
  captions).
- Styled with existing shadcn/Tailwind patterns, matching the pricing page
  (centered column, consistent typography).
- `export const metadata` with title / description / `alternates.canonical = "/changelog"`,
  matching the other pages' conventions.
- `export const revalidate = 3600` on the route (static literal, not `60 * 60`),
  plus the per-fetch `revalidate: 3600`. Makes `/changelog` a statically
  prerendered ISR page that refreshes hourly in the background — a new release
  appears within ~1h with no redeploy. Works because `cacheComponents` is not
  enabled in `next.config.ts`.
- Empty `releases` array → graceful "changelog unavailable / check back soon"
  state. No pagination (handful of entries; a server-rendered list scales fine).

## Landing teaser — `components/whats-new-link.tsx`

- Async server component. Calls `getReleases()`, takes `[0]`.
- Renders a small pill/link: **"See what's new in v0.1.34 →"** → `/changelog`.
- Renders nothing if there are no releases.
- Mounted in the hero area of `app/page.tsx` near the download CTA. (Placement is
  adjustable; hero is the default.)

## Discoverability

- `components/site-footer.tsx`: add a "Changelog" link.
- `app/sitemap.ts`: add a `/changelog` entry.

## Files

| File | Change |
|---|---|
| `lib/changelog.ts` | **new** — `getReleases()`, types, appcast parser, merge + failure handling |
| `lib/changelog-extras.ts` | **new** — per-version `{ lead?, media? }`, keyed by version |
| `public/changelog/` | **new dir** — image/GIF assets added over time |
| `app/changelog/page.tsx` | **new** — page, `metadata`, `revalidate`, entry rendering |
| `components/whats-new-link.tsx` | **new** — landing teaser server component |
| `app/page.tsx` | mount `<WhatsNewLink />` in hero |
| `components/site-footer.tsx` | add Changelog link |
| `app/sitemap.ts` | add `/changelog` entry |

**Net:** 4 new files + 1 new asset dir, 3 small edits, **0 new dependencies, 0
changes to the release flow.**

## Out of scope (YAGNI)

- Pagination / "show older" toggle.
- Per-version download links, "latest" badges, GitHub-release links (appcast has
  the data but the owner chose version + date + notes only).
- MDX tooling (structured media data was chosen over MDX).
- Rich inline formatting (links/bold) inside note bullets.
- Any change to `/release-woven` or the appcast format.
