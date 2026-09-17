import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { getMediaEnv } from "@/lib/media/env";
import { extensionFor } from "@/lib/media/storage-keys";
import { signMediaToken } from "@/lib/media/tokens";
import { transcribeWithElevenLabs } from "@/lib/reel-captions/elevenlabs";
import {
  chargeUsdMicrosForDuration,
  getReelCaptionPricing,
  markupUsdMicros,
  providerRawCostUsdForDuration,
  REEL_CAPTION_JOB_TYPE,
  REEL_CAPTION_OPERATION,
} from "@/lib/reel-captions/pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

type CaptionJob = {
  id: string;
  user_id: string;
  provider: string;
  model: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  reserved_amount_usd_micros: number | string;
};

type CaptionInputAsset = {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  content_type: string | null;
  size_bytes: number | string | null;
  storage_key: string | null;
};

type CaptionFailureStage =
  | "gate"
  | "pricing"
  | "download"
  | "transcribe"
  | "empty_result"
  | "settle";

const CAPTION_FAILURE_CODES: Record<CaptionFailureStage, string> = {
  gate: "caption_audio_empty",
  pricing: "caption_pricing_unavailable",
  download: "caption_download_failed",
  transcribe: "caption_transcribe_failed",
  empty_result: "caption_transcribe_empty_result",
  settle: "caption_settle_failed",
};

