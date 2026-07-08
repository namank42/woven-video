import type { CheckoutMode } from "@/lib/billing/subscription-eligibility";

export type NoAccessSubscriptionOffer = {
  title: string;
  buttonLabel: string;
  emphasizedFinePrint: string;
  finePrint: string;
};

export function getNoAccessSubscriptionOffer(
  checkoutMode: CheckoutMode | undefined,
): NoAccessSubscriptionOffer {
  if (checkoutMode === "trial") {
    return {
      title: "Start your free trial",
      buttonLabel: "Start your 7-day free trial",
      emphasizedFinePrint: "$0 due today",
      finePrint:
        "cancel anytime before day 7 · card required. We email you before your trial ends.",
    };
  }

  if (checkoutMode === "subscription") {
    return {
      title: "Start your Woven subscription",
      buttonLabel: "Subscribe to Woven",
      emphasizedFinePrint: "$99/year",
      finePrint: "billed annually. Checkout shows the total before you subscribe.",
    };
  }

  return {
    title: "Start Woven",
    buttonLabel: "Continue to checkout",
    emphasizedFinePrint: "$99/year",
    finePrint: "checkout shows the total before you confirm.",
  };
}
