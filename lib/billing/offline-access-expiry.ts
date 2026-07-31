export type LiveSubscriptionAccess = {
  status: "trialing" | "active" | "past_due";
  trial_end: string | null;
};

export type OfflineAccessExpiryResolution =
  | { ok: true; expiresAt: string | null }
  | { ok: false };

export function resolveOfflineAccessExpiry({
  hasAccess,
  hasPerpetualAccess,
  liveSubscriptions,
}: {
  hasAccess: boolean;
  hasPerpetualAccess: boolean;
  liveSubscriptions: LiveSubscriptionAccess[];
}): OfflineAccessExpiryResolution {
  if (!hasAccess || hasPerpetualAccess) {
    return { ok: true, expiresAt: null };
  }

  if (
    liveSubscriptions.some(
      ({ status }) => status === "active" || status === "past_due",
    )
  ) {
    return { ok: true, expiresAt: null };
  }

  const trial = liveSubscriptions.find(({ status }) => status === "trialing");
  if (!trial?.trial_end || Number.isNaN(Date.parse(trial.trial_end))) {
    return { ok: false };
  }

  return { ok: true, expiresAt: trial.trial_end };
}
