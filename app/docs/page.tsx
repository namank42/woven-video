import type { Metadata } from "next";
import { LandingLayout } from "@/components/marketing/landing-layout";
import { sfxIntro, sfxSections, sfxLinks } from "@/lib/agent-readiness/sfx-docs";
import { jsonLdGraph, webPageSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: { absolute: "Woven SFX Documentation — Sound Effects for Developers and Agents" },
  description: "Install Woven SFX, connect its MCP server, search and download sound effects, and use the public catalog in your projects.",
  alternates: { canonical: "/docs", types: { "text/markdown": "/docs/index.md" } },
};

export default function SfxDocs() {
  return (
    <LandingLayout schema={jsonLdGraph(webPageSchema({ path: "/docs", name: "Woven SFX documentation", description: metadata.description! }))}>
      <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Woven SFX documentation</h1>
      <p className="text-lg leading-relaxed text-muted-foreground">{sfxIntro}</p>
      {sfxSections.map(section => (
        <section key={section.title} className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
          <p className="leading-relaxed text-muted-foreground">{section.body}</p>
          {"code" in section && <pre className="max-w-full overflow-x-auto rounded-lg border bg-muted p-4 text-sm"><code>{section.code}</code></pre>}
        </section>
      ))}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Public resources</h2>
        <ul className="space-y-2">
          {sfxLinks.map(link => <li key={link.url}><a className="underline underline-offset-4" href={link.url}>{link.title}</a></li>)}
          <li><a className="underline underline-offset-4" href="/docs/index.md">Read this guide as Markdown</a></li>
        </ul>
      </section>
    </LandingLayout>
  );
}
