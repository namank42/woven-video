# Changelog Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `/changelog` page to the woven-video site that auto-updates from the release feed, plus a "See what's new" teaser on the landing page — with zero changes to the release flow.

**Architecture:** The page pulls release notes at runtime from the already-public Sparkle feed at `https://release.woven.video/appcast.xml` (uploaded on every release by the `/release-woven` skill in the separate woven-harness repo). A single data module `lib/changelog.ts` fetches + parses the feed (ISR, revalidated hourly) and merges in an optional per-version media/prose enrichment layer (`lib/changelog-extras.ts`) kept in this repo. The page and the landing teaser both read from `getReleases()`.

**Tech Stack:** Next.js 16.2.3 (App Router, React 19 Server Components, `cacheComponents` off), Tailwind 4, shadcn `base-nova`, `next/image`. No new dependencies. No test runner exists in this repo; verification is `tsc` + `eslint` + `next build` (which prerenders the page against the live feed) + manual browser checks, plus a throwaway `node --experimental-strip-types` script for the pure parser.

**Spec:** `docs/superpowers/specs/2026-05-25-changelog-page-design.md`

---

## Reference: the live appcast shape

`getReleases()` parses items of this form (real sample from the feed):

```xml
<item>
  <title>Version 0.1.34</title>
  <pubDate>Mon, 25 May 2026 05:47:26 +0000</pubDate>
  <sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion>
  <description><![CDATA[
    <ul>
      <li>Codex can now use your MCP servers. ...</li>
      <li>Text elements now live on multiple timeline lanes. ...</li>
    </ul>
  ]]></description>
  <enclosure url="https://release.woven.video/Woven-0.1.34.dmg"
             sparkle:shortVersionString="0.1.34"
             sparkle:version="34"
             sparkle:edSignature="...==" length="134711887"
             type="application/octet-stream" />
</item>
```

Parsing rules: version from `sparkle:shortVersionString`; sort key from integer `sparkle:version`; date from `pubDate` (RFC 2822); note bullets from each `<li>` inside the CDATA `<description>` (CDATA holds literal UTF-8 — em dashes, ⌘, ⇧, backticks — so entity-decoding is defensive only).

---

## File structure

| File | Responsibility |
|---|---|
| `lib/changelog.ts` | Types (`Media`, `Release`), `decodeEntities`, `parseAppcast` (pure), `getReleases` (fetch + merge + sort + never-throw). The only data interface consumers use. |
| `lib/changelog-extras.ts` | Hand-authored per-version `{ lead?, media? }` enrichment, keyed by version string. |
| `public/changelog/` | Image/GIF assets referenced by `changelog-extras.ts` (added over time; created with a `.gitkeep`). |
| `app/changelog/page.tsx` | The `/changelog` route: header, entry list, empty state, `metadata`, `revalidate`. |
| `components/whats-new-link.tsx` | Async server component teaser → `/changelog`, rendered in the landing hero. |
| `app/page.tsx` | Mount `<WhatsNewLink />` in the hero (1 import + 1 element). |
| `components/site-footer.tsx` | Add a "Changelog" link. |
| `app/sitemap.ts` | Add a `/changelog` entry. |

---

## Task 1: Data types + pure appcast parser

**Files:**
- Create: `lib/changelog.ts`

- [ ] **Step 1: Create `lib/changelog.ts` with types, entity decoder, and parser**

