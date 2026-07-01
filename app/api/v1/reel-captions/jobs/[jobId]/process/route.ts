import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { getMediaEnv } from "@/lib/media/env";
import { signMediaToken } from "@/lib/media/tokens";
import { transcribeWithElevenLabs } from "@/lib/reel-captions/elevenlabs";
import {
  chargeUsdMicrosForDuration,
  getReelCaptionPricing,
  markupUsdMicros,
  providerRawCostUsdForDuration,
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
  storage_key: string | null;
};

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

  try {
    const rule = await getReelCaptionPricing();
    if (!rule) {
      throw new Error("caption_generation_not_enabled");
    }

    const signedAudioUrl = await signedMediaDownloadUrl({
      asset,
      jobId: job.id,
      userId: job.user_id,
    });
    const transcription = await transcribeWithElevenLabs({
      cloudStorageUrl: signedAudioUrl,
      signal: request.signal,
    });

    if (transcription.captions.length === 0) {
      throw new Error("No caption tokens were returned for this voiceover.");
    }

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

    await markInputAssetDeleted(admin, asset.id, job.id, "caption_job_succeeded");
    return Response.json(output, {
      headers: {
        "x-woven-job-id": job.id,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("Caption generation failed", { jobId: job.id }, err);
    await releaseReservation(admin, job.id, "caption_generation_failed");
    await markInputAssetDeleted(admin, asset.id, job.id, "caption_job_failed");
    return apiError(
      "Caption generation failed. Try again later.",
      502,
      "caption_generation_failed",
    );
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
    .select("id, user_id, kind, status, content_type, storage_key")
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
