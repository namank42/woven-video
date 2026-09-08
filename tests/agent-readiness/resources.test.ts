import { describe, expect, it } from "vitest";
import { GET as missing, HEAD as missingHead } from "@/app/[...missing]/route";
import { GET as llms } from "@/app/llms.txt/route";
import { GET as home } from "@/app/index.md/route";
import { GET as docs } from "@/app/docs/index.md/route";
import { homepageFaqs } from "@/lib/seo/faqs";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { organizationSchema, websiteSchema } from "@/lib/seo/schema";

const request = new Request("https://www.woven.video/unknown");
describe("agent resources", () => {
  it("returns a real 404 with recovery destinations, including HEAD", async () => {
    const response = missing(request);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const body = await response.text();
    for (const path of ["/llms.txt", "/docs", "/sitemap.xml"]) expect(body).toContain(path);
    const head = missingHead(new Request(request, { method: "HEAD" }));
    expect(head.status).toBe(404);
    expect(await head.text()).toBe("");
  });
  it("publishes llms.txt in heading, summary, guidance, file-list order", async () => {
    const body = await llms(request).text();
    expect(body).toMatch(/^# Woven\n\n> /);
    const sections = body.split(/^## /m).slice(1);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      for (const line of section.split("\n").slice(1).filter(Boolean)) {
        expect(line).toMatch(/^- \[[^\]]+\]\(https:\/\/www\.woven\.video\/[^)]*\)(: .+)?$/);
      }
    }
  });
  it("keeps homepage FAQs identical across HTML content and Markdown", async () => {
    const body = await home(request).text();
    for (const faq of homepageFaqs) {
      expect(body).toContain(`### ${faq.q}`);
      expect(body).toContain(faq.a);
    }
  });
  it("documents the real SFX workflow without advertising the removed discovery API", async () => {
    const body = await docs(request).text();
    expect(body).toContain("# Woven SFX documentation");
    expect(body).toContain("sfx_search");
    expect(body).toContain("sfx_pull");
    expect(body).toContain("WOVEN_SFX_LIBRARY");
    expect(body).toContain("CC0");
    expect(body).not.toContain("/api/v1/site");
    expect(body).not.toContain("/openapi.json");
    expect(body).toContain("stdio");
    expect(sitemap().some(entry => entry.url === "https://www.woven.video/docs")).toBe(true);
  });
  it("retains private API crawl exclusions without a retired endpoint exception", () => {
    const rules = robots().rules;
    for (const rule of Array.isArray(rules) ? rules : [rules]) {
      expect(rule.allow).not.toContain("/api/v1/site$");
      expect(rule.disallow).toContain("/api/");
      expect(rule.disallow).toContain("/account/");
    }
  });
  it("disambiguates the brand consistently in organization and website data", () => {
    for (const schema of [organizationSchema(), websiteSchema()]) {
      expect(schema.name).toBe("Woven");
      expect(schema.alternateName).toContain("Woven Video");
      expect(schema.url).toBe("https://www.woven.video");
    }
  });
});
