/** Keyword → page mapping for planned and live landing pages. */

export type KeywordTarget = {
  path: string;
  primaryKeyword: string;
  volumeMonthly?: number;
  keywordDifficulty?: number;
  status: "live" | "planned";
};

export const keywordTargets: KeywordTarget[] = [
  {
    path: "/",
    primaryKeyword: "ai video editing software",
    volumeMonthly: 1900,
    keywordDifficulty: 22,
    status: "live",
  },
  {
    path: "/vs/capcut",
    primaryKeyword: "capcut alternative",
    volumeMonthly: 2400,
    keywordDifficulty: 27,
    status: "planned",
  },
  {
    path: "/ai-voiceover",
    primaryKeyword: "ai voiceover generator",
    volumeMonthly: 2400,
    keywordDifficulty: 6,
    status: "planned",
  },
  {
    path: "/ai-video-editor-mac",
    primaryKeyword: "ai video editor for mac",
    volumeMonthly: 20,
    status: "planned",
  },
  {
    path: "/vs/descript",
    primaryKeyword: "descript alternative",
    volumeMonthly: 170,
    status: "planned",
  },
  {
    path: "/vs/opus-clip",
    primaryKeyword: "opus clip alternative",
    volumeMonthly: 480,
    status: "planned",
  },
  {
    path: "/for/reels",
    primaryKeyword: "ai reels maker",
    volumeMonthly: 880,
    status: "planned",
  },
  {
    path: "/best-ai-video-editor",
    primaryKeyword: "best ai video editor",
    volumeMonthly: 2400,
    keywordDifficulty: 27,
    status: "planned",
  },
];