import { describe, expect, it } from "vitest";

import { homepageFaqs, pricingFaqs } from "@/lib/seo/faqs";

describe("SEO FAQs", () => {
  it("keeps the hosted model lineup aligned with the curated catalog", () => {
    const answer = homepageFaqs.find((faq) => faq.q === "Which models can I use?")?.a;

    expect(answer).toContain("Claude Sonnet 4.6");
    expect(answer).toContain("Claude Opus 4.8");
    expect(answer).toContain("GPT-5.6 Sol");
    expect(answer).toContain("GPT-5.6 Terra");
    expect(answer).toContain("Kimi K2.6");
    expect(answer).not.toContain("GPT-5.5");
    expect(answer).not.toContain("Claude Haiku 4.5");
    expect(answer).not.toContain("Grok 4.3");
  });

  it("does not describe hosted credits as Claude-and-GPT-only", () => {
    expect(pricingFaqs.map((faq) => faq.a).join("\n")).not.toContain(
      "Woven-hosted Claude and GPT models",
    );
  });
});
