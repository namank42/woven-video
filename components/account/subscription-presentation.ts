export function isPaymentRequiredSubscriptionStatus(status: string) {
  return status === "past_due" || status === "unpaid";
}

export function selectAccountSubscription<T extends { status: string }>(
  rows: T[],
): T | null {
  return (
    rows.find((row) => isPaymentRequiredSubscriptionStatus(row.status)) ??
    rows.find((row) => row.status === "trialing" || row.status === "active") ??
    null
  );
}

export function resolveSubscriptionPresentation(input: {
  hasAccess: boolean;
  subscription: { status: string } | null;
  subscriptionUnavailable?: boolean;
}) {
  if (input.subscriptionUnavailable) return "unavailable" as const;
  if (
    input.subscription &&
    isPaymentRequiredSubscriptionStatus(input.subscription.status)
  ) {
    return "payment_required" as const;
  }
  if (input.subscription) return "managed" as const;
  return input.hasAccess ? ("grandfathered" as const) : ("acquisition" as const);
}
