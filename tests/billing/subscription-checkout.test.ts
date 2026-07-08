import { describe, expect, it } from "vitest";

import {
  buildSubscriptionCheckoutSession,
  normalizeCheckoutOrigin,
} from "../../supabase/functions/create-checkout-session/subscription";

describe("subscription checkout helper", () => {
  it("normalizes only the app origin as app", () => {
    expect(normalizeCheckoutOrigin("app")).toBe("app");
    expect(normalizeCheckoutOrigin("web")).toBe("web");
    expect(normalizeCheckoutOrigin("https://evil.example")).toBe("web");
    expect(normalizeCheckoutOrigin(undefined)).toBe("web");
  });

  it("builds a trial checkout for trial-eligible app users", () => {
    const plan = buildSubscriptionCheckoutSession({
      customerId: "cus_123",
      userId: "user_123",
      priceId: "price_123",
      siteUrl: "https://woven.video/",
      origin: "app",
      trialUsed: false,
    });

    expect(plan.checkoutMode).toBe("trial");
    expect(plan.params).toMatchObject({
      mode: "subscription",
      customer: "cus_123",
      client_reference_id: "user_123",
      payment_method_collection: "always",
      line_items: [{ price: "price_123", quantity: 1 }],
      metadata: {
        user_id: "user_123",
        purpose: "subscription",
        trial_eligible: "true",
      },
      success_url:
        "https://woven.video/checkout/success?subscription=trialing&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://woven.video/checkout/cancelled",
    });
    expect(plan.params.subscription_data).toEqual({
      trial_period_days: 7,
      trial_settings: {
        end_behavior: { missing_payment_method: "cancel" },
      },
      metadata: {
        user_id: "user_123",
        purpose: "subscription",
        trial_eligible: "true",
      },
    });
  });

  it("builds an immediate paid checkout for trial-used web users", () => {
    const plan = buildSubscriptionCheckoutSession({
      customerId: "cus_456",
      userId: "user_456",
      priceId: "price_456",
      siteUrl: "https://woven.video",
      origin: "web",
      trialUsed: true,
    });

    expect(plan.checkoutMode).toBe("subscription");
    expect(plan.params.success_url).toBe(
      "https://woven.video/account?subscription=started&session_id={CHECKOUT_SESSION_ID}",
    );
    expect(plan.params.cancel_url).toBe("https://woven.video/account?subscription=cancelled");
    expect(plan.params.metadata.trial_eligible).toBe("false");
    expect(plan.params.subscription_data).toEqual({
      metadata: {
        user_id: "user_456",
        purpose: "subscription",
        trial_eligible: "false",
      },
    });
    expect(plan.params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(plan.params.subscription_data).not.toHaveProperty("trial_settings");
  });

  it("builds an immediate paid checkout return for trial-used app users", () => {
    const plan = buildSubscriptionCheckoutSession({
      customerId: "cus_789",
      userId: "user_789",
      priceId: "price_789",
      siteUrl: "https://woven.video",
      origin: "app",
      trialUsed: true,
    });

    expect(plan.checkoutMode).toBe("subscription");
    expect(plan.params.success_url).toBe(
      "https://woven.video/checkout/success?subscription=started&session_id={CHECKOUT_SESSION_ID}",
    );
    expect(plan.params.cancel_url).toBe("https://woven.video/checkout/cancelled");
    expect(plan.params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(plan.params.subscription_data).not.toHaveProperty("trial_settings");
  });
});
