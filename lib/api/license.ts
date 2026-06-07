import type { ApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";

/**
 * Returns a 403 license_required Response if the authed user has no active license,
 * or null to proceed. Deploy-gated: when WOVEN_ENFORCE_LICENSE !== "true" this is a
 * no-op (returns null) so the code can ship before the license-aware harness has
 * adoption. Fails OPEN on any infra/DB error — a transient failure must never wrongly
 * lock out a licensed user.
 */
export async function licenseGateResponse(auth: ApiAuth): Promise<Response | null> {
  if (process.env.WOVEN_ENFORCE_LICENSE !== "true") {
    return null;
  }

  const { data, error } = await auth.supabase.rpc("has_access");

  if (error) {
    console.error("has_access check failed (failing open):", error.message);
    return null;
  }

  if (data === true) {
    return null;
  }

  return apiError(
    "A Woven license is required to use hosted models.",
    403,
    "license_required",
  );
}
