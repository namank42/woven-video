import { describe, expect, it } from "vitest";
import type { ModelPricingRule } from "@/lib/billing/model-pricing";
import { parseMediaModel } from "@/lib/media/model-registry";

describe("parseMediaModel", () => {
  it("normalizes curated pricing metadata into a public model", () => {
    const model = parseMediaModel(validRule());

    expect(model).toMatchObject({
      id: "fal:frontier-video",
      provider: "fal",
      kind: "video",
      pricing: { unit: "job", reserveUsdMicros: 500000, markupBps: 2000 },
    });
  });

  it("excludes rows missing a public id", () => {
    expect(parseMediaModel(validRule({
      metadata: { public_id: undefined },
    }))).toBeNull();
  });

  it("excludes rows missing a provider endpoint", () => {
    expect(parseMediaModel(validRule({
      metadata: { provider_endpoint: undefined },
    }))).toBeNull();
  });

  it("excludes rows with an invalid media kind", () => {
    expect(parseMediaModel(validRule({
      metadata: { kind: "document" },
    }))).toBeNull();
  });

  it("excludes rows with invalid provider or operation", () => {
    expect(parseMediaModel(validRule({ provider: "other" }))).toBeNull();
    expect(parseMediaModel(validRule({ operation: "chat" }))).toBeNull();
  });

  it("excludes rows with malformed required parameters", () => {
    expect(parseMediaModel(validRule({
      metadata: { parameter_schema: { type: "object", required: "prompt" } },
    }))).toBeNull();
  });

  it("defaults missing parameter schemas to an empty object schema", () => {
    const model = parseMediaModel(validRule({
      metadata: { parameter_schema: undefined },
    }));

    expect(model?.parameterSchema).toEqual({ type: "object", properties: {} });
  });

  it("excludes rows with malformed parameter properties", () => {
    expect(parseMediaModel(validRule({
      metadata: { parameter_schema: { type: "object", properties: [] } },
    }))).toBeNull();
    expect(parseMediaModel(validRule({
      metadata: { parameter_schema: { type: "object", properties: { prompt: { type: "date" } } } },
    }))).toBeNull();
  });

  it("does not coerce uploaded input support strings to true", () => {
    const model = parseMediaModel(validRule({
      metadata: { supports_uploaded_inputs: "false" },
    }));

    expect(model?.supportsUploadedInputs).toBe(false);
  });

  it("parses rich catalog metadata for production media models", () => {
    const model = parseMediaModel(validRule({
      metadata: {
        input_asset_schema: {
          roles: [{
            role: "first_frame",
            provider_field: "first_frame_url",
            media_kind: "image",
            required: true,
            min: 1,
            max: 1,
            content_type_prefixes: ["image/"],
          }],
        },
        pricing_formula: {
          type: "veo_seconds",
          rates: {
            default: { no_audio: "0.20", audio: "0.40" },
            "4k": { no_audio: "0.40", audio: "0.60" },
          },
          duration_parameter: "duration",
          audio_parameter: "generate_audio",
          resolution_parameter: "resolution",
        },
        parameter_schema: {
          type: "object",
          required: ["prompt"],
          additionalProperties: false,
          properties: {
            prompt: { type: "string", minLength: 1 },
            duration: { type: "string", enum: ["4s", "6s", "8s"], default: "8s" },
          },
        },
      },
    }));

    expect(model?.inputAssetSchema.roles).toEqual([{
      role: "first_frame",
      providerField: "first_frame_url",
      mediaKind: "image",
      required: true,
      min: 1,
      max: 1,
      contentTypePrefixes: ["image/"],
    }]);
    expect(model?.pricingFormula).toMatchObject({ type: "veo_seconds" });
    expect(model?.parameterSchema.properties?.duration).toMatchObject({
      enum: ["4s", "6s", "8s"],
      default: "8s",
    });
  });

  it("excludes rows with malformed input asset schema metadata", () => {
    expect(parseMediaModel(validRule({
      metadata: {
        input_asset_schema: {
          roles: [{
            role: "",
            provider_field: "image_url",
            media_kind: "image",
            required: true,
            min: 1,
            max: 1,
            content_type_prefixes: ["image/"],
          }],
        },
      },
    }))).toBeNull();
  });

  it("excludes rows with malformed pricing formula metadata", () => {
    expect(parseMediaModel(validRule({
      metadata: {
        pricing_formula: { type: "" },
      },
    }))).toBeNull();
  });

  it("parses rows with gpt image sized pricing formula metadata", () => {
    const model = parseMediaModel(validRule({
      model: "openai/gpt-image-2",
      operation: "image_generation",
      display_name: "GPT Image 2",
      metadata: {
        public_id: "openai/gpt-image-2",
        provider_endpoint: "openai/gpt-image-2",
        kind: "image",
        pricing_formula: { type: "gpt_image_sized" },
      },
    }));

    expect(model).not.toBeNull();
    expect(model?.pricingFormula.type).toBe("gpt_image_sized");
  });
});

function validRule(overrides: Partial<ModelPricingRule> & { metadata?: Record<string, unknown> } = {}): ModelPricingRule {
  const metadata = {
    public_id: "fal:frontier-video",
    provider_endpoint: "fal-ai/frontier-video",
    kind: "video",
    supports_uploaded_inputs: true,
    supported_input_types: ["image"],
    output_types: ["video"],
    pricing_unit: "job",
    parameter_schema: { type: "object", required: ["prompt"] },
    ...overrides.metadata,
  };

  return {
    id: "rule_1",
    provider: "fal",
    model: "fal-ai/frontier-video",
    operation: "video_generation",
    display_name: "Frontier Video",
    markup_bps: 2000,
    minimum_charge_usd_micros: 100000,
    reserve_amount_usd_micros: 500000,
    enabled: true,
    ...overrides,
    metadata,
  };
}
