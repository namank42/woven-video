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
