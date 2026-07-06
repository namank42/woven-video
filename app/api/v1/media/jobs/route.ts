import { requireApiAuth } from "@/lib/api/auth";
import { licenseGateResponse } from "@/lib/api/license";
import { apiError } from "@/lib/api/responses";
import { parseMediaJobInputAssets } from "@/lib/media/input-assets";
import {
  createReservedMediaJob,
  failReservedMediaJobDispatch,
} from "@/lib/media/jobs";
import { validateProviderFetchableMediaBaseUrl } from "@/lib/media/provider-input-urls";
import { getMediaModel } from "@/lib/media/model-registry";
import { validateMediaParameters } from "@/lib/media/schema";
import { dispatchMediaJob, isTriggerMediaKind } from "@/lib/media/trigger-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CreateMediaJobBody = {
  model?: unknown;
  parameters?: unknown;
  input_assets?: unknown;
  input_asset_ids?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const licenseError = await licenseGateResponse(authResult.auth);
  if (licenseError) return licenseError;

  const payload = await request.json().catch(() => null);
  if (!isObject(payload)) {
    return apiError("Request body must be a JSON object.");
  }

  const body = payload as CreateMediaJobBody;
  if (typeof body.model !== "string" || !body.model.trim()) {
    return apiError("model must be a nonempty string.", 400, "invalid_media_input");
  }

  const model = await getMediaModel(body.model.trim());
  if (!model) {
    return apiError("Media model is not enabled.", 404, "model_not_enabled");
  }
  if (!isTriggerMediaKind(model.kind)) {
    return apiError(
      "Media model is not supported by the Trigger media executor.",
      400,
      "invalid_media_input",
    );
  }

  const parameters = validateMediaParameters(body.parameters ?? {}, model.parameterSchema);
  if (!parameters.ok) {
    return apiError(parameters.error, 400, "invalid_media_input");
  }

  const inputAssets = parseMediaJobInputAssets({
    model,
    inputAssets: body.input_assets,
    inputAssetIds: body.input_asset_ids,
  });
  if (!inputAssets.ok) {
    return apiError(inputAssets.error, 400, "invalid_media_input");
  }

  const providerInputUrlCheck = validateProviderFetchableMediaBaseUrl({
    inputAssetIds: inputAssets.inputAssetIds,
  });
  if (!providerInputUrlCheck.ok) {
    return apiError(
      "Uploaded-input media jobs require MEDIA_BASE_URL to be publicly reachable.",
      500,
      providerInputUrlCheck.error,
    );
  }

  try {
    const job = await createReservedMediaJob({
      userId: authResult.auth.user.id,
      model,
      parameters: parameters.value,
      inputAssets: inputAssets.inputAssets,
      inputAssetIds: inputAssets.inputAssetIds,
    });

    try {
      await dispatchMediaJob({
        jobId: job.id,
        userId: authResult.auth.user.id,
        modelId: job.model,
        kind: model.kind,
        source: "create",
      });
    } catch (dispatchError) {
      try {
        await failReservedMediaJobDispatch(job.id);
      } catch (cleanupError) {
        console.error(
          "Failed to release media job reservation after Trigger dispatch failure",
          cleanupError,
        );
      }
      console.error("Failed to dispatch media job", dispatchError);
      return apiError(
        "Media executor is temporarily unavailable. Please try again.",
        503,
        "media_executor_unavailable",
      );
    }

    return Response.json(
      {
        id: job.id,
        status: job.status,
        model: job.model,
        estimated_cost_usd_micros: job.estimatedCostUsdMicros,
        reserved_credits_usd_micros: job.reservedCreditsUsdMicros,
        created_at: job.createdAt,
        expires_at: job.expiresAt,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create media job.";
    if (message === "insufficient_balance") {
      return apiError(
        "Insufficient balance. Add funds before creating media jobs.",
        402,
        "insufficient_balance",
      );
    }
    if (message === "upload_not_complete") {
      return apiError("Upload is not complete.", 409, "upload_not_complete");
    }
    if (message === "upload_expired") {
      return apiError("Upload has expired.", 400, "upload_expired");
    }
    if (message === "invalid_media_input" || message.startsWith("media_quote_")) {
      return apiError("Invalid media input.", 400, "invalid_media_input");
    }
    console.error("Failed to create media job", error);
    return apiError("Unable to create media job.", 500, "media_job_create_failed");
  }
}
