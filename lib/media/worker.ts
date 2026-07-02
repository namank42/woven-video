import { getMediaModel } from "@/lib/media/model-registry";
import {
  createOutputAssetRows,
  failOutputAssetRowsForAttempt,
} from "@/lib/media/output-assets";
import type { MediaProviderAdapter, ProviderOutput } from "@/lib/media/provider";
import { chargeMediaUsdMicros } from "@/lib/media/pricing";
import { getMediaEnv } from "@/lib/media/env";
import { signMediaToken } from "@/lib/media/tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ClaimedMediaJobRow = {
  id?: unknown;
  user_id?: unknown;
  input?: unknown;
  provider_job_id?: unknown;
  claim_token?: unknown;
};
type MediaInputAssetRow = {
  id: string;
  storage_key: string;
};
type DrainOneMediaJobResult =
  | { claimed: false }
  | { claimed: true; jobId: string; status: "failed" | "stale_claim" | "succeeded" | "waiting_provider" };

const PROVIDER_WAIT_PROGRESS = {
  stage: "provider_wait",
  percent: null,
  message: "Waiting on provider",
};

const SAFE_PROVIDER_METADATA_KEYS = new Set([
  "byte_length",
  "duration_seconds",
  "endpoint",
  "fal_request_id",
  "fal_status",
  "output_format",
  "provider_request_id",
  "request_id",
  "status",
]);
const SECRET_METADATA_VALUE = /(?:authorization:\s*bearer|bearer\s+[a-z0-9._~+/=-]+|api[_-]?key|secret|token\s*[:=])/i;

export async function drainOneMediaJob({
  adapters,
  signal,
}: {
  adapters: Record<string, MediaProviderAdapter>;
  signal?: AbortSignal;
}): Promise<DrainOneMediaJobResult> {
  const admin = createSupabaseAdminClient();
  const { data: jobs, error } = await admin.rpc("claim_media_jobs", {
    p_limit: 1,
    p_lease_seconds: 300,
  });

  if (error) {
    throw new Error(error.message);
  }

  const claimedJob = Array.isArray(jobs) ? jobs[0] as ClaimedMediaJobRow | undefined : undefined;
  if (!claimedJob) {
    return { claimed: false };
  }

  const job = normalizeClaimedJob(claimedJob);
  const model = job.mediaModelId ? await getMediaModel(job.mediaModelId) : null;
  if (!model) {
    const status = await releaseJob(admin, job, "model_not_enabled");
    return { claimed: true, jobId: job.id, status };
  }

  const adapter = adapters[model.provider];
  if (!adapter) {
    const status = await releaseJob(admin, job, "provider_not_configured");
    return { claimed: true, jobId: job.id, status };
  }

  let inputUrls: string[];
  try {
    inputUrls = job.providerJobId
      ? []
      : await signedInputAssetUrls({ admin, job });
  } catch (error) {
    if (isStaleClaimError(error)) {
      return { claimed: true, jobId: job.id, status: "stale_claim" };
    }

    const status = await releaseJob(admin, job, "media_input_unavailable");
    return { claimed: true, jobId: job.id, status };
  }

  const result = await runProviderAdapter({
    adapter,
    model,
    parameters: objectValue(job.input.parameters),
    inputUrls,
    providerJobId: job.providerJobId,
    signal,
  });

  if (signal?.aborted) {
    throw abortReason(signal);
  }

  if (result.status === "provider_failed") {
    const status = await releaseJob(admin, job, "provider_failed");
    return { claimed: true, jobId: job.id, status };
  }

  if (result.status === "waiting_provider") {
    const updated = await updateWaitingProviderJob({
      admin,
      jobId: job.id,
      claimToken: job.claimToken,
      providerJobId: result.providerJobId,
    });

    return {
      claimed: true,
      jobId: job.id,
      status: updated ? "waiting_provider" : "stale_claim",
    };
  }

  if (!job.claimToken) {
    return { claimed: true, jobId: job.id, status: "stale_claim" };
  }

  const charge = chargeMediaUsdMicros({ model, rawCostUsd: result.rawCostUsd });
  const providerMetadata = safeMetadata(result.metadata);
  let materializedOutputs;
  try {
    materializedOutputs = await materializeOutputs(job.userId, job.id, job.claimToken, result.outputs);
  } catch (error) {
    if (isStaleClaimError(error)) {
      return { claimed: true, jobId: job.id, status: "stale_claim" };
    }

    const status = await releaseJob(admin, job, "media_output_materialization_failed");
    return { claimed: true, jobId: job.id, status };
  }

  const outputPayload = {
    media_model_id: model.id,
    outputs: materializedOutputs.outputs,
    provider_metadata: providerMetadata,
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
  };

  const usageEvent = {
    user_id: job.userId,
    job_id: job.id,
    provider: model.provider,
    model: model.providerModel,
    operation: model.operation,
    raw_provider_cost: rawProviderCostNumber(result.rawCostUsd),
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
    markup_amount_usd_micros: charge.markupAmountUsdMicros,
    metadata: providerMetadata,
  };

  const { error: settleError } = await admin.rpc("record_and_settle_claimed_media_job", {
    p_job_id: job.id,
    p_claim_token: job.claimToken,
    p_final_cost_usd_micros: charge.chargedAmountUsdMicros,
    p_output: outputPayload,
    p_metadata: outputPayload,
    p_usage_event: usageEvent,
  });

  if (settleError) {
    if (isStaleClaimError(settleError)) {
      try {
        await failOutputAssetRowsForAttempt({
          userId: job.userId,
          jobId: job.id,
          attemptAssets: materializedOutputs.attemptAssets,
          reason: "media_output_materialization_failed",
        });
      } catch (error) {
        if (!isStaleClaimError(error)) {
          throw error;
        }
      }
      return { claimed: true, jobId: job.id, status: "stale_claim" };
    }

    throw new Error(settleError.message);
  }

  return { claimed: true, jobId: job.id, status: "succeeded" };
}

