import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import {
  resolveOfflineAccessExpiry,
  type LiveSubscriptionAccess,
} from "@/lib/billing/offline-access-expiry";
import { resolveCheckoutMode } from "@/lib/billing/subscription-eligibility";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const supabase = authResult.auth.supabase;

  const { data, error } = await supabase.rpc("get_billing_balance");

  if (error) {
    return apiError(error.message, 500, "balance_lookup_failed");
  }

  const row = Array.isArray(data) ? data[0] : null;
  const balanceUsdMicros = Number(row?.balance_usd_micros ?? 0);

  // Additive license object. `active` now reflects has_access (grandfathered OR
  // legacy license OR a live subscription: trialing/active/past_due) so trialing
  // users aren't walled. Omit the field on a read error so the client falls back
  // to its own cache (fail-open within its grace window).
  let license:
    | {
        active: boolean;
        granted_at: string | null;
        offline_access_expires_at?: string;
      }
    | undefined;
  let hasAccess: boolean | undefined;
  const { data: active, error: licenseError } = await supabase.rpc(
    "has_access",
  );

  if (!licenseError && typeof active === "boolean") {
    hasAccess = active;
    let grantedAt: string | null = null;
    if (hasAccess) {
      const { data: licenseRow } = await supabase
        .from("licenses")
        .select("granted_at")
        .eq("status", "active")
        .maybeSingle();
      grantedAt = licenseRow?.granted_at ?? null;
    }

    if (!hasAccess) {
      license = { active: false, granted_at: grantedAt };
    } else {
      const [
        { data: perpetualAccess, error: perpetualAccessError },
        { data: subscriptionRows, error: subscriptionError },
      ] = await Promise.all([
        supabase.rpc("has_active_license"),
        supabase
          .from("subscriptions")
          .select("status, trial_end")
          .in("status", ["trialing", "active", "past_due"])
          .order("created_at", { ascending: false }),
      ]);

      if (
        perpetualAccessError ||
        subscriptionError ||
        typeof perpetualAccess !== "boolean"
      ) {
        console.error("billing balance: failed to resolve access source", {
          perpetualAccessError: perpetualAccessError?.message,
          subscriptionError: subscriptionError?.message,
        });
      } else {
        const accessSourceResolution = resolveOfflineAccessExpiry({
          hasAccess,
          hasPerpetualAccess: perpetualAccess,
          liveSubscriptions: (subscriptionRows ??
            []) as LiveSubscriptionAccess[],
        });

        if (!accessSourceResolution.ok) {
          console.error(
            "billing balance: active access has no valid offline expiry source",
          );
        } else {
          license = {
            active: true,
            granted_at: grantedAt,
            ...(accessSourceResolution.expiresAt
              ? {
                  offline_access_expires_at: accessSourceResolution.expiresAt,
                }
              : {}),
          };
        }
      }
    }
  }

  let trialUsed: boolean | undefined;
  const { data: trialUsedData, error: trialUsedError } =
    await supabase.rpc("trial_used");

  if (!trialUsedError && typeof trialUsedData === "boolean") {
    trialUsed = trialUsedData;
  }

  const checkoutMode =
    hasAccess === undefined
      ? undefined
      : resolveCheckoutMode({ hasAccess, trialUsed });

  return Response.json({
    currency: row?.currency ?? "usd",
    balance_usd_micros: balanceUsdMicros,
    balance_usd: balanceUsdMicros / 1_000_000,
    ...(license ? { license } : {}),
    ...(trialUsed !== undefined ? { trial_used: trialUsed } : {}),
    ...(checkoutMode ? { checkout_mode: checkoutMode } : {}),
  });
}
