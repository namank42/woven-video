import { describe, expect, it } from "vitest";

import { resolveOfflineAccessExpiry } from "@/lib/billing/offline-access-expiry";

describe("resolveOfflineAccessExpiry", () => {
  const trialEnd = "2026-08-03T10:00:00.000Z";

  it("returns no bound when access is inactive", () => {
    expect(
      resolveOfflineAccessExpiry({
        hasAccess: false,
        hasPerpetualAccess: false,
        liveSubscriptions: [],
      }),
    ).toEqual({ ok: true, expiresAt: null });
  });

  it("prefers perpetual access over a trial", () => {
    expect(
      resolveOfflineAccessExpiry({
        hasAccess: true,
        hasPerpetualAccess: true,
        liveSubscriptions: [{ status: "trialing", trial_end: trialEnd }],
      }),
    ).toEqual({ ok: true, expiresAt: null });
  });

  it.each(["active", "past_due"] as const)(
    "does not cap %s subscription access",
    (status) => {
      expect(
        resolveOfflineAccessExpiry({
          hasAccess: true,
          hasPerpetualAccess: false,
          liveSubscriptions: [
            { status: "trialing", trial_end: trialEnd },
            { status, trial_end: trialEnd },
          ],
        }),
      ).toEqual({ ok: true, expiresAt: null });
    },
  );

  it("returns the mirrored trial end when trialing is the only access source", () => {
    expect(
      resolveOfflineAccessExpiry({
        hasAccess: true,
        hasPerpetualAccess: false,
        liveSubscriptions: [{ status: "trialing", trial_end: trialEnd }],
      }),
    ).toEqual({ ok: true, expiresAt: trialEnd });
  });

  it.each([null, "not-a-date"])(
    "rejects a trial with invalid end %s",
    (invalidEnd) => {
      expect(
        resolveOfflineAccessExpiry({
          hasAccess: true,
          hasPerpetualAccess: false,
          liveSubscriptions: [{ status: "trialing", trial_end: invalidEnd }],
        }),
      ).toEqual({ ok: false });
    },
  );

  it("rejects active access with no recognized source", () => {
    expect(
      resolveOfflineAccessExpiry({
        hasAccess: true,
        hasPerpetualAccess: false,
        liveSubscriptions: [],
      }),
    ).toEqual({ ok: false });
  });
});
