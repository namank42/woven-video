import type { SupabaseClient } from "@supabase/supabase-js";

import { reservationUsdMicros } from "@/lib/media/pricing";
import type { MediaModel } from "@/lib/media/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type MediaAssetInputRow = {
  id: string;
  status: string;
  content_type: string;
};

type CreatedMediaJobRow = {
  id: string;
  status: string;
  estimated_cost_usd_micros: number | string;
  reserved_amount_usd_micros: number | string;
  created_at: string;
};

type SupabaseAdminClient = SupabaseClient;

export async function createReservedMediaJob({
  userId,
  model,
  parameters,
  inputAssetIds,
}: {
  userId: string;
  model: MediaModel;
  parameters: Record<string, unknown>;
  inputAssetIds: string[];
}) {
  const admin = createSupabaseAdminClient();
  const reserveAmount = reservationUsdMicros(model);

  await validateInputAssets({
    admin,
    userId,
    model,
    inputAssetIds,
  });

  const { data: job, error: jobError } = await admin
    .from("generation_jobs")
    .insert({
      user_id: userId,
      type: "media_job",
      provider: model.provider,
      model: model.providerModel,
      status: "queued",
      estimated_cost_usd_micros: reserveAmount,
      input: {
        media_model_id: model.id,
        operation: model.operation,
        parameters,
        input_asset_ids: inputAssetIds,
      },
      progress: { stage: "queued", percent: null },
    })
    .select("id, status, estimated_cost_usd_micros, reserved_amount_usd_micros, created_at")
    .single();

  if (jobError || !job?.id) {
    throw new Error(jobError?.message ?? "media_job_create_failed");
  }

  const createdJob = job as CreatedMediaJobRow;

  const { error: reserveError } = await admin.rpc("reserve_balance", {
    p_user_id: userId,
    p_job_id: createdJob.id,
    p_amount_usd_micros: reserveAmount,
    p_metadata: {
      provider: model.provider,
      model: model.providerModel,
      operation: model.operation,
      media_model_id: model.id,
    },
  });

  if (reserveError) {
    await markJobFailed(admin, createdJob.id, reserveError.message);
    throw new Error(reserveError.message);
  }

  try {
    await attachInputAssets({
      admin,
      userId,
      jobId: createdJob.id,
      inputAssetIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "media_asset_attach_failed";
    let detachError: Error | null = null;
    let releaseError: Error | null = null;

    try {
      await detachInputAssets({
        admin,
        userId,
        jobId: createdJob.id,
        inputAssetIds,
      });
    } catch (cleanupError) {
      detachError = toError(cleanupError, "media_asset_detach_failed");
    }

    try {
      await releaseReservation(admin, createdJob.id, message, "media_asset_attach_failed");
    } catch (cleanupError) {
      releaseError = toError(cleanupError, "media_reservation_release_failed");
    }

    if (releaseError) {
      throw releaseError;
    }
    if (detachError) {
      throw detachError;
    }

    throw new Error(message);
  }

  return {
    id: String(createdJob.id),
    status: "queued",
    model: model.id,
    estimatedCostUsdMicros: reserveAmount,
    reservedCreditsUsdMicros: reserveAmount,
    createdAt: String(createdJob.created_at),
  };
}

async function validateInputAssets({
  admin,
  userId,
  model,
  inputAssetIds,
}: {
  admin: SupabaseAdminClient;
  userId: string;
  model: MediaModel;
  inputAssetIds: string[];
}) {
  if (
    inputAssetIds.length === 0 &&
    model.supportsUploadedInputs &&
    model.metadata.requires_uploaded_input === true
  ) {
    throw new Error("invalid_media_input");
  }

  if (inputAssetIds.length === 0) {
    return;
  }

  const { data: assets, error: assetError } = await admin
    .from("media_assets")
    .select("id, status, content_type")
    .eq("user_id", userId)
    .in("id", inputAssetIds);

  if (assetError) {
    throw new Error(assetError.message);
  }

  const inputAssets = (assets ?? []) as MediaAssetInputRow[];
  if (inputAssets.length !== inputAssetIds.length) {
    throw new Error("invalid_media_input");
  }

  for (const asset of inputAssets) {
    if (asset.status !== "uploaded") {
      throw new Error("upload_not_complete");
    }

    const family = asset.content_type.split("/")[0];
    if (!family || !model.supportedInputTypes.includes(family)) {
      throw new Error("invalid_media_input");
    }
  }
}

async function attachInputAssets({
  admin,
  userId,
  jobId,
  inputAssetIds,
}: {
  admin: SupabaseAdminClient;
  userId: string;
  jobId: string;
  inputAssetIds: string[];
}) {
  if (inputAssetIds.length === 0) {
    return;
  }

  const { data, error } = await admin
    .from("media_assets")
    .update({ job_id: jobId, status: "attached" })
    .in("id", inputAssetIds)
    .eq("user_id", userId)
    .eq("status", "uploaded")
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  if ((data ?? []).length !== inputAssetIds.length) {
    throw new Error("media_asset_attach_failed");
  }
}

async function detachInputAssets({
  admin,
  userId,
  jobId,
  inputAssetIds,
}: {
  admin: SupabaseAdminClient;
  userId: string;
  jobId: string;
  inputAssetIds: string[];
}) {
  if (inputAssetIds.length === 0) {
    return;
  }

  const { error } = await admin
    .from("media_assets")
    .update({ job_id: null, status: "uploaded" })
    .eq("job_id", jobId)
    .eq("user_id", userId)
    .in("id", inputAssetIds)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }
}

async function markJobFailed(
  admin: SupabaseAdminClient,
  jobId: string,
  error: string,
) {
  const { error: updateError } = await admin
    .from("generation_jobs")
    .update({
      status: "failed",
      error,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (updateError) {
    console.error("Failed to mark media job failed", updateError);
  }
}

async function releaseReservation(
  admin: SupabaseAdminClient,
  jobId: string,
  error: string,
  reason: string,
) {
  const { error: releaseError } = await admin.rpc("release_balance_reservation", {
    p_job_id: jobId,
    p_status: "failed",
    p_error: error,
    p_metadata: { reason },
  });

  if (releaseError) {
    throw new Error(releaseError.message);
  }
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