export function materializeOutputs(
  userId: string,
  jobId: string,
  claimToken: string,
  outputs: ProviderOutput[],
) {
  return createOutputAssetRows({ userId, jobId, claimToken, outputs });
}

function normalizeClaimedJob(job: ClaimedMediaJobRow) {
  const id = stringValue(job.id);
  const userId = stringValue(job.user_id);
  if (!id || !userId) {
    throw new Error("claim_media_jobs_returned_invalid_job");
  }

  const input = objectValue(job.input);
  return {
    id,
    userId,
    input,
    mediaModelId: stringValue(input.media_model_id),
    inputAssetIds: stringArrayValue(input.input_asset_ids),
    providerJobId: stringValue(job.provider_job_id),
    claimToken: stringValue(job.claim_token),
  };
}

async function runProviderAdapter({
  adapter,
  model,
  parameters,
  inputUrls,
  providerJobId,
  signal,
}: {
  adapter: MediaProviderAdapter;
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
  parameters: Record<string, unknown>;
  inputUrls: string[];
  providerJobId: string | null;
  signal?: AbortSignal;
}) {
  if (signal?.aborted) {
    throw abortReason(signal);
  }

  try {
    return await adapter.run({
      model,
      parameters,
      inputUrls,
      providerJobId,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw abortReason(signal);
    }

    if (isAbortError(error) || isProviderNotConfiguredError(error)) {
      throw error;
    }

    return { status: "provider_failed" as const };
  }
}

async function signedInputAssetUrls({
  admin,
  job,
}: {
  admin: SupabaseAdminClient;
  job: {
    id: string;
    userId: string;
    inputAssetIds: string[];
  };
}): Promise<string[]> {
  if (job.inputAssetIds.length === 0) {
    return [];
  }

  const { data, error } = await admin
    .from("media_assets")
    .select("id, storage_key")
    .eq("user_id", job.userId)
    .eq("job_id", job.id)
    .eq("kind", "input")
    .eq("status", "attached")
    .in("id", job.inputAssetIds);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as MediaInputAssetRow[];
  if (rows.length !== job.inputAssetIds.length) {
    throw new Error("media_input_unavailable");
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const env = getMediaEnv();
  const exp = Math.floor(Date.now() / 1000) + env.downloadUrlTtlSeconds;

  return Promise.all(job.inputAssetIds.map(async (assetId) => {
    const asset = byId.get(assetId);
    if (!asset?.storage_key) {
      throw new Error("media_input_unavailable");
    }

    const token = await signMediaToken({
      kind: "download",
      sub: job.userId,
      key: asset.storage_key,
      assetId,
      jobId: job.id,
      exp,
    }, env.tokenSecret);

    return `${env.baseUrl}/objects/${assetId}?token=${encodeURIComponent(token)}`;
  }));
}

async function updateWaitingProviderJob({
  admin,
  jobId,
  claimToken,
  providerJobId,
}: {
  admin: SupabaseAdminClient;
  jobId: string;
  claimToken: string | null;
  providerJobId: string;
}) {
  if (!claimToken) {
    return false;
  }

  const { error } = await admin.rpc("mark_media_job_waiting_provider", {
    p_job_id: jobId,
    p_claim_token: claimToken,
    p_provider_job_id: providerJobId,
    p_progress: PROVIDER_WAIT_PROGRESS,
  });

  if (error) {
    if (isStaleClaimError(error)) {
      return false;
    }

    throw new Error(error.message);
  }

  return true;
}

async function releaseJob(
  admin: SupabaseAdminClient,
  job: { id: string; claimToken: string | null },
  reason:
    | "model_not_enabled"
    | "media_input_unavailable"
    | "media_output_materialization_failed"
    | "provider_failed"
    | "provider_not_configured",
) {
  if (!job.claimToken) {
    return "stale_claim";
  }

  const { error } = await admin.rpc("release_claimed_media_job", {
    p_job_id: job.id,
    p_claim_token: job.claimToken,
    p_status: "failed",
    p_error: reason,
    p_metadata: { reason },
  });

  if (error) {
    if (isStaleClaimError(error)) {
      return "stale_claim";
    }

    throw new Error(error.message);
  }

  return "failed";
}

function isStaleClaimError(error: unknown) {
  return isRecord(error) && error.message === "media_job_stale_claim";
}

function isAbortError(error: unknown) {
  return isRecord(error) && error.name === "AbortError";
}

function isProviderNotConfiguredError(error: unknown) {
  return error instanceof Error && error.message === "provider_not_configured";
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

function rawProviderCostNumber(rawCostUsd: number | string) {
  const rawCost = Number(rawCostUsd);
  return Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
}

function safeMetadata(metadata: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(metadata ?? {})
      .filter(([key]) => SAFE_PROVIDER_METADATA_KEYS.has(key))
      .map(([key, value]) => [key, safeMetadataPrimitive(value)])
      .filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined),
  );
}

function safeMetadataPrimitive(value: unknown) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return SECRET_METADATA_VALUE.test(value) ? undefined : value;
  }

  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
