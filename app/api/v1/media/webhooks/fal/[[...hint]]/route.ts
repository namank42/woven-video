import { apiError } from "@/lib/api/responses";
import { triggerMediaKindForOperation } from "@/lib/media/kind";
import { dispatchMediaJob } from "@/lib/media/trigger-dispatch";
import {
  falWebhookHeaders,
  isFalWebhookVerificationError,
  verifyFalWebhookSignature,
} from "@/lib/media/providers/fal-webhooks";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ hint?: string[] }> };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFalRequestId(payload: Record<string, unknown>): string {
  const requestId = payload.request_id ?? payload.requestId;
  return typeof requestId === "string" ? requestId.trim() : "";
}

export async function POST(request: Request, context: RouteContext) {
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

  const { hint } = await context.params;
  const [hintJobId, hintNonce] = hint ?? [];
  const admin = createSupabaseAdminClient();

  const { data: mapped } = await admin
    .from("generation_jobs")
    .select("id")
    .eq("provider_job_id", requestId)
    .eq("provider", "fal")
    .eq("type", "media_job")
    .maybeSingle();

  if (!mapped?.id && hintJobId && hintNonce) {
    const { data: hintedJob, error: hintError } = await admin
      .from("generation_jobs")
      .select("id")
      .eq("id", hintJobId)
      .eq("provider_attempt_nonce", hintNonce)
      .eq("provider", "fal")
      .eq("type", "media_job")
      .is("provider_job_id", null)
      .in("status", ["running", "waiting_provider"])
      .maybeSingle();
    if (hintError) {
      console.error("Failed to load Fal webhook hint candidate", hintError);
      return apiError("Unable to load media job webhook state.", 500, "provider_failed");
    }
    if (!hintedJob?.id) {
      return okResponse();
    }

    const { error: adoptError } = await admin
      .from("generation_jobs")
      .update({ provider_job_id: requestId })
      .eq("id", hintJobId)
      .eq("provider_attempt_nonce", hintNonce)
      .eq("provider", "fal")
      .eq("type", "media_job")
      .is("provider_job_id", null)
      .in("status", ["running", "waiting_provider"]);
    if (adoptError) {
      console.error("Failed to adopt Fal request id from webhook hint", adoptError);
      return apiError("Unable to update media job webhook state.", 500, "provider_failed");
    }
  }

  const isProviderError = payload.status === "ERROR";
  const progress = isProviderError
    ? {
        stage: "provider_webhook_error",
        percent: null,
        message: typeof payload.error === "string"
          ? payload.error.slice(0, 500)
          : "Provider reported an error",
      }
    : {
        stage: "provider_webhook_received",
        percent: null,
        message: "Provider callback received",
      };

  const { error } = await admin
    .from("generation_jobs")
    .update({
      progress,
      last_provider_poll_at: new Date().toISOString(),
      claim_expires_at: "1970-01-01T00:00:00.000Z",
    })
    .eq("provider_job_id", requestId)
    .eq("provider", "fal")
    .eq("type", "media_job")
    .in("status", ["running", "waiting_provider"]);

  if (error) {
    console.error("Failed to update Fal media webhook state", error);
    return apiError(
      "Unable to update media job webhook state.",
      500,
      "provider_failed",
    );
  }

  const { data: job, error: jobError } = await admin
    .from("generation_jobs")
    .select("id, user_id, input")
    .eq("provider_job_id", requestId)
    .eq("provider", "fal")
    .eq("type", "media_job")
    .in("status", ["running", "waiting_provider"])
    .maybeSingle();

  if (jobError) {
    console.error("Failed to load Fal media webhook job", jobError);
    return apiError("Unable to load media job webhook state.", 500, "provider_failed");
  }

  if (job?.id && job.user_id) {
    const input = isObject(job.input) ? job.input : {};
    const operation = typeof input.operation === "string" ? input.operation : "";
    const kind = triggerMediaKindForOperation(operation);
    if (!kind) {
      console.warn("Skipping Fal webhook Trigger dispatch for unsupported media operation", {
        jobId: String(job.id),
        operation,
      });
    } else {
      await dispatchMediaJob({
        jobId: String(job.id),
        userId: String(job.user_id),
        modelId: typeof input.media_model_id === "string" ? input.media_model_id : "unknown",
        kind,
        source: "webhook",
      });
    }
  }

  return okResponse();
}

function parseJsonObject(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

function okResponse() {
  return Response.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
