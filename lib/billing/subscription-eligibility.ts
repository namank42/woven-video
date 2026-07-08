export type CheckoutMode = "trial" | "subscription" | "none";

export function resolveCheckoutMode({
  hasAccess,
  trialUsed,
}: {
  hasAccess: boolean;
  trialUsed: boolean | null | undefined;
}): CheckoutMode | undefined {
  if (hasAccess) {
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
