import type { MetadataRoute } from "next";

import { SITE_CONTENT_UPDATED, SITE_URL } from "@/lib/seo/constants";

const contentUpdated = new Date(SITE_CONTENT_UPDATED);

const marketingPages: MetadataRoute.Sitemap = [
  { path: "/vs/capcut", priority: 0.85, changeFrequency: "monthly" as const },
  { path: "/ai-video-editor-mac", priority: 0.85, changeFrequency: "monthly" as const },
  { path: "/vs/descript", priority: 0.75, changeFrequency: "monthly" as const },
  { path: "/vs/opus-clip", priority: 0.75, changeFrequency: "monthly" as const },
  { path: "/for/reels", priority: 0.75, changeFrequency: "monthly" as const },
  { path: "/best-ai-video-editor", priority: 0.75, changeFrequency: "monthly" as const },
  { path: "/for/tiktok", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/for/youtube-shorts", priority: 0.7, changeFrequency: "monthly" as const },
].map((page) => ({
  url: `${SITE_URL}${page.path}`,
  lastModified: contentUpdated,
  changeFrequency: page.changeFrequency,
  priority: page.priority,
}));

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: contentUpdated,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified: contentUpdated,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    ...marketingPages,
    {
      url: `${SITE_URL}/changelog`,
      lastModified: contentUpdated,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/contact`,
      lastModified: contentUpdated,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: contentUpdated,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: contentUpdated,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}