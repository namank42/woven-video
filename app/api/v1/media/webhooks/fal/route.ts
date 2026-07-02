import { apiError } from "@/lib/api/responses";
import {
  falWebhookHeaders,
  isFalWebhookVerificationError,
  verifyFalWebhookSignature,
} from "@/lib/media/providers/fal-webhooks";
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
  const rawBody = Buffer.from(await request.arrayBuffer());
  try {
    const headers = falWebhookHeaders(request);
    await verifyFalWebhookSignature({ headers, rawBody });
  } catch (error) {
    if (isFalWebhookVerificationError(error)) {
      if (error.kind === "invalid") {
        return apiError("Invalid Fal webhook signature.", 401, "unauthorized");
      }
      console.error("Fal webhook verifier infrastructure failure", { code: error.code });
      return apiError(
        "Fal webhook verifier is temporarily unavailable.",
        503,
        "provider_unavailable",
      );
    }

    console.error("Unexpected Fal webhook verifier failure");
    return apiError(
      "Fal webhook verifier is temporarily unavailable.",
      503,
      "provider_unavailable",
    );
  }

  const payload = parseJsonObject(rawBody);
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
      claim_expires_at: "1970-01-01T00:00:00.000Z",
    })
    .eq("provider_job_id", requestId)
    .eq("provider", "fal")
    .eq("type", "media_job")
    .eq("status", "waiting_provider");

  if (error) {
    console.error("Failed to update Fal media webhook state", error);
    return apiError(
      "Unable to update media job webhook state.",
      500,
      "provider_failed",
    );
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

function parseJsonObject(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}
