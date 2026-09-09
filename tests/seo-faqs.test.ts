import { describe, expect, it } from "vitest";

import { ANSWER_FIRST_PRICING, SITE_CONTENT_UPDATED, SITE_DESCRIPTION_LONG } from "@/lib/seo/constants";
import { homepageFaqs, pricingFaqs } from "@/lib/seo/faqs";

describe("SEO FAQs", () => {
  it("keeps the hosted model lineup aligned with the curated catalog", () => {
    const answer = homepageFaqs.find((faq) => faq.q === "Which models can I use?")?.a;

    expect(answer).toContain("GPT-5.6 Sol");
    expect(answer).toContain("GPT-5.6 Terra");
    expect(answer).toContain("GPT-5.6 Luna");
    expect(answer).not.toContain("Claude Sonnet 5");
    expect(answer).not.toContain("Claude Opus 4.8");
    expect(answer).not.toContain("Kimi K3");
    expect(answer).not.toContain("Kimi K2.6");
    expect(answer).not.toContain("GPT-5.5");
    expect(answer).not.toContain("Claude Haiku 4.5");
    expect(answer).not.toContain("Grok 4.3");
    expect(homepageFaqs.map((faq) => faq.a).join("\n")).not.toContain(
      "Claude Sonnet 4.6",
    );
  });

  it("links hosted rates to the pricing table instead of duplicating them", () => {
    const answer = homepageFaqs.find(
      (faq) => faq.q === "How much do hosted AI models cost?",
    )?.a;

    expect(answer).toContain("woven.video/pricing");
    expect(answer).not.toContain("Claude Sonnet 5");
    expect(answer).not.toContain("$2.40/M");
  });

  it("does not describe hosted credits as Claude-and-GPT-only", () => {
    expect(pricingFaqs.map((faq) => faq.a).join("\n")).not.toContain(
      "Woven-hosted Claude and GPT models",
    );
  });
});

describe("SEO answer-first copy", () => {
  it("does not promise BYOK keys", () => {
    for (const copy of [ANSWER_FIRST_PRICING, SITE_DESCRIPTION_LONG]) {
      expect(copy).not.toContain("bring your own");
    }
  });

  it("stamps the copy date for this change", () => {
    expect(SITE_CONTENT_UPDATED).toBe("2026-09-09");
  });
});