```ts
// lib/changelog.ts
// Data layer for the /changelog page. Pulls release notes from the public
// Sparkle appcast (uploaded on every release by the woven-harness /release-woven
// skill) and merges in optional per-version media from changelog-extras.ts.

export type ImageMedia = {
  type: "image";
  src: string; // under /public, e.g. "/changelog/0.1.34-codex-mcp.png"
  alt: string;
  width: number;
  height: number;
  caption?: string;
};

export type VideoMedia = {
  type: "video";
  src: string; // under /public, e.g. "/changelog/0.1.34-demo.mp4"
  poster?: string;
  caption?: string;
};

export type Media = ImageMedia | VideoMedia;

export type Release = {
  version: string; // "0.1.34"
  buildNumber: number; // 34 — used for sorting newest-first
  date: Date | null;
  notes: string[]; // plain-text bullets from the appcast
  lead?: string; // optional, from enrichment
  media?: Media[]; // optional, from enrichment
};

const APPCAST_URL = "https://release.woven.video/appcast.xml";

// The appcast CDATA holds literal UTF-8, so entities are rare; decode the common
// ones defensively. &amp; must run last so we don't double-decode.
function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

// Parse the Sparkle appcast XML into releases. Pure (no I/O) so it can be
// reasoned about and spot-checked in isolation. Tolerant of missing fields:
// an item without a version is skipped; a bad date becomes null.
export function parseAppcast(xml: string): Release[] {
  const itemBlocks = xml
    .split(/<item>/i)
    .slice(1)
    .map((chunk) => chunk.split(/<\/item>/i)[0]);

  const releases: Release[] = [];

  for (const item of itemBlocks) {
    const version = /sparkle:shortVersionString="([^"]+)"/i.exec(item)?.[1];
    if (!version) continue;

    const buildRaw = /sparkle:version="([^"]+)"/i.exec(item)?.[1];
    const buildNumber = buildRaw ? Number.parseInt(buildRaw, 10) : 0;

    const pubDateRaw = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(item)?.[1]?.trim();
    const parsedDate = pubDateRaw ? new Date(pubDateRaw) : null;
    const date =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

    const cdata =
      /<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/i.exec(
        item,
      )?.[1] ?? "";
    const notes = [...cdata.matchAll(/<li>([\s\S]*?)<\/li>/gi)]
      .map((m) => decodeEntities(m[1].replace(/\s+/g, " ").trim()))
      .filter((s) => s.length > 0);

    releases.push({
      version,
      buildNumber: Number.isNaN(buildNumber) ? 0 : buildNumber,
      date,
      notes,
    });
  }

  return releases;
}
```

- [ ] **Step 2: Type-check the new file**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no errors). `getReleases` and the extras import do not exist yet — that's fine; nothing references them.

- [ ] **Step 3: Spot-check the pure parser against the live feed**

Create a throwaway script `scripts/_check-parser.mts` (the `.mts` extension forces ESM, so top-level `import`/`await` work — the repo has no `"type": "module"`):

```ts
import { parseAppcast } from "../lib/changelog";

const xml = await (await fetch("https://release.woven.video/appcast.xml")).text();
const releases = parseAppcast(xml);
console.log("count:", releases.length);
console.log("first:", {
  version: releases[0]?.version,
  buildNumber: releases[0]?.buildNumber,
  date: releases[0]?.date?.toISOString() ?? null,
  noteCount: releases[0]?.notes.length,
  firstNoteHead: releases[0]?.notes[0]?.slice(0, 60),
});
```

Run: `node --experimental-strip-types scripts/_check-parser.mts`
Expected: `count:` is a positive number (≈ several), and `first:` shows `version: "0.1.34"` (or whatever is latest), a numeric `buildNumber`, a valid ISO `date`, `noteCount` > 0, and a readable `firstNoteHead`.

- [ ] **Step 4: Delete the throwaway script**

Run: `rm scripts/_check-parser.mts`
Expected: file removed (it must not be committed).

- [ ] **Step 5: Commit**

```bash
git add lib/changelog.ts
git commit -m "feat(changelog): appcast types + pure parser"
```

---

## Task 2: Per-version enrichment module

**Files:**
- Create: `lib/changelog-extras.ts`
- Create: `public/changelog/.gitkeep`

- [ ] **Step 1: Create `lib/changelog-extras.ts`**

