import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProviderOutput, isAllowedOutputHost } from "@/lib/media/output-fetch";

describe("isAllowedOutputHost", () => {
  it.each([
    ["v3b.fal.media", true],
    ["fal.media", true],
    ["a.b.fal.media", true],
    ["evil.com", false],
    ["fal.media.evil.com", false],
    ["notfal.media", false],
    ["localhost", false],
    ["169.254.169.254", false],
  ])("%s -> %s", (host, expected) => {
    expect(isAllowedOutputHost(host, ["fal.media", "*.fal.media"])).toBe(expected);
  });
});

describe("fetchProviderOutput", () => {
  afterEach(() => vi.unstubAllGlobals());

  const base = {
    allowlist: ["fal.media", "*.fal.media"],
    expectedType: "image" as const,
    maxBytes: 1024,
  };

  it("rejects http urls", async () => {
    await expect(fetchProviderOutput({ ...base, url: "http://v3b.fal.media/f.png" }))
      .rejects.toThrow("media_output_url_not_allowed");
  });

  it("rejects hosts outside the allowlist", async () => {
    await expect(fetchProviderOutput({ ...base, url: "https://evil.com/f.png" }))
      .rejects.toThrow("media_output_url_not_allowed");
  });

  it("rejects mismatched content types", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", {
      status: 200,
      headers: { "content-type": "text/html" },
    })));

    await expect(fetchProviderOutput({ ...base, url: "https://v3b.fal.media/f.png" }))
      .rejects.toThrow("media_output_content_type_mismatch");
  });

  it("passes redirect: error and a timeout signal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from("img"), {
      status: 200,
      headers: { "content-type": "image/png" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderOutput({ ...base, url: "https://v3b.fal.media/f.png" });

    expect(result.bytes.toString()).toBe("img");
    const init = fetchMock.mock.calls[0][1];
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("enforces the byte cap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.alloc(2048), {
      status: 200,
      headers: { "content-type": "image/png" },
    })));

    await expect(fetchProviderOutput({ ...base, url: "https://v3b.fal.media/f.png" }))
      .rejects.toThrow("media_output_too_large");
  });
});
