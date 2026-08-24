import { describe, expect, it } from "vitest";

import { resolvePaymentRequired } from "@/lib/billing/payment-required";
import { resolveCheckoutMode } from "@/lib/billing/subscription-eligibility";

describe("resolvePaymentRequired", () => {
  it("requires payment for inactive delinquent subscriptions", () => {
    expect(resolvePaymentRequired(false, ["past_due"])).toBe(true);
    expect(resolvePaymentRequired(false, ["unpaid"])).toBe(true);
  });

  it("does not require payment for canceled or active accounts", () => {
    expect(resolvePaymentRequired(false, ["canceled"])).toBe(false);
    expect(resolvePaymentRequired(true, ["past_due"])).toBe(false);
  });
});

describe("resolveCheckoutMode", () => {
  it("returns none when the account already has access", () => {
    expect(resolveCheckoutMode({ hasAccess: true, trialUsed: false })).toBe("none");
    expect(resolveCheckoutMode({ hasAccess: true, trialUsed: true })).toBe("none");
    expect(resolveCheckoutMode({ hasAccess: true, trialUsed: undefined })).toBe("none");
  });

  it("returns trial when the account lacks access and has never used a trial", () => {
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: false })).toBe("trial");
  });

  it("returns subscription when the account lacks access and has used a trial", () => {
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: true })).toBe("subscription");
  });

  it("returns none when an inactive account requires payment recovery", () => {
    expect(
      resolveCheckoutMode({
        hasAccess: false,
        trialUsed: true,
        paymentRequired: true,
      }),
    ).toBe("none");
  });

  it("returns undefined when a no-access account has unknown trial eligibility", () => {
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: undefined })).toBeUndefined();
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: null })).toBeUndefined();
  });
});
