import { describe, expect, it } from "vitest";

import { getCheckoutResultCopy } from "@/components/checkout/checkout-result";

describe("checkout result copy", () => {
  it("uses trial copy only for explicit trial success", () => {
    const copy = getCheckoutResultCopy("trial");

    expect(copy.headline).toBe("Your free trial is live.");
    expect(copy.body).toMatch(/\$5 in hosted credits/);
  });

  it("uses paid subscription copy for subscription success", () => {
    const copy = getCheckoutResultCopy("subscription");

    expect(copy.headline).toBe("Your subscription is active.");
    expect(copy.body).not.toMatch(/free trial|\$5 in hosted credits/i);
  });

  it("does not default unknown success to trial copy", () => {
    const copy = getCheckoutResultCopy("generic");

    expect(copy.headline).toBe("Checkout complete.");
    expect(copy.body).not.toMatch(/free trial|\$5 in hosted credits/i);
  });
});
