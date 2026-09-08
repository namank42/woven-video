import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";

const base = process.env.AGENT_READINESS_BASE_URL;
const get = (path: string, accept = "text/html", method = "GET") => fetch(`${base}${path}`, { method, headers: { accept } });
const textOnly = (html: string) => html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe.skipIf(!base)("production HTTP agent-readiness", () => {
  it.each(sitemap().map(entry => new URL(entry.url).pathname))("serves public page %s", async path => {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toMatch(/<h1[ >]/i);
  }, 30000);
  it("serves meaningful, sequentially headed HTML without JavaScript", async () => {
    const html = await (await get("/")).text();
    const content = textOnly(html);
    expect(content.length).toBeGreaterThan(500);
    const markup = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    expect(content.length / markup.length).toBeGreaterThanOrEqual(0.05);
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map(match => Number(match[1]));
    expect(levels.filter(level => level === 1)).toHaveLength(1);
    expect(levels).toContain(2);
    expect(levels).toContain(3);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1);
    const withoutNoScript = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, "");
    expect(withoutNoScript).toContain("You describe the cut you want in chat");
    expect(html).toMatch(/<noscript>[\s\S]*What is Woven\?[\s\S]*native macOS[\s\S]*<\/noscript>/);
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
    expect(schemas.some(schema => schema["@graph"]?.some((node: { "@type": string; alternateName?: string[] }) => node["@type"] === "WebSite" && node.alternateName?.includes("Woven Video")))).toBe(true);
    console.log(`Raw homepage: ${content.length} text characters; ${(100 * content.length / markup.length).toFixed(1)}% content ratio`);
  });
  it.each(["/", "/docs"])("keeps HTML and Markdown variants distinct at %s", async path => {
    for (const accept of ["text/markdown", "text/html", "text/markdown", "*/*"]) {
      const response = await get(path, accept);
      expect(response.status).toBe(200);
      if (accept === "text/markdown") {
        expect(response.headers.get("vary")?.toLowerCase().split(/,\s*/)).toContain("accept");
      }
      // Next.js overwrites HTML Vary; both variants must disable CDN caching.
      expect(response.headers.get("cdn-cache-control")).toBe("no-store");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("content-type")).toContain(accept === "text/markdown" ? "text/markdown" : "text/html");
      expect(response.headers.get("link")).toContain('rel="describedby"');
      if (accept === "text/html") expect(response.headers.get("vary")?.toLowerCase()).toContain("rsc");
    }
    expect((await get(path, "application/json")).status).toBe(406);
    const head = await get(path, "text/markdown", "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
  it.each(["/does-not-exist-agent-check", "/docs/no-such-guide", "/missing-file.json", "/for/no-such-use-case"])("returns recoverable 404 at %s", async path => {
    const response = await get(path, "*/*");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    const body = await response.text();
    expect(body).toContain("/sitemap.xml");
    expect(body).toContain("/llms.txt");
    expect(body).toContain("/docs");
    expect((await get(path, "text/markdown", "HEAD")).status).toBe(404);
  });
  it.each(["/llms.txt", "/index.md", "/docs/index.md", "/agents.md"])("validates Markdown resource and its internal links: %s", async path => {
    const response = await get(path, "*/*");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown; charset=utf-8");
    const body = await response.text();
    expect(body).toMatch(/^# Woven/);
    for (const match of body.matchAll(/\]\(https:\/\/www\.woven\.video([^)]*)\)/g)) {
      expect((await get(match[1] || "/", "*/*")).status, match[1]).toBe(200);
    }
  }, 30000);
  it("validates sitemap and robots discovery", async () => {
    const map = await get("/sitemap.xml", "application/xml");
    expect(map.status).toBe(200);
    const xml = await map.text();
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain("https://www.woven.video/docs");
    const robots = await get("/robots.txt", "text/plain");
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain("Sitemap: https://www.woven.video/sitemap.xml");
  });
});

describe.skipIf(!base)("SFX documentation and retired discovery API", () => {
  it.each(["/api/v1/site", "/openapi.json"])("does not expose the retired contract at %s", async path => {
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await get(path, "*/*", method);
      expect(response.status).toBe(404);
      if (method === "HEAD") expect(await response.text()).toBe("");
      else expect(await response.text()).not.toContain("getWovenSiteInfo");
    }
  });
  it("returns API problem details with useful recovery links", async () => {
    const response = await get("/api/no-such-endpoint", "application/json");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const problem = await response.json();
    expect(problem.type).toBe("about:blank");
    expect(problem.status).toBe(404);
    expect(problem.instance).toBe("/api/no-such-endpoint");
    expect(problem.documentation).toBe("https://www.woven.video/agents.md");
    expect(problem.specification).toBeUndefined();
  });
  it("documents the SFX workflow in HTML and Markdown with valid catalog examples", async () => {
    const html = await (await get("/docs")).text();
    const markdown = await (await get("/docs/index.md", "*/*")).text();
    for (const body of [html, markdown]) {
      for (const term of ["Woven SFX documentation", "sfx_search", "sfx_pull", "sfx_list_installed", "WOVEN_SFX_LIBRARY", "stdio", "CC0"]) expect(body).toContain(term);
      expect(body).not.toContain("/api/v1/site");
      expect(body).not.toContain("/openapi.json");
    }
    const config = JSON.parse(markdown.match(/```json\n([\s\S]*?)\n```/)![1]);
    expect(config.mcpServers["woven-sfx"].args).toEqual(["-y", "woven-sfx-mcp"]);
    const response = await get("/sfx/catalog.json", "application/json");
    expect(response.status).toBe(200);
    const catalog = await response.json();
    const sound = catalog.sounds.find((sound: { id: string }) => sound.id === "camera-shutter-release");
    expect(sound).toBeDefined();
    for (const key of ["id", "duration_ms", "tags", "default_volume", "file", "url", "peaks_url"]) expect(sound).toHaveProperty(key);
    expect((await fetch(sound.url, { method: "HEAD" })).status).toBe(200);
    expect((await fetch(sound.peaks_url)).status).toBe(200);
  });
  it("publishes separate editor and SFX guidance without retired API links", async () => {
    for (const path of ["/llms.txt", "/agents.md", "/index.md"]) {
      const body = await (await get(path, "*/*")).text();
      expect(body).toContain("Woven SFX");
      expect(body).not.toContain("/api/v1/site");
      expect(body).not.toContain("/openapi.json");
    }
  });
});