// Below ~8 kbps effective, no speech audio survives: our own extraction emits
// 128k CBR, and even 32k voice memos clear this floor with margin.
const EMPTY_AUDIO_MIN_EFFECTIVE_BPS = 8_000;

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const { jobId } = await context.params;
  if (!isUuid(jobId)) {
    return apiError("Invalid media input.", 400, "invalid_media_input");
  }

  const admin = createSupabaseAdminClient();
  let job: CaptionJob | null;
  try {
    job = await loadJob(admin, jobId, authResult.auth.user.id);
  } catch (error) {
    console.error("Failed to load caption job for processing", error);
    return apiError("Unable to load caption job.", 500, "caption_job_lookup_failed");
  }

  if (!job) {
    return apiError("Caption job not found.", 404, "caption_job_not_found");
  }

  if (job.status === "succeeded") {
    return Response.json(job.output ?? {}, {
      headers: { "cache-control": "no-store" },
    });
  }

  if (job.status === "running") {
    return apiError(
      "Caption job is already running.",
      409,
      "caption_job_running",
    );
  }

  if (job.status !== "queued") {
    return apiError(
      "Caption job is no longer processable.",
      409,
      "caption_job_finalized",
    );
  }

  const input = job.input ?? {};
  const mediaAssetId =
    typeof input.media_asset_id === "string" ? input.media_asset_id : "";
  const durationSeconds = Number(input.duration_seconds);

  if (
    !isUuid(mediaAssetId) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    await releaseReservation(admin, job.id, "Caption job is missing upload metadata.");
    return apiError(
      "Caption job is missing upload metadata.",
      500,
      "caption_job_invalid",
    );
  }

  let asset: CaptionInputAsset | null;
  try {
    asset = await loadInputAsset(admin, mediaAssetId, job.user_id);
  } catch (error) {
    console.error("Failed to load caption input asset", error);
    return apiError("Unable to load caption upload.", 500, "caption_asset_lookup_failed");
  }
  if (!isAssetReadyForCaptioning(asset)) {
    return apiError(
      "Voiceover upload is not ready yet.",
      409,
      "caption_upload_not_ready",
    );
  }

  let claim: boolean;
  try {
    claim = await claimQueuedJob(admin, job.id);
  } catch (error) {
    console.error("Failed to claim caption job", error);
    return apiError("Unable to claim caption job.", 500, "caption_job_claim_failed");
  }
  if (!claim) {
    return apiError(
      "Caption job is already running.",
      409,
      "caption_job_running",
    );
  }

  const assetSizeBytes = parseSizeBytes(asset.size_bytes);
  const gateTrip = emptyAudioGateTrip({
    contentType: asset.content_type,
    sizeBytes: assetSizeBytes,
    durationSeconds,
  });
  if (gateTrip) {
    await releaseReservation(admin, job.id, CAPTION_FAILURE_CODES.gate);
    await recordFailureOutput({
      admin,
      jobId: job.id,
      stage: "gate",
      providerStatus: null,
      sizeBytes: assetSizeBytes,
      durationSeconds,
    });
    await markInputAssetCleanupClaimable(admin, asset.id, job.id, "caption_job_failed");
    return apiError(
      "Caption audio is empty. Check the source file and try again.",
      400,
      CAPTION_FAILURE_CODES.gate,
    );
  }

  let failureStage: Exclude<CaptionFailureStage, "gate"> = "pricing";
  try {
    const rule = await getReelCaptionPricing();
    if (!rule) {
      throw new Error("caption_generation_not_enabled");
    }

    failureStage = "download";
    const signedAudioUrl = await signedMediaDownloadUrl({
      asset,
      jobId: job.id,
      userId: job.user_id,
    });
    failureStage = "transcribe";
    const transcription = await transcribeWithElevenLabs({
      cloudStorageUrl: signedAudioUrl,
      signal: request.signal,
    });

    failureStage = "empty_result";
    if (transcription.captions.length === 0) {
      throw new Error("No caption tokens were returned for this voiceover.");
    }
    failureStage = "settle";

    const chargedAmountUsdMicros = chargeUsdMicrosForDuration(
      durationSeconds,
      rule,
    );
    const rawProviderCost = providerRawCostUsdForDuration(
      durationSeconds,
      rule,
    );
    const markupAmountUsdMicros = markupUsdMicros({
      chargedAmountUsdMicros,
      rawProviderCostUsd: rawProviderCost,
    });
    const output = {
      id: job.id,
      status: "succeeded",
      captions: transcription.captions,
      text: transcription.text,
      languageCode: transcription.languageCode,
      languageProbability: transcription.languageProbability,
      chargedAmountUsdMicros,
    };

    const usageEvent = {
      user_id: authResult.auth.user.id,
      job_id: job.id,
      provider: rule.provider,
      model: rule.model,
      operation: REEL_CAPTION_OPERATION,
      input_units: Math.ceil(durationSeconds),
      output_units: transcription.captions.length,
      raw_provider_cost: rawProviderCost,
      charged_amount_usd_micros: chargedAmountUsdMicros,
      markup_amount_usd_micros: markupAmountUsdMicros,
      metadata: {
        duration_seconds: durationSeconds,
        language_code: transcription.languageCode,
        language_probability: transcription.languageProbability,
        caption_count: transcription.captions.length,
      },
    };

    const { error: settleError } = await admin.rpc(
      "record_and_settle_reel_caption_job",
      {
        p_job_id: job.id,
        p_final_cost_usd_micros: chargedAmountUsdMicros,
        p_output: output,
        p_metadata: {
          duration_seconds: durationSeconds,
          raw_provider_cost: rawProviderCost,
          charged_amount_usd_micros: chargedAmountUsdMicros,
          caption_count: transcription.captions.length,
        },
        p_usage_event: usageEvent,
      },
    );

    if (settleError) {
      throw new Error(settleError.message);
    }

    await markInputAssetCleanupClaimable(admin, asset.id, job.id, "caption_job_succeeded");
    return Response.json(output, {
      headers: {
        "x-woven-job-id": job.id,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const code = CAPTION_FAILURE_CODES[failureStage];
    console.error("Caption generation failed", { jobId: job.id }, err);
    await releaseReservation(admin, job.id, code);
    await recordFailureOutput({
      admin,
      jobId: job.id,
      stage: failureStage,
      providerStatus:
        failureStage === "transcribe" ? providerStatusOf(err) : null,
      sizeBytes: assetSizeBytes,
      durationSeconds,
    });
    await markInputAssetCleanupClaimable(admin, asset.id, job.id, "caption_job_failed");
    return apiError(
      "Caption generation failed. Try again later.",
      502,
      "caption_generation_failed",
    );
  }
}

function parseSizeBytes(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const size = typeof value === "number" ? value : Number(value);
  return Number.isInteger(size) && size >= 0 ? size : null;
}

function effectiveBps(
  sizeBytes: number | null,
  durationSeconds: number,
): number | null {
  if (sizeBytes === null || sizeBytes <= 0) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return Math.floor((sizeBytes * 8) / durationSeconds);
}

function emptyAudioGateTrip({
  contentType,
  sizeBytes,
  durationSeconds,
}: {
  contentType: string;
  sizeBytes: number | null;
  durationSeconds: number;
}): boolean {
  const normalized = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (extensionFor("", normalized) !== ".m4a") return false;
  const bps = effectiveBps(sizeBytes, durationSeconds);
  if (bps === null) return false;
  return bps < EMPTY_AUDIO_MIN_EFFECTIVE_BPS;
}

function providerStatusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status)
    ? status
    : null;
}

