import type { Metadata } from "next";

import { HubCards } from "@/components/marketing/hub-cards";
import { LandingLayout } from "@/components/marketing/landing-layout";
import {
  AnswerFirst,
  FaqSection,
  LastUpdated,
  MarketingCta,
  RelatedLinks,
} from "@/components/marketing/page-sections";
import { useCaseHub } from "@/lib/seo/hubs";
import { landingPageGraph } from "@/lib/seo/schema";

const content = useCaseHub;

export const metadata: Metadata = {
  title: content.title,
  description: content.description,
  alternates: { canonical: content.path },
};

export default function UseCaseHubPage() {
  return (
    <LandingLayout
      schema={landingPageGraph({
        path: content.path,
        name: content.h1,
        description: content.description,
        faqs: content.faqs,
        breadcrumbLabel: "Use cases",
      })}
    >
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
          {content.h1}
        </h1>
        <AnswerFirst>{content.answerFirst}</AnswerFirst>
        <LastUpdated />
      </div>
      <HubCards cards={content.cards} />
      <FaqSection faqs={content.faqs} />
      <MarketingCta />
      <RelatedLinks currentPath={content.path} />
    </LandingLayout>
  );
}