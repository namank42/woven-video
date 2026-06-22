import type { Metadata } from "next";

import { LandingLayout } from "@/components/marketing/landing-layout";
import {
  AnswerFirst,
  ChooseLists,
  ComparisonTable,
  FaqSection,
  LastUpdated,
  MarketingCta,
  RelatedLinks,
  Verdict,
} from "@/components/marketing/page-sections";
import { opusClipComparison } from "@/lib/seo/landing-pages";
import { landingPageGraph } from "@/lib/seo/schema";

const content = opusClipComparison;

export const metadata: Metadata = {
  title: content.title,
  description: content.description,
  alternates: { canonical: content.path },
};

export default function OpusClipComparisonPage() {
  return (
    <LandingLayout
      schema={landingPageGraph({
        path: content.path,
        name: content.h1,
        description: content.description,
        faqs: content.faqs,
        breadcrumbLabel: "vs Opus Clip",
      })}
    >
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
          {content.h1}
        </h1>
        <AnswerFirst>{content.answerFirst}</AnswerFirst>
        <LastUpdated />
      </div>
      <Verdict>{content.verdict}</Verdict>
      <ComparisonTable competitorName={content.competitorName} rows={content.rows} />
      <ChooseLists
        competitorName={content.competitorName}
        chooseWoven={content.chooseWoven}
        chooseCompetitor={content.chooseCompetitor}
      />
      <FaqSection faqs={content.faqs} />
      <MarketingCta />
      <RelatedLinks />
    </LandingLayout>
  );
}