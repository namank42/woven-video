import { requireApiAuth } from "@/lib/api/auth";
import { licenseGateResponse } from "@/lib/api/license";
import { apiError } from "@/lib/api/responses";
import { createReservedMediaJob } from "@/lib/media/jobs";
import { getMediaModel } from "@/lib/media/model-registry";
import { validateMediaParameters } from "@/lib/media/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CreateMediaJobBody = {
  model?: unknown;
  parameters?: unknown;
  input_asset_ids?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInputAssetIds(value: unknown): string[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return null;
    }
    ids.push(item.trim());
  }

  return ids;
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

  const parameters = validateMediaParameters(body.parameters ?? {}, model.parameterSchema);
  if (!parameters.ok) {
    return apiError(parameters.error, 400, "invalid_media_input");
  }

  const inputAssetIds = parseInputAssetIds(body.input_asset_ids);
  if (!inputAssetIds) {
    return apiError("input_asset_ids must be an array of nonempty strings.", 400, "invalid_media_input");
  }

  try {
    const job = await createReservedMediaJob({
      userId: authResult.auth.user.id,
      model,
      parameters: parameters.value,
      inputAssetIds,
    });

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
    if (message === "invalid_media_input") {
      return apiError("Invalid media input.", 400, "invalid_media_input");
    }
    console.error("Failed to create media job", error);
    return apiError("Unable to create media job.", 500, "media_job_create_failed");
  }
}
