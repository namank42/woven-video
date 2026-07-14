import { describe, expect, it } from "vitest";

import { homepageFaqs, pricingFaqs } from "@/lib/seo/faqs";

describe("SEO FAQs", () => {
  it("keeps the hosted model lineup aligned with the curated catalog", () => {
    const answer = homepageFaqs.find((faq) => faq.q === "Which models can I use?")?.a;

    expect(answer).toContain("Claude Sonnet 5");
    expect(answer).toContain("Claude Opus 4.8");
    expect(answer).toContain("GPT-5.6 Sol");
    expect(answer).toContain("GPT-5.6 Terra");
    expect(answer).toContain("Kimi K2.6");
    expect(answer).not.toContain("GPT-5.5");
    expect(answer).not.toContain("Claude Haiku 4.5");
    expect(answer).not.toContain("Grok 4.3");
    expect(homepageFaqs.map((faq) => faq.a).join("\n")).not.toContain(
      "Claude Sonnet 4.6",
    );
  });

  it("publishes the exact dated Sonnet 5 input and output rates", () => {
    const answer = homepageFaqs.find(
      (faq) => faq.q === "How much do hosted AI models cost?",
    )?.a;

    expect(answer).toContain(
      "Sonnet 5 is $2.40/M input and $12.00/M output through Aug 31, 2026, then $3.60/M input and $18.00/M output from Sep 1, 2026.",
    );
  });

  it("does not describe hosted credits as Claude-and-GPT-only", () => {
    expect(pricingFaqs.map((faq) => faq.a).join("\n")).not.toContain(
      "Woven-hosted Claude and GPT models",
    );
  });
});
