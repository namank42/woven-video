import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const { jobId } = await context.params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("generation_jobs")
    .select(
      "id, status, estimated_cost_usd_micros, reserved_amount_usd_micros, final_cost_usd_micros, output, error, created_at, started_at, completed_at",
    )
    .eq("id", jobId)
    .eq("user_id", authResult.auth.user.id)
    .maybeSingle();

  if (error) {
    return apiError(error.message, 500, "caption_job_lookup_failed");
  }

  if (!data) {
    return apiError("Caption job not found.", 404, "caption_job_not_found");
  }

  return Response.json(data, {
    headers: {
      "cache-control": "no-store",
    },
  });
}
