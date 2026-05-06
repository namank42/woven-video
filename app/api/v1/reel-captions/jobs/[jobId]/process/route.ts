import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { transcribeWithElevenLabs } from "@/lib/reel-captions/elevenlabs";
import {
  chargeUsdMicrosForDuration,
  getReelCaptionPricing,
  markupUsdMicros,
  providerRawCostUsdForDuration,
  REEL_CAPTION_BUCKET,
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

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const { jobId } = await context.params;
  const admin = createSupabaseAdminClient();
  const job = await loadJob(admin, jobId, authResult.auth.user.id);

  if (!job) {
    return apiError("Caption job not found.", 404, "caption_job_not_found");
  }

  if (job.status === "succeeded") {
    return Response.json(job.output ?? {}, {
      headers: { "cache-control": "no-store" },
    });
  }

  if (job.status === "failed" || job.status === "cancelled") {
    return apiError(
      "Caption job is no longer processable.",
      409,
      "caption_job_finalized",
    );
  }

  const input = job.input ?? {};
  const storageBucket =
    typeof input.storage_bucket === "string"
      ? input.storage_bucket
      : REEL_CAPTION_BUCKET;
  const storagePath =
    typeof input.storage_path === "string" ? input.storage_path : "";
  const filename =
    typeof input.filename === "string" ? input.filename : "voiceover.wav";
  const durationSeconds = Number(input.duration_seconds);

  if (!storagePath || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    await releaseReservation(admin, job.id, "Caption job is missing upload metadata.");
    return apiError(
      "Caption job is missing upload metadata.",
      500,
      "caption_job_invalid",
    );
  }

  const { data: uploadExists, error: existsError } = await admin.storage
    .from(storageBucket)
    .exists(storagePath);

  if (existsError || !uploadExists) {
    return apiError(
      "Voiceover upload is not ready yet.",
      409,
      "caption_upload_not_ready",
    );
  }

  const { data: signedAudio, error: signedAudioError } = await admin.storage
    .from(storageBucket)
    .createSignedUrl(storagePath, 10 * 60);

  if (signedAudioError || !signedAudio?.signedUrl) {
    return apiError(
      signedAudioError?.message ?? "Unable to create signed audio URL.",
      409,
      "caption_upload_not_ready",
    );
  }

  await admin
    .from("generation_jobs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .in("status", ["queued", "running"]);

  const rule = await getReelCaptionPricing();
  if (!rule) {
    await releaseReservation(admin, job.id, "Auto captions pricing rule is not enabled.");
    await removeUpload(admin, storageBucket, storagePath);
    return apiError(
      "Auto captions pricing rule is not enabled.",
      503,
      "caption_generation_not_enabled",
    );
  }

  try {
    const transcription = isLocalSignedUrl(signedAudio.signedUrl)
      ? await transcribeLocalUpload({
          bucket: storageBucket,
          path: storagePath,
          filename,
          signal: request.signal,
        })
      : await transcribeWithElevenLabs({
          cloudStorageUrl: signedAudio.signedUrl,
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

    const { error: usageError } = await admin.from("usage_events").insert({
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
    });

    if (usageError) {
      throw new Error(usageError.message);
    }

    const { error: settleError } = await admin.rpc(
      "settle_balance_reservation",
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
      },
    );

    if (settleError) {
      throw new Error(settleError.message);
    }

    await removeUpload(admin, storageBucket, storagePath);
    return Response.json(output, {
      headers: {
        "x-woven-job-id": job.id,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await releaseReservation(admin, job.id, message);
    await removeUpload(admin, storageBucket, storagePath);
    return apiError(message, 502, "caption_generation_failed");
  }
}

async function transcribeLocalUpload({
  bucket,
  path,
  filename,
  signal,
}: {
  bucket: string;
  path: string;
  filename: string;
  signal: AbortSignal;
}) {
  const admin = createSupabaseAdminClient();
  const { data: audio, error } = await admin.storage.from(bucket).download(path);
  if (error || !audio) {
    throw new Error(error?.message ?? "Unable to download uploaded voiceover.");
  }
  return transcribeWithElevenLabs({ audio, filename, signal });
}

function isLocalSignedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
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

async function removeUpload(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  bucket: string,
  path: string,
) {
  if (!bucket || !path) return;
  const { error } = await admin.storage.from(bucket).remove([path]);
  if (error) {
    console.error("Failed to remove caption upload", error);
  }
}
