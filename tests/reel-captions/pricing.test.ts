import { describe, expect, it } from "vitest";
import { chargeUsdMicrosForDuration } from "@/lib/reel-captions/pricing";

describe("chargeUsdMicrosForDuration", () => {
  it("applies the default minimum charge for a 1 second caption job", () => {
    expect(chargeUsdMicrosForDuration(1, null)).toBe(100_000);
  });

  it("charges the default public rate for a 120 second caption job", () => {
    expect(chargeUsdMicrosForDuration(120, null)).toBe(200_000);
  });

  it("rounds a 90 second caption job to the exact default public rate charge", () => {
    expect(chargeUsdMicrosForDuration(90, null)).toBe(150_000);
  });
});
