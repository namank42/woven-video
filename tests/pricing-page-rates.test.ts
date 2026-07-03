import { describe, expect, it } from "vitest";

import {
  chatModelRates,
  featureRates,
  mediaModelRates,
} from "@/lib/pricing-page-rates";

describe("pricing page rates", () => {
  const mediaByName = new Map(mediaModelRates.map((rate) => [rate.name, rate]));

  it("keeps the hosted chat model rate rows available", () => {
    expect(chatModelRates.map((rate) => rate.name)).toEqual([
      "Claude Sonnet 4.6",
      "Claude Opus 4.8",
      "Claude Haiku 4.5",
      "GPT-5.5",
      "Kimi K2.6",
      "Grok 4.3",
    ]);

    expect(chatModelRates.find((rate) => rate.name === "GPT-5.5")).toMatchObject(
      {
        modelId: "openai/gpt-5.5",
        input: "$6.00/M",
        output: "$36.00/M",
        cacheRead: "$0.60/M",
        cacheWrite: "—",
      },
    );
  });

  it("keeps feature rates available for the other features table", () => {
    expect(featureRates).toEqual([
      {
        name: "Auto captions",
        description: "Generates word-timed captions from a reel voiceover.",
        rate: "$0.10/min",
        reference: "$0.10 minimum",
      },
      {
        name: "Web Search",
        description: "Searches the web for current info.",
        rate: "$0.012/call",
        reference: "$12.00 / 1K calls",
      },
      {
        name: "Web Fetch",
        description: "Reads a webpage.",
        rate: "$0.006/call",
        reference: "$6.00 / 1K calls",
      },
    ]);
  });

  it("publishes the curated hosted media model rows", () => {
    expect(mediaModelRates.map((rate) => rate.name)).toEqual([
      "GPT Image 2",
      "Nano Banana Pro",
      "Nano Banana Lite",
      "Gemini Omni Flash",
      "Veo 3.1",
      "Veo 3.1 Fast",
      "Seedance 2.0",
      "Seedance 2.0 Fast",
      "Kling v3 Pro",
      "Kling v3 Standard",
      "Eleven Music v2",
    ]);

    expect(mediaByName.get("GPT Image 2")).toMatchObject({
      capability: "Image generation and editing",
      rate:
        "Text: $6.00/M input, $1.50/M cached, $12.00/M output · Image: $9.60/M input, $2.40/M cached, $36.00/M output",
      notes: "Actual request cost varies by image size and quality.",
    });

    expect(mediaByName.get("Nano Banana Pro")).toMatchObject({
      capability: "Image generation and editing",
      rate: "$0.18/image",
      notes: "4K: $0.36/image · Web search: +$0.018/request",
    });

    expect(mediaByName.get("Nano Banana Lite")).toMatchObject({
      capability: "Image generation and editing",
      modelIds: ["fal-ai/nano-banana-lite", "fal-ai/nano-banana-lite/edit"],
      rate: "$1.20/image",
      notes: "Uses Fal's $1.00 generated-image unit with hosted markup.",
    });

    expect(mediaByName.get("Gemini Omni Flash")).toMatchObject({
      capability: "Video generation and editing",
      rate: "$1.20/generation",
      notes:
        "3-10 seconds. Treats Fal's $1 unit as one generation unit.",
    });

    expect(mediaByName.get("Veo 3.1")).toMatchObject({
      capability: "Video generation",
      rate: "$0.24/sec no audio · $0.48/sec audio",
      notes: "720p/1080p. 4K: $0.48/sec no audio, $0.72/sec audio.",
    });

    expect(mediaByName.get("Veo 3.1 Fast")).toMatchObject({
      capability: "Video generation",
      rate: "$0.12/sec no audio · $0.18/sec audio",
      notes: "720p/1080p. 4K: $0.36/sec no audio, $0.42/sec audio.",
    });

    expect(mediaByName.get("Seedance 2.0")).toMatchObject({
      capability: "Video generation",
      rate: "From $0.36/sec",
      notes:
        "720p. 1080p: $0.82/sec. Exact estimates shown before job submission.",
    });

    expect(mediaByName.get("Seedance 2.0 Fast")).toMatchObject({
      capability: "Video generation",
      rate: "From $0.29/sec",
      notes: "720p. Exact estimates shown before job submission.",
    });

    expect(mediaByName.get("Kling v3 Pro")).toMatchObject({
      capability: "Video generation",
      rate: "$0.13/sec audio off · $0.20/sec audio on",
      notes: "Voice control: $0.24/sec.",
    });

    expect(mediaByName.get("Kling v3 Standard")).toMatchObject({
      capability: "Video generation",
      rate: "$0.10/sec audio off · $0.15/sec audio on",
      notes: "Voice control: $0.18/sec.",
    });

    expect(mediaByName.get("Eleven Music v2")).toMatchObject({
      capability: "Music generation",
      modelIds: ["music_v2"],
      rate: "$0.20/min",
      notes: "$0.20 minimum. Up to 5 minutes.",
    });
  });

  it("lists provider endpoint IDs for endpoint-backed media rows", () => {
    expect(mediaByName.get("GPT Image 2")?.modelIds).toEqual([
      "openai/gpt-image-2",
      "openai/gpt-image-2/edit",
    ]);
    expect(mediaByName.get("Nano Banana Pro")?.modelIds).toEqual([
      "fal-ai/nano-banana-pro",
    ]);
    expect(mediaByName.get("Gemini Omni Flash")?.modelIds).toEqual([
      "fal-ai/gemini-omni-flash",
      "fal-ai/gemini-omni-flash/image-to-video",
      "fal-ai/gemini-omni-flash/reference-to-video",
      "fal-ai/gemini-omni-flash/edit",
    ]);
    expect(mediaByName.get("Veo 3.1")?.modelIds).toEqual([
      "fal-ai/veo3.1",
      "fal-ai/veo3.1/image-to-video",
      "fal-ai/veo3.1/first-last-frame-to-video",
      "fal-ai/veo3.1/reference-to-video",
    ]);
    expect(mediaByName.get("Veo 3.1 Fast")?.modelIds).toEqual([
      "fal-ai/veo3.1/fast",
      "fal-ai/veo3.1/fast/image-to-video",
      "fal-ai/veo3.1/fast/first-last-frame-to-video",
    ]);
    expect(mediaByName.get("Seedance 2.0")?.modelIds).toEqual([
      "bytedance/seedance-2.0/text-to-video",
      "bytedance/seedance-2.0/image-to-video",
      "bytedance/seedance-2.0/reference-to-video",
    ]);
    expect(mediaByName.get("Seedance 2.0 Fast")?.modelIds).toEqual([
      "bytedance/seedance-2.0/fast/text-to-video",
      "bytedance/seedance-2.0/fast/image-to-video",
      "bytedance/seedance-2.0/fast/reference-to-video",
    ]);
    expect(mediaByName.get("Kling v3 Pro")?.modelIds).toEqual([
      "fal-ai/kling-video/v3/pro/text-to-video",
      "fal-ai/kling-video/v3/pro/image-to-video",
    ]);
    expect(mediaByName.get("Kling v3 Standard")?.modelIds).toEqual([
      "fal-ai/kling-video/v3/standard/text-to-video",
      "fal-ai/kling-video/v3/standard/image-to-video",
    ]);
  });
});
