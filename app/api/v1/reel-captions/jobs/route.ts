import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import {
  chargeUsdMicrosForDuration,
  getReelCaptionPricing,
  MAX_REEL_CAPTION_DURATION_SECONDS,
  REEL_CAPTION_BUCKET,
  REEL_CAPTION_JOB_TYPE,
} from "@/lib/reel-captions/pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CreateCaptionJobBody = {
  durationSeconds?: unknown;
  filename?: unknown;
  contentType?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const payload = await request.json().catch(() => null);
  if (!isObject(payload)) {
    return apiError("Request body must be a JSON object.");
  }

  const { durationSeconds, filename, contentType } =
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
        storage_bucket: REEL_CAPTION_BUCKET,
      },
    })
    .select("id")
    .single();

  if (jobError || !job?.id) {
    return apiError(
      jobError?.message ?? "Unable to create caption job.",
      500,
      "caption_job_create_failed",
    );
  }

  const jobId = String(job.id);
  const storagePath = `${authResult.auth.user.id}/reel-captions/${jobId}/${uploadFilename(originalFilename, uploadContentType)}`;

  const { error: updateError } = await admin
    .from("generation_jobs")
    .update({
      input: {
        duration_seconds: duration,
        filename: originalFilename,
        content_type: uploadContentType,
        storage_bucket: REEL_CAPTION_BUCKET,
        storage_path: storagePath,
      },
    })
    .eq("id", jobId);

  if (updateError) {
    await markJobFailed(admin, jobId, updateError.message);
    return apiError(
      updateError.message,
      500,
      "caption_job_update_failed",
    );
  }

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
    await markJobFailed(admin, jobId, reserveError.message);
    const insufficient = reserveError.message === "insufficient_balance";
    return apiError(
      insufficient
        ? "Insufficient balance. Add funds before generating captions."
        : reserveError.message,
      insufficient ? 402 : 500,
      insufficient ? "insufficient_balance" : "caption_reservation_failed",
    );
  }

  const { data: signedUpload, error: signedUploadError } =
    await admin.storage
      .from(REEL_CAPTION_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });

  if (signedUploadError || !signedUpload?.signedUrl || !signedUpload.token) {
    await releaseReservation(
      admin,
      jobId,
      signedUploadError?.message ?? "Unable to create upload URL.",
    );
    return apiError(
      signedUploadError?.message ?? "Unable to create upload URL.",
      500,
      "caption_upload_url_failed",
    );
  }

  return Response.json(
    {
      id: jobId,
      status: "queued",
      upload: {
        bucket: REEL_CAPTION_BUCKET,
        path: storagePath,
        signedUrl: signedUpload.signedUrl,
        token: signedUpload.token,
        expiresInSeconds: 7200,
        contentType: uploadContentType,
      },
      estimatedCostUsdMicros: amountUsdMicros,
      pricing: {
        publicRateUsdPerMinute: 0.01,
        minimumUsdMicros: rule.minimum_charge_usd_micros,
      },
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

function uploadFilename(filename: string, contentType: string): string {
  const ext = filename.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? extensionFor(contentType);
  return `voiceover${ext.toLowerCase()}`;
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "audio/mpeg":
      return ".mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return ".m4a";
    case "audio/aac":
      return ".aac";
    case "audio/flac":
      return ".flac";
    default:
      return ".wav";
  }
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
