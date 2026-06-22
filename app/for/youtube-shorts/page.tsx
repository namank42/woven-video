import type { Metadata } from "next";

import { LandingLayout } from "@/components/marketing/landing-layout";
import {
  AnswerFirst,
  FaqSection,
  LastUpdated,
  MarketingCta,
  RelatedLinks,
  WorkflowSteps,
} from "@/components/marketing/page-sections";
import { shortsUseCase } from "@/lib/seo/landing-pages";
import { landingPageGraph } from "@/lib/seo/schema";

const content = shortsUseCase;

export const metadata: Metadata = {
  title: content.title,
  description: content.description,
  alternates: { canonical: content.path },
};

export default function YoutubeShortsPage() {
  return (
    <LandingLayout
      schema={landingPageGraph({
        path: content.path,
        name: content.h1,
        description: content.description,
        faqs: content.faqs,
        breadcrumbLabel: "YouTube Shorts",
      })}
    >
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
          {content.h1}
        </h1>
        <AnswerFirst>{content.answerFirst}</AnswerFirst>
        <LastUpdated />
      </div>
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <WorkflowSteps steps={content.workflow} />
      </section>
      <FaqSection faqs={content.faqs} />
      <MarketingCta />
      <RelatedLinks />
    </LandingLayout>
  );
}