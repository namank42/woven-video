import type { Metadata } from "next";

import { LandingLayout } from "@/components/marketing/landing-layout";
import {
  AnswerFirst,
  FaqSection,
  LastUpdated,
  MarketingCta,
  RelatedLinks,
  RoundupTable,
} from "@/components/marketing/page-sections";
import { bestEditorRoundup } from "@/lib/seo/landing-pages";
import { landingPageGraph } from "@/lib/seo/schema";

const content = bestEditorRoundup;

export const metadata: Metadata = {
  title: content.title,
  description: content.description,
  alternates: { canonical: content.path },
};

export default function BestAiVideoEditorPage() {
  return (
    <LandingLayout
      wide
      schema={landingPageGraph({
        path: content.path,
        name: content.h1,
        description: content.description,
        faqs: content.faqs,
        breadcrumbLabel: "Best AI video editor",
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
        <h2 className="text-2xl font-semibold tracking-tight">How we compare</h2>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {content.criteria.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-foreground">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
      <RoundupTable entries={content.entries} />
      <FaqSection faqs={content.faqs} />
      <MarketingCta />
      <RelatedLinks />
    </LandingLayout>
  );
}