import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("account page billing copy", () => {
  it("uses generic subscription cancellation copy", async () => {
    const source = await readFile("app/account/page.tsx", "utf8");

    expect(source).not.toContain("Trial checkout cancelled. No card was charged.");
    expect(source).toContain("Subscription checkout cancelled. No card was charged.");
  });

  it("loads every relevant subscription and selects one deliberately", async () => {
    const source = await readFile("app/account/page.tsx", "utf8");
    const subscriptionQuery = source.slice(
      source.indexOf('.from("subscriptions")'),
      source.indexOf('supabase.rpc("has_access")'),
    );

    expect(subscriptionQuery).toContain(
      '.in("status", ["trialing", "active", "past_due", "unpaid"])',
    );
    expect(subscriptionQuery).not.toContain(".limit(1)");
    expect(source).toContain(
      "const subscriptionRowsAvailable = Array.isArray(subscriptionRows)",
    );
    expect(source).toMatch(
      /selectAccountSubscription\(\s*subscriptionRowsAvailable\s*\?\s*subscriptionRows\s*:\s*\[\],?\s*\)/,
    );
    expect(source).toContain("error: subscriptionError");
    expect(source).toContain("!subscriptionRowsAvailable");
    expect(source).toContain("subscriptionUnavailable={subscriptionUnavailable}");
  });

  it("renders payment recovery before acquisition checkout", async () => {
    const source = await readFile(
      "components/account/subscription-cta.tsx",
      "utf8",
    );
    const recoveryStart = source.indexOf(
      'if (presentation === "payment_required")',
    );
    const acquisitionStart = source.indexOf(
      "const offer = getNoAccessSubscriptionOffer(checkoutMode)",
    );
    const recoveryBranch = source.slice(recoveryStart, acquisitionStart);

    expect(recoveryStart).toBeGreaterThan(-1);
    expect(recoveryStart).toBeLessThan(acquisitionStart);
    expect(recoveryBranch).toContain("Payment needs attention");
    expect(recoveryBranch).toContain('role="heading"');
    expect(recoveryBranch).toContain("aria-level={2}");
    expect(recoveryBranch).toContain("action={createPortalSession}");
    expect(recoveryBranch).toContain("<ManageBillingButton />");
    expect(recoveryBranch).not.toContain("StartTrialButton");
    expect(recoveryBranch).not.toContain("createTrialCheckoutSession");
  });

  it("fails closed when subscription status is unavailable", async () => {
    const source = await readFile(
      "components/account/subscription-cta.tsx",
      "utf8",
    );
    const unavailableStart = source.indexOf('if (presentation === "unavailable")');
    const acquisitionStart = source.indexOf(
      "const offer = getNoAccessSubscriptionOffer(checkoutMode)",
    );
    const unavailableBranch = source.slice(unavailableStart, acquisitionStart);

    expect(unavailableStart).toBeGreaterThan(-1);
    expect(unavailableStart).toBeLessThan(acquisitionStart);
    expect(unavailableBranch).toContain("Billing status unavailable");
    expect(unavailableBranch).not.toContain("StartTrialButton");
    expect(unavailableBranch).not.toContain("createTrialCheckoutSession");
  });
});
