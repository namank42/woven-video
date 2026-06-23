/** Keyword → page mapping. Volumes/KD from DataForSEO, US/en, June 2026. */

export type KeywordTarget = {
  path: string;
  primaryKeyword: string;
  secondaryKeywords?: string[];
  volumeMonthly?: number;
  aiSearchVolume?: number;
  keywordDifficulty?: number;
  status: "live" | "planned";
  notes?: string;
};

export const keywordTargets: KeywordTarget[] = [
  {
    path: "/",
    primaryKeyword: "ai video editing software",
    secondaryKeywords: ["chatgpt video editor"],
    volumeMonthly: 1900,
    aiSearchVolume: 9,
    keywordDifficulty: 50,
    status: "live",
    notes: "AEO/entity anchor; KD 50 — long game. FAQ: chatgpt video editor (320/mo, +181% YoY) if claim holds",
  },
  {
    path: "/vs/capcut",
    primaryKeyword: "capcut alternative",
    secondaryKeywords: [
      "alternative to capcut",
      "capcut alternative free",
      "best capcut alternative",
      "descript vs capcut",
      "capcut vs descript",
      "capcut alternative for mac",
    ],
    volumeMonthly: 2400,
    aiSearchVolume: 109,
    status: "live",
    notes: "Top AEO + SEO target; -33% YoY. Fold-in: capcut alternative free (390/mo, ~1.4 ref domains)",
  },
  {
    path: "/ai-voiceover",
    primaryKeyword: "ai voiceover generator",
    volumeMonthly: 2400,
    aiSearchVolume: 3,
    keywordDifficulty: 98,
    status: "planned",
    notes: "Google Ads competition LOW ≠ SEO KD. Labs KD 98 — deprioritize unless feature ships",
  },
  {
    path: "/ai-video-editor-mac",
    primaryKeyword: "ai video editor for mac",
    secondaryKeywords: ["best ai video editor for mac"],
    volumeMonthly: 20,
    keywordDifficulty: 54,
    status: "live",
    notes: "Tiny volume; positioning/AEO page, not a volume driver",
  },
  {
    path: "/vs/descript",
    primaryKeyword: "descript alternative",
    secondaryKeywords: ["opus clip vs descript", "ai podcast clips", "podcast clipper"],
    volumeMonthly: 170,
    aiSearchVolume: 16,
    status: "live",
    notes: "High CPC ($17.62); ~0.7 ref domains — very rankable. Podcast-clipping copy ✅",
  },
  {
    path: "/vs/opus-clip",
    primaryKeyword: "opus clip alternative",
    secondaryKeywords: [
      "opus clip vs descript",
      "ai clip maker",
      "ai video clipper",
      "ai podcast clips",
    ],
    volumeMonthly: 480,
    aiSearchVolume: 11,
    status: "live",
    notes: "Trending -46% YoY; podcast + clip-competitor angle. ai clip maker 1900/mo KD 43 — mention only",
  },
  {
    path: "/for/reels",
    primaryKeyword: "ai reels maker",
    secondaryKeywords: [
      "ai reels generator",
      "make reels ai",
      "ai reels editor",
      "create reels with ai",
      "free ai reels generator",
    ],
    volumeMonthly: 880,
    aiSearchVolume: 11,
    keywordDifficulty: 11,
    status: "live",
    notes: "Co-primary: ai reels generator (880/mo, KD 4). AEO: make reels ai (80 AI vol/mo)",
  },
  {
    path: "/for/tiktok",
    primaryKeyword: "ai tiktok editor",
    secondaryKeywords: ["ai video editor for tiktok"],
    volumeMonthly: 90,
    keywordDifficulty: 8,
    status: "live",
    notes: "Prefer ai tiktok editor (KD 8) over ai video editor for tiktok (KD 14)",
  },
  {
    path: "/for/youtube-shorts",
    primaryKeyword: "ai youtube shorts editor",
    secondaryKeywords: ["ai video editor for youtube shorts"],
    volumeMonthly: 20,
    status: "live",
    notes: "Low volume spoke; supports hub, not a priority SEO target",
  },
  {
    path: "/best-ai-video-editor",
    primaryKeyword: "best ai video editor",
    secondaryKeywords: [
      "best capcut alternative",
      "content repurposing tool",
      "ai content repurposing",
    ],
    volumeMonthly: 2400,
    aiSearchVolume: 61,
    keywordDifficulty: 27,
    status: "live",
    notes: "Fold-in content repurposing tool (110/mo, KD 3) and best capcut alternative (170/mo)",
  },
  {
    path: "/compare",
    primaryKeyword: "capcut alternative",
    status: "live",
    notes: "Hub — inherits comparison cluster intent",
  },
  {
    path: "/for",
    primaryKeyword: "ai reels maker",
    status: "live",
    notes: "Hub — use-case discovery",
  },
];