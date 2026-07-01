import { apiError } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFalRequestId(payload: Record<string, unknown>): string {
  const requestId = payload.request_id ?? payload.requestId;
  return typeof requestId === "string" ? requestId.trim() : "";
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!isObject(payload)) {
    return apiError("Request body must be a JSON object.");
  }

  const requestId = getFalRequestId(payload);
  if (!requestId) {
    return apiError("Missing Fal request id.", 400, "invalid_media_input");
  }

  const { error } = await createSupabaseAdminClient()
    .from("generation_jobs")
    .update({
      progress: {
        stage: "provider_webhook_received",
        percent: null,
        message: "Provider callback received",
      },
      last_provider_poll_at: new Date().toISOString(),
    })
    .eq("provider_job_id", requestId)
    .eq("provider", "fal")
    .eq("type", "media_job");

  if (error) {
    return apiError(error.message, 500, "provider_failed");
  }

  return Response.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
