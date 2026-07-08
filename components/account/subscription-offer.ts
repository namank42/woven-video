import type { CheckoutMode } from "@/lib/billing/subscription-eligibility";

export type NoAccessSubscriptionOffer = {
  title: string;
  buttonLabel: string;
  bullets: string[];
  emphasizedFinePrint: string;
  finePrint: string;
};

const bringYourOwnKeysBullet =
  "Bring your own Anthropic and OpenAI keys, or sign in with ChatGPT";

export function getNoAccessSubscriptionOffer(
  checkoutMode: CheckoutMode | undefined,
): NoAccessSubscriptionOffer {
  if (checkoutMode === "trial") {
    return {
      title: "Start your free trial",
      buttonLabel: "Start your 7-day free trial",
      bullets: [
        "$5 in Woven-hosted credits to try hosted models",
        bringYourOwnKeysBullet,
      ],
      emphasizedFinePrint: "$0 due today",
      finePrint:
        "cancel anytime before day 7 · card required. We email you before your trial ends.",
    };
  }

  if (checkoutMode === "subscription") {
    return {
      title: "Start your Woven subscription",
      buttonLabel: "Subscribe to Woven",
      bullets: [
        "Start access immediately with the annual Woven plan",
        bringYourOwnKeysBullet,
      ],
      emphasizedFinePrint: "$99/year",
      finePrint: "billed annually. Checkout shows the total before you subscribe.",
    };
  }

  return {
    title: "Start Woven",
    buttonLabel: "Continue to checkout",
    bullets: [
      "Checkout will show the available plan for your account",
      bringYourOwnKeysBullet,
    ],
    emphasizedFinePrint: "$99/year",
    finePrint: "checkout shows the total before you confirm.",
  };
}
