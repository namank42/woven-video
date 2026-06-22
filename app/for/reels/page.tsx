import type { Metadata } from "next";

import { LandingLayout } from "@/components/marketing/landing-layout";
import {
  AnswerFirst,
  FaqSection,
  LastUpdated,
  MarketingCta,
  RelatedLinks,
  SeeAlso,
  WorkflowSteps,
} from "@/components/marketing/page-sections";
import { siblingUseCaseLinks } from "@/lib/seo/internal-links";
import { reelsUseCase } from "@/lib/seo/landing-pages";
import { landingPageGraph } from "@/lib/seo/schema";

const content = reelsUseCase;

export const metadata: Metadata = {
  title: content.title,
  description: content.description,
  alternates: { canonical: content.path },
};

export default function ReelsPage() {
  return (
    <LandingLayout
      schema={landingPageGraph({
        path: content.path,
        name: content.h1,
        description: content.description,
        faqs: content.faqs,
        breadcrumbLabel: "Reels",
      })}
    >
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
          {content.h1}
        </h1>
        <AnswerFirst>{content.answerFirst}</AnswerFirst>
        <LastUpdated />
      </div>
      <SeeAlso
        links={[
          { href: "/for", label: "all use cases" },
          ...siblingUseCaseLinks(content.path),
        ]}
      />
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <WorkflowSteps steps={content.workflow} />
      </section>
      <FaqSection faqs={content.faqs} />
      <MarketingCta />
      <RelatedLinks currentPath={content.path} />
    </LandingLayout>
  );
}