import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const { data, error } = await authResult.auth.supabase.rpc(
    "get_billing_balance",
  );

  if (error) {
    return apiError(error.message, 500, "balance_lookup_failed");
  }

  const row = Array.isArray(data) ? data[0] : null;
  const balanceUsdMicros = Number(row?.balance_usd_micros ?? 0);

  return Response.json({
    currency: row?.currency ?? "usd",
    balance_usd_micros: balanceUsdMicros,
    balance_usd: balanceUsdMicros / 1_000_000,
  });
}
