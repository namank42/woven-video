import { requireApiAuth } from "@/lib/api/auth";
import { licenseGateResponse } from "@/lib/api/license";
import { apiError } from "@/lib/api/responses";
import { createInputAssetUpload } from "@/lib/media/assets";
import {
  chargeUsdMicrosForDuration,
  DEFAULT_MINIMUM_CHARGE_USD_MICROS,
  DEFAULT_PUBLIC_RATE_USD_PER_MINUTE,
  getReelCaptionPricing,
  MAX_REEL_CAPTION_DURATION_SECONDS,
  REEL_CAPTION_JOB_TYPE,
} from "@/lib/reel-captions/pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CreateCaptionJobBody = {
  durationSeconds?: unknown;
  filename?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
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

  const { durationSeconds, filename, contentType, sizeBytes } =
    payload as CreateCaptionJobBody;
  const duration = Number(durationSeconds);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > MAX_REEL_CAPTION_DURATION_SECONDS
  ) {
    return apiError(
      `durationSeconds must be between 0 and ${MAX_REEL_CAPTION_DURATION_SECONDS}.`,
    );
  }

  const uploadContentType =
    typeof contentType === "string" && contentType.startsWith("audio/")
      ? contentType
      : "audio/wav";
  const originalFilename =
    typeof filename === "string" && filename.trim()
      ? filename.trim().slice(0, 120)
      : "voiceover.wav";
  if (
    typeof sizeBytes !== "number" ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return apiError(
      "sizeBytes must be a positive integer.",
      400,
      "invalid_media_input",
    );
  }

  const rule = await getReelCaptionPricing();
  if (!rule) {
    return apiError(
      "Auto captions pricing rule is not enabled.",
      503,
      "caption_generation_not_enabled",
    );
  }

  const amountUsdMicros = chargeUsdMicrosForDuration(duration, rule);
  const admin = createSupabaseAdminClient();

  const { data: job, error: jobError } = await admin
    .from("generation_jobs")
    .insert({
      user_id: authResult.auth.user.id,
      type: REEL_CAPTION_JOB_TYPE,
      provider: rule.provider,
      model: rule.model,
      status: "queued",
      estimated_cost_usd_micros: amountUsdMicros,
      input: {
        duration_seconds: duration,
        filename: originalFilename,
        content_type: uploadContentType,
      },
    })
    .select("id")
    .single();

  if (jobError || !job?.id) {
    console.error("Failed to create caption job", jobError);
    return apiError("Unable to create caption job.", 500, "caption_job_create_failed");
  }

  const jobId = String(job.id);
  const { error: reserveError } = await admin.rpc("reserve_balance", {
    p_user_id: authResult.auth.user.id,
    p_job_id: jobId,
    p_amount_usd_micros: amountUsdMicros,
    p_metadata: {
      provider: rule.provider,
      model: rule.model,
      operation: rule.operation,
      duration_seconds: duration,
    },
  });

  if (reserveError) {
    const insufficient = reserveError.message === "insufficient_balance";
    await markJobFailed(
      admin,
      jobId,
      insufficient ? "insufficient_balance" : "caption_reservation_failed",
    );
    if (!insufficient) {
      console.error("Failed to reserve caption balance", reserveError);
    }
    return apiError(
      insufficient
        ? "Insufficient balance. Add funds before generating captions."
        : "Unable to reserve caption credits.",
      insufficient ? 402 : 500,
      insufficient ? "insufficient_balance" : "caption_reservation_failed",
    );
  }

  let upload: Awaited<ReturnType<typeof createInputAssetUpload>>;
  try {
    upload = await createInputAssetUpload({
      userId: authResult.auth.user.id,
      filename: originalFilename,
      contentType: uploadContentType,
      sizeBytes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create upload URL.";
    if (message === "invalid_media_input") {
      await releaseReservation(admin, jobId, "invalid_media_input");
      return apiError("Invalid media input.", 400, "invalid_media_input");
    }
    if (message === "upload_too_large") {
      await releaseReservation(admin, jobId, "upload_too_large");
      return apiError("Upload is too large.", 413, "upload_too_large");
    }

    console.error("Failed to create caption media upload", error);
    await releaseReservation(admin, jobId, "caption_upload_url_failed");
    return apiError("Unable to create caption upload.", 500, "caption_upload_url_failed");
  }

  const input = {
    duration_seconds: duration,
    filename: originalFilename,
    content_type: uploadContentType,
    media_asset_id: upload.asset.id,
  };
  const { error: updateError } = await admin
    .from("generation_jobs")
    .update({ input })
    .eq("id", jobId);

  if (updateError) {
    console.error("Failed to attach caption media asset to job", updateError);
    await releaseReservation(admin, jobId, "caption_job_update_failed");
    await markInputAssetDeleted(admin, upload.asset.id, jobId, "caption_job_update_failed");
    return apiError("Unable to update caption job.", 500, "caption_job_update_failed");
  }

  return Response.json(
    {
      id: jobId,
      status: "queued",
      upload: {
        assetId: upload.asset.id,
        method: "PUT",
        url: upload.uploadUrl,
        expiresAt: upload.expiresAt,
        contentType: uploadContentType,
      },
      estimatedCostUsdMicros: amountUsdMicros,
      pricing: {
        publicRateUsdPerMinute: publicRateUsdPerMinute(rule),
        minimumUsdMicros: minimumUsdMicros(rule),
      },
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

function publicRateUsdPerMinute(
  rule: Awaited<ReturnType<typeof getReelCaptionPricing>>,
): number {
  return (
    numberFromMetadata(rule?.metadata?.public_rate_usd_per_minute) ??
    DEFAULT_PUBLIC_RATE_USD_PER_MINUTE
  );
}

function minimumUsdMicros(
  rule: Awaited<ReturnType<typeof getReelCaptionPricing>>,
): number {
  return (
    Number(rule?.minimum_charge_usd_micros) ||
    DEFAULT_MINIMUM_CHARGE_USD_MICROS
  );
}

function numberFromMetadata(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

async function markJobFailed(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  jobId: string,
  error: string,
) {
  await admin
    .from("generation_jobs")
    .update({
      status: "failed",
      error,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function releaseReservation(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  jobId: string,
  error: string,
) {
  const { error: releaseError } = await admin.rpc(
    "release_balance_reservation",
    {
      p_job_id: jobId,
      p_status: "failed",
      p_error: error,
      p_metadata: { reason: error },
    },
  );

  if (releaseError) {
    console.error("Failed to release caption reservation", releaseError);
  }
}

async function markInputAssetDeleted(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  assetId: string,
  jobId: string,
  reason: string,
) {
  const deletedAt = new Date().toISOString();
  const { error } = await admin
    .from("media_assets")
    .update({
      status: "deleted",
      deleted_at: deletedAt,
      metadata: {
        deleted_at: deletedAt,
        deletion_reason: reason,
        caption_job_id: jobId,
      },
    })
    .eq("id", assetId);

  if (error) {
    console.error("Failed to mark caption input asset deleted", error);
  }
}
