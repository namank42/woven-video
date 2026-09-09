import { describe, expect, it } from "vitest";

import {
  bestEditorRoundup,
  capcutComparison,
  descriptComparison,
  macEditorPage,
  opusClipComparison,
  reelsUseCase,
  shortsUseCase,
  tiktokUseCase,
  type ComparisonPageContent,
  type FeaturePageContent,
  type RoundupPageContent,
  type UseCasePageContent,
} from "@/lib/seo/landing-pages";

function comparisonCopy(page: ComparisonPageContent): string {
  return [
    page.title,
    page.description,
    page.h1,
    page.verdict,
    page.answerFirst,
    ...page.rows.flatMap((row) => [row.feature, row.woven, row.competitor]),
    ...page.chooseWoven,
    ...page.chooseCompetitor,
    ...page.faqs.flatMap((faq) => [faq.q, faq.a]),
  ].join("\n");
}

function useCaseCopy(page: UseCasePageContent): string {
  return [
    page.title,
    page.description,
    page.h1,
    page.answerFirst,
    ...page.workflow,
    ...page.faqs.flatMap((faq) => [faq.q, faq.a]),
  ].join("\n");
}

function roundupCopy(page: RoundupPageContent): string {
  return [
    page.title,
    page.description,
    page.h1,
    page.answerFirst,
    ...page.criteria,
    ...page.entries.flatMap((entry) => [
      entry.name,
      entry.bestFor,
      entry.platform,
      entry.pricing,
      entry.highlight,
    ]),
    ...page.faqs.flatMap((faq) => [faq.q, faq.a]),
  ].join("\n");
}

function featureCopy(page: FeaturePageContent): string {
  return [
    page.title,
    page.description,
    page.h1,
    page.answerFirst,
    ...page.highlights.flatMap((highlight) => [highlight.title, highlight.body]),
    ...page.faqs.flatMap((faq) => [faq.q, faq.a]),
  ].join("\n");
}

const renderedCopy = [
  comparisonCopy(capcutComparison),
  comparisonCopy(descriptComparison),
  comparisonCopy(opusClipComparison),
  useCaseCopy(reelsUseCase),
  useCaseCopy(tiktokUseCase),
  useCaseCopy(shortsUseCase),
  roundupCopy(bestEditorRoundup),
  featureCopy(macEditorPage),
].join("\n");

describe("landing page copy", () => {
  it("does not promise Claude as a hosted or required model", () => {
    expect(renderedCopy).not.toContain("Claude");
    expect(renderedCopy).not.toContain("Anthropic");
  });

  it("does not promise bring-your-own-keys", () => {
    expect(renderedCopy).not.toMatch(/your own[\s\S]{0,20}keys/i);
    expect(renderedCopy).not.toContain("BYOK");
    expect(renderedCopy).not.toContain("bring your own");
    expect(renderedCopy).not.toContain("API keys");
    expect(renderedCopy).not.toContain("provider keys");
  });

  it("keeps ChatGPT sign-in and Woven-hosted copy", () => {
    expect(renderedCopy).toContain("ChatGPT");
    expect(renderedCopy).toContain("Woven-hosted");
  });

  it("preserves comparison and highlight list structure", () => {
    expect(capcutComparison.rows).toHaveLength(6);
    expect(capcutComparison.chooseWoven).toHaveLength(4);
    expect(capcutComparison.chooseCompetitor).toHaveLength(3);
    expect(descriptComparison.rows).toHaveLength(7);
    expect(descriptComparison.chooseWoven).toHaveLength(3);
    expect(opusClipComparison.rows).toHaveLength(6);
    expect(macEditorPage.highlights).toHaveLength(4);
  });
});
