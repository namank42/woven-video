import { describe, expect, it } from "vitest";

import { getNoAccessSubscriptionOffer } from "@/components/account/subscription-offer";

describe("getNoAccessSubscriptionOffer", () => {
  it("uses free-trial copy only for explicit trial checkout mode", () => {
    expect(getNoAccessSubscriptionOffer("trial")).toEqual({
      title: "Start your free trial",
      buttonLabel: "Start your 7-day free trial",
      emphasizedFinePrint: "$0 due today",
      finePrint:
        "cancel anytime before day 7 · card required. We email you before your trial ends.",
    });
  });

  it("uses subscription copy for trial-used accounts", () => {
    const offer = getNoAccessSubscriptionOffer("subscription");

    expect(offer.title).toBe("Start your Woven subscription");
    expect(offer.buttonLabel).toBe("Subscribe to Woven");
    expect(`${offer.title} ${offer.buttonLabel} ${offer.finePrint}`).not.toMatch(
      /free trial|\$0 due today/i,
    );
  });

  it("uses generic checkout copy when eligibility is unknown", () => {
    const offer = getNoAccessSubscriptionOffer(undefined);

    expect(offer.title).toBe("Start Woven");
    expect(offer.buttonLabel).toBe("Continue to checkout");
    expect(`${offer.title} ${offer.buttonLabel} ${offer.finePrint}`).not.toMatch(
      /free trial|\$0 due today/i,
    );
  });
});
