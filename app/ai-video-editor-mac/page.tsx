import type { Metadata } from "next";

import { LandingLayout } from "@/components/marketing/landing-layout";
import {
  AnswerFirst,
  FaqSection,
  HighlightCards,
  LastUpdated,
  MarketingCta,
  RelatedLinks,
} from "@/components/marketing/page-sections";
import { macEditorPage } from "@/lib/seo/landing-pages";
import { landingPageGraph } from "@/lib/seo/schema";

const content = macEditorPage;

export const metadata: Metadata = {
  title: content.title,
  description: content.description,
  alternates: { canonical: content.path },
};

export default function MacEditorPage() {
  return (
    <LandingLayout
      schema={landingPageGraph({
        path: content.path,
        name: content.h1,
        description: content.description,
        faqs: content.faqs,
        breadcrumbLabel: "AI video editor for Mac",
      })}
    >
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
          {content.h1}
        </h1>
        <AnswerFirst>{content.answerFirst}</AnswerFirst>
        <LastUpdated />
      </div>
      <HighlightCards items={content.highlights} />
      <FaqSection faqs={content.faqs} />
      <MarketingCta />
      <RelatedLinks currentPath={content.path} />
    </LandingLayout>
  );
}