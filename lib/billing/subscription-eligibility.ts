export type CheckoutMode = "trial" | "subscription" | "none";

export function resolveCheckoutMode({
  hasAccess,
  paymentRequired,
  trialUsed,
}: {
  hasAccess: boolean;
  paymentRequired?: boolean;
  trialUsed: boolean | null | undefined;
}): CheckoutMode | undefined {
  if (hasAccess || paymentRequired) {
    return "none";
  }

  if (trialUsed === true) {
    return "subscription";
  }

  if (trialUsed === false) {
    return "trial";
  }

  return undefined;
}
