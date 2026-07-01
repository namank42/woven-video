import { describe, expect, it } from "vitest";
import type { ModelPricingRule } from "@/lib/billing/model-pricing";
import { parseMediaModel } from "@/lib/media/model-registry";

describe("parseMediaModel", () => {
  it("normalizes curated pricing metadata into a public model", () => {
    const model = parseMediaModel({
      id: "rule_1",
      provider: "fal",
      model: "fal-ai/frontier-video",
      operation: "video_generation",
      display_name: "Frontier Video",
      markup_bps: 2000,
      minimum_charge_usd_micros: 100000,
      reserve_amount_usd_micros: 500000,
      enabled: true,
      metadata: {
        public_id: "fal:frontier-video",
        provider_endpoint: "fal-ai/frontier-video",
        kind: "video",
        supports_uploaded_inputs: true,
        supported_input_types: ["image"],
        output_types: ["video"],
        pricing_unit: "job",
        parameter_schema: { type: "object", required: ["prompt"] },
      },
    } satisfies ModelPricingRule);

    expect(model).toMatchObject({
      id: "fal:frontier-video",
      provider: "fal",
      kind: "video",
      pricing: { unit: "job", reserveUsdMicros: 500000, markupBps: 2000 },
    });
  });
});
