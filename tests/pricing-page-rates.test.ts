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
      "Claude Sonnet 5",
      "Claude Opus 4.8",
      "GPT-5.6 Sol",
      "GPT-5.6 Terra",
      "Kimi K3",
    ]);

    expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
      "anthropic/claude-sonnet-4.6",
    );
    expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
      "openai/gpt-5.5",
    );
    expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
      "anthropic/claude-haiku-4.5",
    );
    expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
      "xai/grok-4.3",
    );
    expect(chatModelRates.find((rate) => rate.name === "Claude Sonnet 5")).toEqual({
      name: "Claude Sonnet 5",
      modelId: "anthropic/claude-sonnet-5",
      rateLabel: "Intro through Aug 31, 2026",
      input: "$2.40/M",
      output: "$12.00/M",
      cacheRead: "$0.24/M",
      cacheWrite: "$3.00/M",
      higherTier: {
        threshold: "From Sep 1, 2026",
        input: "$3.60/M",
        output: "$18.00/M",
        cacheRead: "$0.36/M",
        cacheWrite: "$4.50/M",
      },
    });

    expect(chatModelRates.find((rate) => rate.name === "GPT-5.6 Sol")).toEqual({
      name: "GPT-5.6 Sol",
      modelId: "openai/gpt-5.6-sol",
      input: "$6.00/M",
      output: "$36.00/M",
      cacheRead: "$0.60/M",
      cacheWrite: "$7.50/M",
      higherTier: {
        threshold: ">272K",
        input: "$12.00/M",
        output: "$54.00/M",
        cacheRead: "$1.20/M",
        cacheWrite: "$15.00/M",
      },
    });

    expect(chatModelRates.find((rate) => rate.name === "GPT-5.6 Terra")).toEqual({
      name: "GPT-5.6 Terra",
      modelId: "openai/gpt-5.6-terra",
      input: "$3.00/M",
      output: "$18.00/M",
      cacheRead: "$0.30/M",
      cacheWrite: "$3.75/M",
      higherTier: {
        threshold: ">272K",
        input: "$6.00/M",
        output: "$27.00/M",
        cacheRead: "$0.60/M",
        cacheWrite: "$7.50/M",
      },
    });
    expect(chatModelRates.find((rate) => rate.name === "Kimi K3")).toEqual({
      name: "Kimi K3",
      modelId: "moonshotai/kimi-k3",
      input: "$3.60/M",
      output: "$18.00/M",
      cacheRead: "$0.36/M",
      cacheWrite: "—",
    });
    expect(chatModelRates.map((rate) => rate.modelId)).not.toContain(
      "moonshotai/kimi-k2.6",
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
      "Nano Banana 2 Lite",
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
      rate: "From $0.02/image",
      notes: "Varies by quality and size · High quality: $0.33 (standard) – $0.62 (4K)",
    });

    expect(mediaByName.get("Nano Banana Pro")).toMatchObject({
      capability: "Image generation and editing",
      rate: "$0.18/image",
      notes: "4K: $0.36/image · Web search: +$0.018/request",
    });

    expect(mediaByName.get("Nano Banana 2 Lite")).toMatchObject({
      capability: "Image generation and editing",
      modelIds: ["google/nano-banana-2-lite", "google/nano-banana-2-lite/edit"],
      rate: "$0.0478/image",
      notes: "Fast image generation and editing.",
    });

    expect(mediaByName.get("Gemini Omni Flash")).toMatchObject({
      capability: "Video generation and editing",
      rate: "$1.20/generation",
      notes: "Supports 3-10 second video generations.",
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
      rate: "$0.36-$0.82/sec",
      notes: "480p/720p: $0.36/sec. 1080p/4K: $0.82/sec.",
    });

    expect(mediaByName.get("Seedance 2.0 Fast")).toMatchObject({
      capability: "Video generation",
      rate: "$0.17-$0.29/sec",
      notes:
        "Text/image 480p/720p: $0.29/sec. Reference 480p/720p: $0.17/sec.",
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
      notes: "$0.20 minimum. Up to 10 minutes.",
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
    expect(mediaByName.get("Nano Banana 2 Lite")?.modelIds).toEqual([
      "google/nano-banana-2-lite",
      "google/nano-banana-2-lite/edit",
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

  it("keeps public media pricing copy free of provider implementation details", () => {
    const publicCopy = mediaModelRates
      .flatMap((rate) => [rate.name, rate.capability, rate.rate, rate.notes])
      .join(" ");

    expect(publicCopy).not.toMatch(/\bFal\b|provider|hosted markup|unit pricing/i);
    expect(publicCopy).not.toMatch(/exact estimates? shown before job submission/i);
  });
});
