import type { Metadata } from "next";
import { LandingLayout } from "@/components/marketing/landing-layout";
import { productGuideChecked, productGuideIntro, productGuideLinks, productGuideSections, productGuideVersion } from "@/lib/agent-readiness/product-guide";
import { jsonLdGraph, webPageSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: { absolute: "Woven Product Guide — Mac Video Editing, AI, Captions and Export" },
  description: "Learn how Woven works: local projects, chat and timeline editing, captions, effects, audio, AI generation, reference analysis, skills, model access, and export.",
  alternates: { canonical: "/guide", types: { "text/markdown": "/guide/index.md" } },
};

export default function ProductGuide() {
  return (
    <LandingLayout schema={jsonLdGraph(webPageSchema({ path: "/guide", name: "Woven product guide", description: metadata.description! }))}>
      <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Woven product guide</h1>
      <p className="text-lg leading-relaxed text-muted-foreground">{productGuideIntro}</p>
      <p className="text-sm text-muted-foreground">Covers Woven {productGuideVersion}. Checked {productGuideChecked}. <a className="underline underline-offset-4" href="/guide/index.md">Read as Markdown</a>.</p>
      <nav aria-label="In this guide" className="rounded-lg border p-5">
        <h2 className="mb-3 text-lg font-semibold">In this guide</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {productGuideSections.map(section => <li key={section.id}><a className="text-sm underline underline-offset-4" href={`#${section.id}`}>{section.title}</a></li>)}
        </ul>
      </nav>
      {productGuideSections.map(section => (
        <section key={section.id} id={section.id} className="scroll-mt-24 space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
          {section.paragraphs.map(paragraph => <p key={paragraph} className="leading-relaxed text-muted-foreground">{paragraph}</p>)}
        </section>
      ))}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Product resources</h2>
        <ul className="space-y-2">{productGuideLinks.map(link => <li key={link.url}><a className="underline underline-offset-4" href={link.url}>{link.title}</a></li>)}</ul>
      </section>
    </LandingLayout>
  );
}
