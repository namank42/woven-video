import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("create-checkout-session source", () => {
  it("rejects delinquent subscriptions before access checks and Stripe Checkout creation", async () => {
    const source = await readFile(
      "supabase/functions/create-checkout-session/index.ts",
      "utf8",
    );

    const branchStart = source.indexOf('if (body.purpose === "subscription")');
    const branchEnd = source.indexOf("// ---- LICENSE checkout ----", branchStart);
    const branch = source.slice(branchStart, branchEnd);
    const delinquentQueryIndex = branch.indexOf('.from("subscriptions")');
    const hasAccessIndex = branch.indexOf('"user_has_access"');
    const conflictIndex = branch.indexOf(
      'new HttpError(409, "subscription_payment_required")',
    );
    const firstStripeCreateIndex = branch.indexOf(
      "stripe.checkout.sessions.create",
    );

    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
    expect(delinquentQueryIndex).toBeGreaterThan(-1);
    expect(hasAccessIndex).toBeGreaterThan(-1);
    expect(conflictIndex).toBeGreaterThan(-1);
    expect(firstStripeCreateIndex).toBeGreaterThan(-1);
    expect(delinquentQueryIndex).toBeLessThan(hasAccessIndex);
    expect(conflictIndex).toBeLessThan(firstStripeCreateIndex);
    expect(branch).toContain('.select("status")');
    expect(branch).toContain('.eq("user_id", user.id)');
    expect(branch).toContain('.in("status", ["past_due", "unpaid"])');
    expect(branch).toContain("!Array.isArray(delinquentSubscriptions)");
    expect(branch).toMatch(
      /new HttpError\(\s*500,\s*"failed_to_check_subscription_status"/,
    );
    expect(branch).toContain(
      'new HttpError(409, "subscription_payment_required")',
    );
  });

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
