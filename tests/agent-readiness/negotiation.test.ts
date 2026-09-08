import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const request = (accept?: string, path = "/", method = "GET") => new NextRequest(`https://www.woven.video${path}`, { method, headers: accept === undefined ? {} : { accept } });

describe("public document negotiation", () => {
  it.each(["/", "/docs", "/guide"])("serves Markdown at %s", async (path) => {
    const response = await proxy(request("text/markdown", path));
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toMatch(/^# Woven/);
    expect(response.headers.get("vary")).toMatch(/Accept/);
  });
  it.each([
    [undefined, false], ["*/*", false], ["text/html", false],
    ["text/markdown, text/html;q=0.8", true],
    ["text/markdown;q=0.2, text/html;q=0.9", false],
    ["text/markdown;q=0, */*;q=1", false],
    ["text/html;q=0, text/*;q=0.8", true],
    ["TEXT/MARKDOWN; charset=utf-8", true],
  ])("honors Accept %s", async (accept, markdown) => {
    const response = await proxy(request(accept));
    expect(response.headers.get("content-type")?.startsWith("text/markdown") ?? false).toBe(markdown);
    expect(response.headers.get("vary")).toMatch(/Accept/);
  });
  it.each(["application/json", "text/markdown;q=0, text/html;q=0", ""])("rejects unsupported %s", async (accept) => {
    expect((await proxy(request(accept))).status).toBe(406);
  });
  it("returns a bodyless HEAD with the same representation headers", async () => {
    const response = await proxy(request("text/markdown", "/", "HEAD"));
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toBe("");
  });
  it("preserves RSC and POST requests", async () => {
    const rsc = request("text/markdown");
    rsc.headers.set("rsc", "1");
    expect((await proxy(rsc)).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request("text/markdown", "/", "POST"))).headers.get("x-middleware-next")).toBe("1");
  });
  it.each(["/api/v1/models", "/account", "/login", "/sfx"])("does not negotiate %s", async path => {
    expect((await proxy(request("text/markdown", path))).headers.get("content-type")).toBeNull();
  });
});
