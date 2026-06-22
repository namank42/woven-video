import {
  CONTACT_EMAIL,
  DOWNLOAD_URL,
  SITE_CONTENT_UPDATED,
  SITE_LEGAL_NAME,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from "@/lib/seo/constants";
import type { FaqItem } from "@/lib/seo/faqs";

type JsonLd = Record<string, unknown>;

export function organizationSchema(): JsonLd {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: SITE_LEGAL_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/woven-logo.png`,
      width: 1024,
      height: 1024,
    },
    description:
      "Woven is the AI Video Editor — a native macOS app for making and editing short-form video by asking.",
    slogan: SITE_TAGLINE,
    contactPoint: {
      "@type": "ContactPoint",
      email: CONTACT_EMAIL,
      contactType: "customer support",
      availableLanguage: "English",
    },
  };
}

export function websiteSchema(): JsonLd {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_TAGLINE,
    inLanguage: "en-US",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function softwareApplicationSchema(): JsonLd {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#app`,
    name: SITE_NAME,
    operatingSystem: "macOS",
    applicationCategory: "MultimediaApplication",
    description:
      "Woven is the AI Video Editor. A native macOS app to script, edit, and assemble short-form video by asking. Try free for 7 days, then $99/year.",
    url: SITE_URL,
    downloadUrl: DOWNLOAD_URL,
    offers: {
      "@type": "Offer",
      price: "99.00",
      priceCurrency: "USD",
      priceValidUntil: "2027-12-31",
      availability: "https://schema.org/InStock",
      description: "7-day free trial, then $99/year billed annually",
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function faqPageSchema(faqs: FaqItem[], id = `${SITE_URL}/#faq`): JsonLd {
  return {
    "@type": "FAQPage",
    "@id": id,
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

export function webPageSchema({
  path,
  name,
  description,
}: {
  path: string;
  name: string;
  description: string;
}): JsonLd {
  const url = path === "/" ? SITE_URL : `${SITE_URL}${path}`;
  return {
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: "en-US",
    dateModified: SITE_CONTENT_UPDATED,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#app` },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function breadcrumbSchema(
  items: { name: string; path: string }[],
): JsonLd {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.path === "/" ? SITE_URL : `${SITE_URL}${item.path}`,
    })),
  };
}

export function jsonLdGraph(...nodes: JsonLd[]): { "@context": string; "@graph": JsonLd[] } {
  return {
    "@context": "https://schema.org",
    "@graph": nodes,
  };
}

export function homePageGraph(faqs: FaqItem[]) {
  return jsonLdGraph(
    organizationSchema(),
    websiteSchema(),
    softwareApplicationSchema(),
    webPageSchema({
      path: "/",
      name: `${SITE_NAME} — ${SITE_TAGLINE}`,
      description:
        "Woven is a native macOS AI video editor for Reels, TikTok, and YouTube Shorts.",
    }),
    faqPageSchema(faqs),
  );
}

export function landingPageGraph({
  path,
  name,
  description,
  faqs,
  breadcrumbLabel,
}: {
  path: string;
  name: string;
  description: string;
  faqs: FaqItem[];
  breadcrumbLabel: string;
}) {
  const url = `${SITE_URL}${path}`;
  return jsonLdGraph(
    organizationSchema(),
    webPageSchema({ path, name, description }),
    breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: breadcrumbLabel, path },
    ]),
    faqPageSchema(faqs, `${url}#faq`),
  );
}

export function pricingPageGraph(faqs: FaqItem[]) {
  return jsonLdGraph(
    organizationSchema(),
    softwareApplicationSchema(),
    webPageSchema({
      path: "/pricing",
      name: "Woven Pricing",
      description:
        "Woven pricing — 7-day free trial, then $99/year. Hosted AI model rates and optional prepaid credits.",
    }),
    faqPageSchema(faqs, `${SITE_URL}/pricing#faq`),
  );
}

export function contactPageGraph() {
  return jsonLdGraph(
    organizationSchema(),
    {
      "@type": "ContactPage",
      "@id": `${SITE_URL}/contact#contactpage`,
      url: `${SITE_URL}/contact`,
      name: "Contact Woven",
      description: "Contact Woven Labs for support, billing, and product questions.",
      inLanguage: "en-US",
      dateModified: SITE_CONTENT_UPDATED,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Contact", path: "/contact" },
    ]),
  );
}

export function changelogPageGraph(
  releases: { version: string; date: string | null }[],
) {
  return jsonLdGraph(
    organizationSchema(),
    webPageSchema({
      path: "/changelog",
      name: "Woven Changelog",
      description: "Every update to the Woven app — features, improvements, and fixes.",
    }),
    {
      "@type": "ItemList",
      "@id": `${SITE_URL}/changelog#releases`,
      itemListElement: releases.map((release, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: `Woven ${release.version}`,
        ...(release.date ? { datePublished: release.date } : {}),
      })),
    },
  );
}