```ts
// lib/changelog-extras.ts
// Optional, hand-authored enrichment for specific versions: a lead paragraph
// and/or media (screenshots, GIFs, video). The version list, dates, and text
// bullets come automatically from the appcast (see lib/changelog.ts); this file
// only adds visuals/prose for versions worth dressing up. Keyed by version
// string (must match sparkle:shortVersionString, e.g. "0.1.34"). Place assets
// in public/changelog/.

import type { Media } from "./changelog";

export const changelogExtras: Record<
  string,
  { lead?: string; media?: Media[] }
> = {
  // Example (leave commented until you have a real asset):
  // "0.1.34": {
  //   lead: "Codex now speaks to your MCP servers.",
  //   media: [
  //     {
  //       type: "image",
  //       src: "/changelog/0.1.34-codex-mcp.png",
  //       alt: "Codex calling an MCP tool inline in chat",
  //       width: 1200,
  //       height: 800,
  //       caption: "MCP tool calls show up inline in chat",
  //     },
  //   ],
  // },
};
```

- [ ] **Step 2: Create the assets directory placeholder**

```bash
mkdir -p public/changelog
touch public/changelog/.gitkeep
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/changelog-extras.ts public/changelog/.gitkeep
git commit -m "feat(changelog): per-version media/prose enrichment module"
```

---

## Task 3: `getReleases()` — fetch, merge, sort, never-throw

**Files:**
- Modify: `lib/changelog.ts` (append `getReleases` + import extras)

- [ ] **Step 1: Add the extras import at the top of `lib/changelog.ts`**

Add directly under the file's opening comment block, above the `export type ImageMedia` line:

```ts
import { changelogExtras } from "./changelog-extras";
```

- [ ] **Step 2: Append `getReleases` to the end of `lib/changelog.ts`**

```ts
// Fetch the appcast (ISR: cached and revalidated hourly — a new release appears
// within ~1h with no redeploy), parse it, merge enrichment by version, and sort
// newest-first. Never throws: on any failure it returns [] so the page can
// render an empty state and, critically, so a transient R2 outage during
// `next build` does not fail the deploy.
export async function getReleases(): Promise<Release[]> {
  let xml: string;
  try {
    const res = await fetch(APPCAST_URL, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }

  const releases = parseAppcast(xml);

  for (const release of releases) {
    const extra = changelogExtras[release.version];
    if (extra) {
      release.lead = extra.lead;
      release.media = extra.media;
    }
  }

  releases.sort((a, b) => b.buildNumber - a.buildNumber);
  return releases;
}
```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS, no errors or warnings for `lib/changelog.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/changelog.ts
git commit -m "feat(changelog): getReleases fetch+merge with graceful failure"
```

---

## Task 4: The `/changelog` page

**Files:**
- Create: `app/changelog/page.tsx`

- [ ] **Step 1: Create `app/changelog/page.tsx`**

```tsx
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { HeaderAuthControls } from "@/components/header-auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { getReleases, type Release } from "@/lib/changelog";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Every update to the Woven app — new features, improvements, and fixes, newest first.",
  alternates: { canonical: "/changelog" },
};

function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function ChangelogPage() {
  const releases = await getReleases();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">
        <section>
          <div className="mx-auto w-full max-w-3xl px-6 pt-16 pb-10 md:pt-20">
            <SectionLabel>Changelog</SectionLabel>
            <h1 className="mt-6 text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-5xl">
              What&rsquo;s new in Woven
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Every update to the app, newest first.
            </p>
          </div>
        </section>

        <section className="pb-24">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-6">
            {releases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The changelog is unavailable right now. Please check back soon.
              </p>
            ) : (
              releases.map((release) => (
                <ReleaseEntry key={release.version} release={release} />
              ))
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function ReleaseEntry({ release }: { release: Release }) {
  const date = formatDate(release.date);
  return (
    <article className="flex flex-col gap-5 border-t border-border/60 pt-12 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          v{release.version}
        </h2>
        {date && (
          <time className="text-sm text-muted-foreground">{date}</time>
        )}
      </div>

      {release.lead && (
        <p className="text-base leading-relaxed text-muted-foreground">
          {release.lead}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {release.notes.map((note, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 text-sm leading-relaxed md:text-base"
          >
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
            <span>{note}</span>
          </li>
        ))}
      </ul>

      {release.media && release.media.length > 0 && (
        <div className="mt-2 flex flex-col gap-6">
          {release.media.map((item) =>
            item.type === "image" ? (
              <figure key={item.src} className="flex flex-col gap-2">
                <Image
                  src={item.src}
                  alt={item.alt}
                  width={item.width}
                  height={item.height}
                  className="w-full rounded-xl ring-1 ring-border"
                />
                {item.caption && (
                  <figcaption className="text-xs text-muted-foreground">
                    {item.caption}
                  </figcaption>
                )}
              </figure>
            ) : (
              <figure key={item.src} className="flex flex-col gap-2">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption -- changelog clips are decorative; the caption text is provided via figcaption */}
                <video
                  src={item.src}
                  poster={item.poster}
                  controls
                  className="w-full rounded-xl ring-1 ring-border"
                />
                {item.caption && (
                  <figcaption className="text-xs text-muted-foreground">
                    {item.caption}
                  </figcaption>
                )}
              </figure>
            ),
          )}
        </div>
      )}
    </article>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="Woven home">
          <Image
            src="/woven-logo.png"
            alt=""
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="font-heading text-base font-medium">Woven</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/changelog" className="text-foreground">
            Changelog
          </Link>
        </nav>
        <HeaderAuthControls />
      </div>
    </header>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-foreground" />
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS, no errors/warnings.

- [ ] **Step 3: Run the dev server and verify the page renders real data**

Run: `pnpm dev` (leave running), then in a browser open `http://localhost:3000/changelog`
Expected:
- An entry for each shipped version, newest first (latest is `v0.1.34` or higher).
- Each shows `v<version>`, a formatted date (e.g. "May 25, 2026"), and the note bullets.
- No "unavailable" message, no "Invalid Date".

