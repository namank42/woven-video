import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SubscriptionCta } from "@/components/account/subscription-cta";
import {
  resolveSubscriptionPresentation,
  selectAccountSubscription,
} from "@/components/account/subscription-presentation";

vi.mock("@/app/account/actions", () => ({
  createPortalSession: "/portal",
  createTrialCheckoutSession: "/checkout",
  resumeSubscription: "/resume",
}));

const subscription = (status: string) => ({
  status,
  trial_end: null,
  current_period_end: null,
  cancel_at_period_end: false,
  cancel_at: null,
});

describe("selectAccountSubscription", () => {
  it("prefers a past-due row over an active row", () => {
    const active = { id: "active", status: "active" };
    const pastDue = { id: "past-due", status: "past_due" };

    expect(selectAccountSubscription([active, pastDue])).toBe(pastDue);
  });

  it("selects an unpaid row for payment recovery", () => {
    const unpaid = { id: "unpaid", status: "unpaid" };

    expect(selectAccountSubscription([unpaid])).toBe(unpaid);
  });

  it("prefers an unpaid row over an active row", () => {
    const active = { id: "active", status: "active" };
    const unpaid = { id: "unpaid", status: "unpaid" };

    expect(selectAccountSubscription([active, unpaid])).toBe(unpaid);
  });

  it("selects a trialing row when no subscription is delinquent", () => {
    const trialing = { id: "trialing", status: "trialing" };

    expect(selectAccountSubscription([trialing])).toBe(trialing);
  });
});

describe("resolveSubscriptionPresentation", () => {
  it.each(["past_due", "unpaid"])(
    "requires payment for an inactive %s subscription",
    (status) => {
      expect(
        resolveSubscriptionPresentation({
          hasAccess: false,
          subscription: { status },
        }),
      ).toBe("payment_required");
    },
  );

  it.each(["past_due", "unpaid"])(
    "requires payment for an accessible %s subscription",
    (status) => {
      expect(
        resolveSubscriptionPresentation({
          hasAccess: true,
          subscription: { status },
        }),
      ).toBe("payment_required");
    },
  );

  it("manages an active subscription", () => {
    expect(
      resolveSubscriptionPresentation({
        hasAccess: true,
        subscription: { status: "active" },
      }),
    ).toBe("managed");
  });

  it("presents grandfathered access without a subscription", () => {
    expect(
      resolveSubscriptionPresentation({
        hasAccess: true,
        subscription: null,
      }),
    ).toBe("grandfathered");
  });

  it("presents acquisition without access or a subscription", () => {
    expect(
      resolveSubscriptionPresentation({
        hasAccess: false,
        subscription: null,
      }),
    ).toBe("acquisition");
  });

  it("does not present acquisition when subscription status is unavailable", () => {
    expect(
      resolveSubscriptionPresentation({
        hasAccess: false,
        subscription: null,
        subscriptionUnavailable: true,
      }),
    ).toBe("unavailable");
  });
});

describe("SubscriptionCta", () => {
  it.each([
    ["past_due", false],
    ["past_due", true],
    ["unpaid", false],
    ["unpaid", true],
  ] as const)(
    "renders only portal recovery for %s with hasAccess=%s",
    (status, hasAccess) => {
      const html = renderToStaticMarkup(
        SubscriptionCta({
          hasAccess,
          subscription: subscription(status),
        }),
      );

      expect(html).toContain("Payment needs attention");
      expect(html).toContain("We couldn&#x27;t charge your card");
      expect(html).toContain("access will return after payment");
      expect(html).toContain("Manage billing");
      expect(html).not.toContain("Start free trial");
      expect(html).not.toContain("Start subscription");
    },
  );
});
