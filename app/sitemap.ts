import type { MetadataRoute } from "next";

import { SITE_CONTENT_UPDATED, SITE_URL } from "@/lib/seo/constants";

const contentUpdated = new Date(SITE_CONTENT_UPDATED);

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