- [ ] **Step 4: Verify the empty/failure state**

Temporarily edit `lib/changelog.ts`: change `const APPCAST_URL = "https://release.woven.video/appcast.xml";` to `const APPCAST_URL = "https://release.woven.video/does-not-exist.xml";`. Reload `http://localhost:3000/changelog`.
Expected: the page renders the "The changelog is unavailable right now…" message and does not crash.
Then **revert** the URL back to `https://release.woven.video/appcast.xml` and reload to confirm entries return.

- [ ] **Step 5: Commit**

```bash
git add app/changelog/page.tsx
git commit -m "feat(changelog): /changelog page rendering releases"
```

---

## Task 5: Landing-page "See what's new" teaser

**Files:**
- Create: `components/whats-new-link.tsx`
- Modify: `app/page.tsx` (1 import + place `<WhatsNewLink />` in the hero)

- [ ] **Step 1: Create `components/whats-new-link.tsx`**

```tsx
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { getReleases } from "@/lib/changelog";

// Async server component. Reuses the same data source as /changelog so the
// teaser is always in sync. Renders nothing if there are no releases.
export async function WhatsNewLink() {
  const releases = await getReleases();
  const latest = releases[0];
  if (!latest) return null;

  return (
    <Link
      href="/changelog"
      className="group mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className="size-1.5 rounded-full bg-foreground" />
      See what&rsquo;s new in v{latest.version}
      <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
```

- [ ] **Step 2: Import it in `app/page.tsx`**

Add to the existing component imports near the top of `app/page.tsx` (next to the other `@/components/...` imports such as `import { SiteFooter } from "@/components/site-footer";`):

```tsx
import { WhatsNewLink } from "@/components/whats-new-link";
```

- [ ] **Step 3: Render `<WhatsNewLink />` at the top of the hero content**

In `app/page.tsx`, inside the `Hero` function, find the inner content container:

```tsx
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-14 pb-12 text-center md:pt-16 md:pb-16">
        <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-5xl lg:text-6xl">
          The AI Video Editor
        </h1>
```

Insert `<WhatsNewLink />` as the first child, immediately before the `<h1>`:

```tsx
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-14 pb-12 text-center md:pt-16 md:pb-16">
        <WhatsNewLink />
        <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-5xl lg:text-6xl">
          The AI Video Editor
        </h1>
```

- [ ] **Step 4: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

With `pnpm dev` running, open `http://localhost:3000/`
Expected: a pill above the "The AI Video Editor" headline reading "See what's new in v0.1.34 →" (matching the latest version). Clicking it navigates to `/changelog`.

