import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

type CancelledMediaJobRow = {
  id: string;
  status: string;
  reserved_amount_usd_micros: number | string;
  final_cost_usd_micros: number | string | null;
  error: string | null;
  completed_at: string | null;
};

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const { jobId } = await context.params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("cancel_queued_media_job", {
    p_user_id: authResult.auth.user.id,
    p_job_id: jobId,
  });

  if (error) {
    if (error.message === "media_job_not_found") {
      return apiError("Media job not found.", 404, "job_not_found");
    }
    if (error.message === "media_job_not_ready") {
      return apiError("Only queued jobs can be cancelled.", 409, "job_not_ready");
    }

    console.error("Failed to cancel media job", error);
    return apiError("Unable to cancel media job.", 500, "media_job_cancel_failed");
  }

  const cancelledJob = data as CancelledMediaJobRow | null;
  return Response.json(
    {
      id: cancelledJob?.id ?? jobId,
      status: cancelledJob?.status ?? "cancelled",
      reserved_credits_usd_micros: cancelledJob?.reserved_amount_usd_micros ?? null,
      final_cost_usd_micros: cancelledJob?.final_cost_usd_micros ?? 0,
      error: cancelledJob?.error ?? "Cancelled by user.",
      completed_at: cancelledJob?.completed_at ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
