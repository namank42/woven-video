import { afterEach, describe, expect, it, vi } from "vitest";

import { transcribeWithElevenLabs } from "@/lib/reel-captions/elevenlabs";

describe("transcribeWithElevenLabs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("attaches the provider HTTP status to transcription failures", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("bad audio", { status: 500, statusText: "Server Error" }),
      ),
    );

    const failure = await transcribeWithElevenLabs({
      cloudStorageUrl: "https://media.example.test/objects/asset?token=t",
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as { status?: unknown }).status).toBe(500);
    expect((failure as Error).message).toContain("500");
  });

  it("normalizes provider words into caption tokens on success", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          text: "Hello world",
          language_code: "en",
          language_probability: 0.99,
          words: [
            { type: "word", text: "Hello", start: 0, end: 0.4 },
            { type: "word", text: "world", start: 0.4, end: 0.9 },
          ],
        }),
      ),
    );

    const result = await transcribeWithElevenLabs({
      cloudStorageUrl: "https://media.example.test/objects/asset?token=t",
    });

    expect(result.text).toBe("Hello world");
    expect(result.captions).toHaveLength(2);
    expect(result.captions[1]).toMatchObject({
      text: " world",
      startMs: 400,
      endMs: 900,
    });
  });
});
