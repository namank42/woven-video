export type InternalLink = {
  href: string;
  label: string;
};

export const compareHubLink: InternalLink = {
  href: "/compare",
  label: "Compare tools",
};

export const useCaseHubLink: InternalLink = {
  href: "/for",
  label: "Use cases",
};

export const comparisonLinks: InternalLink[] = [
  { href: "/vs/capcut", label: "CapCut alternative" },
  { href: "/vs/descript", label: "Descript alternative" },
  { href: "/vs/opus-clip", label: "Opus Clip alternative" },
];

export const useCaseLinks: InternalLink[] = [
  { href: "/for/reels", label: "AI Reels maker" },
  { href: "/for/tiktok", label: "AI TikTok editor" },
  { href: "/for/youtube-shorts", label: "AI YouTube Shorts editor" },
];

export const featureLinks: InternalLink[] = [
  { href: "/ai-video-editor-mac", label: "AI video editor for Mac" },
  { href: "/best-ai-video-editor", label: "Best AI video editor" },
];

export const relatedLinksForPage = (currentPath: string): InternalLink[] => {
  const all: InternalLink[] = [
    compareHubLink,
    useCaseHubLink,
    ...comparisonLinks,
    ...useCaseLinks,
    ...featureLinks,
    { href: "/pricing", label: "Pricing" },
  ];

  return all.filter((link) => link.href !== currentPath);
};

export const siblingComparisonLinks = (currentPath: string): InternalLink[] =>
  comparisonLinks.filter((link) => link.href !== currentPath);

export const siblingUseCaseLinks = (currentPath: string): InternalLink[] =>
  useCaseLinks.filter((link) => link.href !== currentPath);