import { describe, expect, it } from "vitest";
import { chargeMediaUsdMicros } from "@/lib/media/pricing";
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
} as MediaModel;

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
});