async function recordFailureOutput({
  admin,
  jobId,
  stage,
  providerStatus,
  sizeBytes,
  durationSeconds,
}: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  jobId: string;
  stage: CaptionFailureStage;
  providerStatus: number | null;
  sizeBytes: number | null;
  durationSeconds: number;
}): Promise<void> {
  try {
    const { error } = await admin
      .from("generation_jobs")
      .update({
        output: {
          failure_stage: stage,
          provider_status: providerStatus,
          declared_duration_s:
            Number.isFinite(durationSeconds) && durationSeconds > 0
              ? durationSeconds
              : null,
          received_bytes: sizeBytes,
          effective_bps: effectiveBps(sizeBytes, durationSeconds),
        },
      })
      .eq("id", jobId);
    if (error) {
      console.error("Failed to record caption failure output", error);
    }
  } catch (error) {
    console.error("Failed to record caption failure output", error);
  }
}

async function loadJob(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  jobId: string,
  userId: string,
): Promise<CaptionJob | null> {
  const { data, error } = await admin
    .from("generation_jobs")
    .select(
      "id, user_id, provider, model, status, input, output, reserved_amount_usd_micros",
    )
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("type", REEL_CAPTION_JOB_TYPE)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as CaptionJob | null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function claimQueuedJob(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("generation_jobs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .eq("type", REEL_CAPTION_JOB_TYPE)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data?.id);
}

async function loadInputAsset(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  assetId: string,
  userId: string,
): Promise<CaptionInputAsset | null> {
  const { data, error } = await admin
    .from("media_assets")
    .select("id, user_id, kind, status, content_type, size_bytes, storage_key")
    .eq("id", assetId)
    .eq("user_id", userId)
    .eq("kind", "input")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as CaptionInputAsset | null;
}

function isAssetReadyForCaptioning(
  asset: CaptionInputAsset | null,
): asset is CaptionInputAsset & { content_type: string; storage_key: string } {
  return Boolean(
    asset &&
      asset.kind === "input" &&
      (asset.status === "uploaded" || asset.status === "attached") &&
      asset.content_type &&
      asset.storage_key,
  );
}

async function signedMediaDownloadUrl({
  asset,
  jobId,
  userId,
}: {
  asset: CaptionInputAsset & { storage_key: string };
  jobId: string;
  userId: string;
}): Promise<string> {
  const env = getMediaEnv();
  const exp = Math.floor(Date.now() / 1000) + env.downloadUrlTtlSeconds;
  const token = await signMediaToken(
    {
      kind: "download",
      sub: userId,
      key: asset.storage_key,
      assetId: asset.id,
      jobId,
      exp,
    },
    env.tokenSecret,
  );

  return `${env.baseUrl}/objects/${asset.id}?token=${encodeURIComponent(token)}`;
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

async function markInputAssetCleanupClaimable(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  assetId: string,
  jobId: string,
  reason: string,
) {
  const { error } = await admin
    .from("media_assets")
    .update({
      status: "attached",
      job_id: jobId,
      metadata: {
        deletion_reason: reason,
        caption_job_id: jobId,
      },
    })
    .eq("id", assetId);

  if (error) {
    console.error("Failed to mark caption input asset cleanup-claimable", error);
  }
}
