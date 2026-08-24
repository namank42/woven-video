const PAYMENT_REQUIRED_STATUSES = new Set(["past_due", "unpaid"]);

export function resolvePaymentRequired(
  hasAccess: boolean,
  statuses: readonly string[],
): boolean {
  return (
    !hasAccess &&
    statuses.some((status) => PAYMENT_REQUIRED_STATUSES.has(status))
  );
}
