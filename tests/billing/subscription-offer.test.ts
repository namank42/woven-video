import { describe, expect, it } from "vitest";

import { getNoAccessSubscriptionOffer } from "@/components/account/subscription-offer";

describe("getNoAccessSubscriptionOffer", () => {
  it("uses free-trial copy only for explicit trial checkout mode", () => {
    expect(getNoAccessSubscriptionOffer("trial")).toEqual({
      title: "Start your free trial",
      buttonLabel: "Start your 3-day free trial",
      bullets: [
        "$5 in Woven-hosted credits to try hosted models",
        "Sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan",
      ],
      emphasizedFinePrint: "$0 due today",
      finePrint: "cancel anytime before day 3 · card required.",
    });
  });

  it("uses subscription copy for trial-used accounts", () => {
    const offer = getNoAccessSubscriptionOffer("subscription");

    expect(offer.title).toBe("Start your Woven subscription");
    expect(offer.buttonLabel).toBe("Subscribe to Woven");
    expect(offer.bullets).toEqual([
      "Start access immediately with the annual Woven plan",
      "Sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan",
    ]);
    expect(`${offer.title} ${offer.buttonLabel} ${offer.finePrint} ${offer.bullets.join(" ")}`).not.toMatch(
      /free trial|\$0 due today|\$5 in Woven-hosted credits/i,
    );
  });

  it("uses generic checkout copy when eligibility is unknown", () => {
    const offer = getNoAccessSubscriptionOffer(undefined);

    expect(offer.title).toBe("Start Woven");
    expect(offer.buttonLabel).toBe("Continue to checkout");
    expect(offer.bullets).toEqual([
      "Checkout will show the available plan for your account",
      "Sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan",
    ]);
    expect(`${offer.title} ${offer.buttonLabel} ${offer.finePrint} ${offer.bullets.join(" ")}`).not.toMatch(
      /free trial|\$0 due today|\$5 in Woven-hosted credits/i,
    );
  });
});
