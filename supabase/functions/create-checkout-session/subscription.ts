export type CheckoutOrigin = "app" | "web";
export type SubscriptionCheckoutMode = "trial" | "subscription";

type TrialEligibleValue = "true" | "false";

type SubscriptionCheckoutMetadata = {
  user_id: string;
  purpose: "subscription";
  trial_eligible: TrialEligibleValue;
};

export type SubscriptionCheckoutSessionParams = {
  mode: "subscription";
  customer: string;
  client_reference_id: string;
  payment_method_collection: "always";
  line_items: Array<{ price: string; quantity: number }>;
  subscription_data: {
    metadata: SubscriptionCheckoutMetadata;
    trial_period_days?: number;
    trial_settings?: {
      end_behavior: { missing_payment_method: "cancel" };
    };
  };
  metadata: SubscriptionCheckoutMetadata;
  success_url: string;
  cancel_url: string;
};

export function normalizeCheckoutOrigin(value: unknown): CheckoutOrigin {
  return value === "app" ? "app" : "web";
}

function normalizeSiteUrl(siteUrl: string) {
  return siteUrl.replace(/\/+$/, "");
}

function subscriptionRedirects({
  siteUrl,
  origin,
  trialUsed,
}: {
  siteUrl: string;
  origin: CheckoutOrigin;
  trialUsed: boolean;
}) {
  const baseUrl = normalizeSiteUrl(siteUrl);

  if (origin === "app") {
    return {
      successUrl: `${baseUrl}/checkout/success`,
      cancelUrl: `${baseUrl}/checkout/cancelled`,
    };
  }

  return {
    successUrl: trialUsed
      ? `${baseUrl}/account?subscription=started&session_id={CHECKOUT_SESSION_ID}`
      : `${baseUrl}/account?subscription=trialing&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}/account?subscription=cancelled`,
  };
}

export function buildSubscriptionCheckoutSession({
  customerId,
  userId,
  priceId,
  siteUrl,
  origin,
  trialUsed,
}: {
  customerId: string;
  userId: string;
  priceId: string;
  siteUrl: string;
  origin: CheckoutOrigin;
  trialUsed: boolean;
}): {
  checkoutMode: SubscriptionCheckoutMode;
  params: SubscriptionCheckoutSessionParams;
} {
  const trialEligible = trialUsed ? "false" : "true";
  const metadata: SubscriptionCheckoutMetadata = {
    user_id: userId,
    purpose: "subscription",
    trial_eligible: trialEligible,
  };
  const redirects = subscriptionRedirects({ siteUrl, origin, trialUsed });
  const subscriptionData: SubscriptionCheckoutSessionParams["subscription_data"] = {
    metadata,
  };

  if (!trialUsed) {
    subscriptionData.trial_period_days = 7;
    subscriptionData.trial_settings = {
      end_behavior: { missing_payment_method: "cancel" },
    };
  }

  return {
    checkoutMode: trialUsed ? "subscription" : "trial",
    params: {
      mode: "subscription",
      customer: customerId,
      client_reference_id: userId,
      payment_method_collection: "always",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: subscriptionData,
      metadata,
      success_url: redirects.successUrl,
      cancel_url: redirects.cancelUrl,
    },
  };
}
