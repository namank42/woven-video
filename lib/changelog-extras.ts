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
