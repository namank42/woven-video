// lib/changelog.ts
// Data layer for the /changelog page. Pulls release notes from the public
// Sparkle appcast (uploaded on every release by the woven-harness /release-woven
// skill). Versions worth dressing up get an authored MDX body — see
// lib/changelog-content.ts — but that enrichment is resolved in the page, not
// here; this module is just the automatic version/date/notes spine.

export type Release = {
  version: string; // "0.1.34"
  buildNumber: number; // 34 — used for sorting newest-first
  date: Date | null;
  notes: string[]; // plain-text bullets from the appcast (fallback body)
};

const APPCAST_URL = "https://release.woven.video/appcast.xml";

// The appcast CDATA holds literal UTF-8, so entities are rare; decode the common
// ones defensively. &amp; must run last so we don't double-decode.
function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
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
      .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()))
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

// Fetch the appcast (ISR: cached and revalidated hourly — a new release appears
// within ~1h with no redeploy), parse it, dedupe by version, and sort
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

  // The feed can contain accidental duplicate items for the same version
  // (e.g. a double-published 0.1.0). Keep one entry per version — the highest
  // build number — so the page shows no duplicates and React keys stay unique.
  const byVersion = new Map<string, Release>();
  for (const release of parseAppcast(xml)) {
    const existing = byVersion.get(release.version);
    if (!existing || release.buildNumber > existing.buildNumber) {
      byVersion.set(release.version, release);
    }
  }

  return [...byVersion.values()].sort((a, b) => b.buildNumber - a.buildNumber);
}
