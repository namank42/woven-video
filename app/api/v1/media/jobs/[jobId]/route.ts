import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { presentJobOutputs } from "@/lib/media/output-urls";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

type MediaJobRow = {
  id: string;
  status: string;
  estimated_cost_usd_micros: number | string;
  reserved_amount_usd_micros: number | string;
  final_cost_usd_micros: number | string | null;
  progress: unknown;
  input: unknown;
  output: unknown;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const { jobId } = await context.params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("generation_jobs")
    .select(
      "id, status, estimated_cost_usd_micros, reserved_amount_usd_micros, final_cost_usd_micros, progress, input, output, error, created_at, started_at, completed_at",
    )
    .eq("id", jobId)
    .eq("user_id", authResult.auth.user.id)
    .eq("type", "media_job")
    .maybeSingle();

  if (error) {
    console.error("Failed to look up media job", error);
    return apiError("Unable to look up media job.", 500, "media_job_lookup_failed");
  }

  if (!data) {
    return apiError("Media job not found.", 404, "job_not_found");
  }

  const job = data as MediaJobRow;
  const input = objectValue(job.input) ?? {};
  const output = objectValue(job.output) ?? {};
  const outputModel = stringValue(output.media_model_id);
  const inputModel = stringValue(input.media_model_id);
  let outputs;
  try {
    outputs = await presentJobOutputs({
      userId: authResult.auth.user.id,
      jobId: job.id,
      outputs: Array.isArray(output.outputs) ? output.outputs : [],
    });
  } catch (presentError) {
    console.error("Failed to sign media job output urls", presentError);
    return apiError("Unable to look up media job.", 500, "media_job_lookup_failed");
  }

  return Response.json(
    {
      id: job.id,
      status: job.status,
      model: outputModel ?? inputModel,
      progress: objectValue(job.progress) ?? { stage: job.status, percent: null },
      estimated_cost_usd_micros: job.estimated_cost_usd_micros,
      reserved_credits_usd_micros: job.reserved_amount_usd_micros,
      final_cost_usd_micros: job.final_cost_usd_micros,
      outputs,
      error: job.error ? { code: "provider_failed", message: "Generation failed." } : null,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
