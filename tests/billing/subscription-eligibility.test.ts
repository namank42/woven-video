import { describe, expect, it } from "vitest";

import { resolveCheckoutMode } from "@/lib/billing/subscription-eligibility";

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

  it("returns undefined when a no-access account has unknown trial eligibility", () => {
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: undefined })).toBeUndefined();
    expect(resolveCheckoutMode({ hasAccess: false, trialUsed: null })).toBeUndefined();
  });
});
