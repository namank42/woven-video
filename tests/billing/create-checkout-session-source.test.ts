import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("create-checkout-session source", () => {
  it("checks trial-used eligibility before creating subscription checkout", async () => {
    const source = await readFile(
      "supabase/functions/create-checkout-session/index.ts",
      "utf8",
    );

    expect(source).toContain("user_trial_used");
    expect(source).toContain("failed_to_check_trial_eligibility");
    expect(source).toContain("checkoutMode");
  });

  it("fails closed when trial eligibility is not a boolean", async () => {
    const source = await readFile(
      "supabase/functions/create-checkout-session/index.ts",
      "utf8",
    );

    expect(source).toContain('typeof trialUsed !== "boolean"');
    expect(source).toContain("invalid_trial_eligibility_result");
  });

  it("fails closed when access eligibility is not a boolean", async () => {
    const source = await readFile(
      "supabase/functions/create-checkout-session/index.ts",
      "utf8",
    );

    expect(source).toContain('typeof hasAccess !== "boolean"');
    expect(source).toContain("invalid_access_result");
  });

  it("reserves and reuses open trial subscription checkout sessions before calling Stripe", async () => {
    const source = await readFile(
      "supabase/functions/create-checkout-session/index.ts",
      "utf8",
    );

    const reserveIndex = source.indexOf("reserve_subscription_checkout_session");
    const stripeCreateIndex = source.indexOf("stripe.checkout.sessions.create");

    expect(reserveIndex).toBeGreaterThan(-1);
    expect(stripeCreateIndex).toBeGreaterThan(-1);
    expect(reserveIndex).toBeLessThan(stripeCreateIndex);
    expect(source).toContain("record_subscription_checkout_session");
    expect(source).toContain("subscription_checkout_pending");
    expect(source).toContain("stripe_checkout_url");
  });
});
