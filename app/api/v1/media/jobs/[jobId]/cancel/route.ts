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
  const { data: job, error: lookupError } = await admin
    .from("generation_jobs")
    .select("id, status")
    .eq("id", jobId)
    .eq("user_id", authResult.auth.user.id)
    .eq("type", "media_job")
    .maybeSingle();

  if (lookupError) {
    return apiError(lookupError.message, 500, "media_job_lookup_failed");
  }

  if (!job) {
    return apiError("Media job not found.", 404, "job_not_found");
  }

  if (job.status !== "queued") {
    return apiError("Only queued jobs can be cancelled.", 409, "job_not_ready");
  }

  const { data, error } = await admin.rpc("release_balance_reservation", {
    p_job_id: jobId,
    p_status: "cancelled",
    p_error: "Cancelled by user.",
    p_metadata: { reason: "user_cancelled" },
  });

  if (error) {
    return apiError(error.message, 500, "media_job_cancel_failed");
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
