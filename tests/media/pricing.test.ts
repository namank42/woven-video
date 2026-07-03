import { describe, expect, it } from "vitest";
import { chargeMediaUsdMicros } from "@/lib/media/pricing";
import { quoteMediaJob } from "@/lib/media/pricing-quotes";
import type { MediaModel } from "@/lib/media/types";

const model = {
  inputAssetSchema: { roles: [] },
  pricingFormula: { type: "static" },
  pricing: {
    markupBps: 2_000,
    minimumUsdMicros: 100_000,
    reserveUsdMicros: 500_000,
    unit: "job",
  },
} as unknown as MediaModel;

describe("chargeMediaUsdMicros", () => {
  it("applies 20 percent markup over raw cost", () => {
    expect(chargeMediaUsdMicros({ model, rawCostUsd: "0.25" })).toMatchObject({
      rawCostUsdMicros: 250_000,
      chargedAmountUsdMicros: 300_000,
      markupAmountUsdMicros: 50_000,
    });
  });

  it("honors minimum charge", () => {
    expect(chargeMediaUsdMicros({ model, rawCostUsd: "0.01" }).chargedAmountUsdMicros).toBe(100_000);
  });

  it("settles from the stored quote when provider raw cost is unavailable", () => {
    expect(chargeMediaUsdMicros({
      model,
      rawCostUsd: 0,
      pricingQuote: {
        estimateKind: "parameter_quote",
        providerCostUsdMicros: 3_200_000,
        chargedAmountUsdMicros: 3_840_000,
        reservedAmountUsdMicros: 3_840_000,
        markupAmountUsdMicros: 640_000,
        formula: "veo_seconds",
        inputs: {},
      },
    })).toMatchObject({
      rawCostUsdMicros: 3_200_000,
      chargedAmountUsdMicros: 3_840_000,
      markupAmountUsdMicros: 640_000,
    });
  });
});

describe("quoteMediaJob", () => {
  it("quotes Nano Banana Pro from image count, 4K mode, and web search", () => {
    const quote = quoteMediaJob({
      model: mediaModel({
        id: "fal-ai/nano-banana-pro",
        pricingFormula: {
          type: "nano_banana",
          image_parameter: "num_images",
          resolution_parameter: "resolution",
          web_search_parameter: "enable_web_search",
          provider_rate_usd_per_image: "0.15",
          provider_rate_usd_per_web_search: "0.015",
          four_k_multiplier: 2,
        },
      }),
      parameters: { num_images: 2, resolution: "4K", enable_web_search: true },
    });

    expect(quote).toMatchObject({
      estimateKind: "parameter_quote",
      providerCostUsdMicros: 630_000,
      chargedAmountUsdMicros: 756_000,
      reservedAmountUsdMicros: 756_000,
      formula: "nano_banana",
    });
  });

  it("quotes Nano Banana Lite from image count and provider unit pricing", () => {
    const quote = quoteMediaJob({
      model: mediaModel({
        id: "fal-ai/nano-banana-lite",
        pricingFormula: {
          type: "nano_banana",
          image_parameter: "num_images",
          provider_rate_usd_per_image: "1.00",
        },
      }),
      parameters: { num_images: 2 },
    });

    expect(quote).toMatchObject({
      estimateKind: "parameter_quote",
      providerCostUsdMicros: 2_000_000,
      chargedAmountUsdMicros: 2_400_000,
      reservedAmountUsdMicros: 2_400_000,
      formula: "nano_banana",
    });
  });

  it("quotes Veo seconds from duration, resolution, and audio", () => {
    const quote = quoteMediaJob({
      model: mediaModel({
        id: "fal-ai/veo3.1/image-to-video",
        pricing: { ...model.pricing, minimumUsdMicros: 0 },
        pricingFormula: {
          type: "veo_seconds",
          duration_parameter: "duration",
          resolution_parameter: "resolution",
          audio_parameter: "generate_audio",
          rates: {
            default: { no_audio: "0.20", audio: "0.40" },
            "4k": { no_audio: "0.40", audio: "0.60" },
          },
        },
      }),
      parameters: { duration: "8s", resolution: "720p", generate_audio: true },
    });

    expect(quote).toMatchObject({
      providerCostUsdMicros: 3_200_000,
      chargedAmountUsdMicros: 3_840_000,
      reservedAmountUsdMicros: 3_840_000,
      formula: "veo_seconds",
      inputs: { duration_seconds: 8, resolution: "720p", generate_audio: true },
    });
  });

  it("rejects Seedance auto duration because production quotes require explicit duration", () => {
    expect(() => quoteMediaJob({
      model: mediaModel({
        pricingFormula: {
          type: "seedance_seconds",
          duration_parameter: "duration",
          resolution_parameter: "resolution",
          rates: { "720p": "0.3034", "1080p": "0.682" },
        },
      }),
      parameters: { duration: "auto", resolution: "720p" },
    })).toThrow("media_quote_requires_explicit_duration");
  });
});

function mediaModel(overrides: Partial<MediaModel> = {}): MediaModel {
  return {
    id: "fal-ai/test",
    provider: "fal",
    providerModel: "fal-ai/test",
    providerEndpoint: "fal-ai/test",
    operation: "video_generation",
    kind: "video",
    displayName: "Test Media Model",
    supportsUploadedInputs: false,
    supportedInputTypes: [],
    outputTypes: ["video"],
    defaultParameters: {},
    parameterSchema: { type: "object" },
    inputAssetSchema: { roles: [] },
    pricingFormula: { type: "static" },
    pricing: model.pricing,
    metadata: {},
    rule: {},
    ...overrides,
  } as MediaModel;
}
