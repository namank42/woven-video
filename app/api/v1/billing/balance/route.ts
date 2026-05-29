import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";

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

  // Additive license object. RLS-scoped read of the user's own license.
  // Omit the field on a read error so the client falls back to its own cache
  // (fail-open within its grace window) rather than us asserting a state.
  let license: { active: boolean; granted_at: string | null } | undefined;
  const { data: licenseRow, error: licenseError } = await supabase
    .from("licenses")
    .select("granted_at")
    .eq("status", "active")
    .maybeSingle();

  if (!licenseError) {
    license = {
      active: licenseRow !== null,
      granted_at: licenseRow?.granted_at ?? null,
    };
  }

  return Response.json({
    currency: row?.currency ?? "usd",
    balance_usd_micros: balanceUsdMicros,
    balance_usd: balanceUsdMicros / 1_000_000,
    ...(license ? { license } : {}),
  });
}