- [ ] **Step 6: Commit**

```bash
git add components/whats-new-link.tsx app/page.tsx
git commit -m "feat(changelog): landing-page what's-new teaser"
```

---

## Task 6: Footer link + sitemap entry

**Files:**
- Modify: `components/site-footer.tsx`
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Add a Changelog link to the footer**

In `components/site-footer.tsx`, the link group currently is:

```tsx
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/#faq" className="hover:text-foreground">
            FAQ
          </Link>
          <a
            href="mailto:hello@woven.video"
            className="hover:text-foreground"
          >
            hello@woven.video
          </a>
        </div>
```

Insert a Changelog link after the Pricing link:

```tsx
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/changelog" className="hover:text-foreground">
            Changelog
          </Link>
          <Link href="/#faq" className="hover:text-foreground">
            FAQ
          </Link>
```

- [ ] **Step 2: Add `/changelog` to the sitemap**

In `app/sitemap.ts`, the returned array currently ends with the `/pricing` entry. Add a `/changelog` entry after it:

```ts
    {
      url: `${siteUrl}/pricing`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/changelog`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];
```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Verify**

With `pnpm dev` running, open `http://localhost:3000/` and confirm the footer shows a "Changelog" link that navigates to `/changelog`. Open `http://localhost:3000/sitemap.xml` and confirm it lists `https://www.woven.video/changelog`.

- [ ] **Step 5: Commit**

```bash
git add components/site-footer.tsx app/sitemap.ts
git commit -m "feat(changelog): footer link + sitemap entry"
```

---

## Task 7: Media rendering verification + production build

**Files:** none changed permanently (temporary edits only)

- [ ] **Step 1: Temporarily verify media rendering with an existing asset**

In `lib/changelog-extras.ts`, temporarily add an entry for the current latest version (check the version shown on `/changelog` — e.g. `0.1.34`), pointing at an image that already exists in `public/`:

```ts
export const changelogExtras: Record<
  string,
  { lead?: string; media?: Media[] }
> = {
  "0.1.34": {
    lead: "Temporary verification entry.",
    media: [
      {
        type: "image",
        src: "/woven-logo.png",
        alt: "Woven logo",
        width: 100,
        height: 28,
        caption: "Temporary caption",
      },
    ],
  },
};
```

With `pnpm dev` running, reload `http://localhost:3000/changelog`.
Expected: under the `v0.1.34` entry, the lead paragraph "Temporary verification entry.", the bullets, then the logo image with the caption "Temporary caption".

- [ ] **Step 2: Revert the temporary entry**

Restore `lib/changelog-extras.ts` to the empty `{}` object (with the commented example) from Task 2. Reload `/changelog` and confirm the temporary image/lead are gone.

Run: `git diff --stat lib/changelog-extras.ts`
Expected: no changes (file matches the committed version).

- [ ] **Step 3: Stop the dev server and run a production build**

Stop `pnpm dev` (Ctrl-C), then run: `pnpm build`
Expected: build succeeds. `/changelog` is listed in the route output and prerenders without error (this fetches and parses the live appcast — an end-to-end check of the parser and ISR config). No "Invalid Date" or fetch crash in the output.

- [ ] **Step 4: Final lint**

Run: `pnpm lint`
Expected: PASS, no warnings.

- [ ] **Step 5: Confirm no stray files**

Run: `git status --porcelain`
Expected: clean (or only expected build artifacts that are git-ignored). Confirm `scripts/_check-parser.mts` does not exist and `lib/changelog-extras.ts` has no temporary entry.

---

## Done criteria

- `/changelog` lists every shipped version (newest first) with version, date, and note bullets, pulled live from the appcast and revalidated hourly — no release-flow changes.
- A version can be dressed up with images/GIFs/video + lead prose by adding an asset to `public/changelog/` and an entry to `lib/changelog-extras.ts` (a normal web PR).
- The landing hero shows a "See what's new in v<latest> →" pill linking to `/changelog`.
- Footer links to `/changelog`; sitemap includes it.
- Fetch failure degrades to a graceful empty state and never fails the build.
- `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm build` all pass. No new dependencies.
