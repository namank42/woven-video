import { getMediaModel } from "@/lib/media/model-registry";
import type { MediaProviderAdapter, ProviderOutput } from "@/lib/media/provider";
import { chargeMediaUsdMicros } from "@/lib/media/pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ClaimedMediaJobRow = {
  id?: unknown;
  user_id?: unknown;
  input?: unknown;
  provider_job_id?: unknown;
  claim_token?: unknown;
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

  const result = await runProviderAdapter({
    adapter,
    model,
    parameters: objectValue(job.input.parameters),
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

  if (hasUnpersistedInlineOutputs(result.outputs)) {
    const status = await releaseJob(admin, job, "provider_output_not_persisted");
    return { claimed: true, jobId: job.id, status };
  }

  const charge = chargeMediaUsdMicros({ model, rawCostUsd: result.rawCostUsd });
  const providerMetadata = safeMetadata(result.metadata);
  const outputPayload = {
    media_model_id: model.id,
    outputs: materializeOutputs(job.userId, job.id, result.outputs),
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
      return { claimed: true, jobId: job.id, status: "stale_claim" };
    }

    throw new Error(settleError.message);
  }

  return { claimed: true, jobId: job.id, status: "succeeded" };
}

export function materializeOutputs(
  userId: string,
  jobId: string,
  outputs: ProviderOutput[],
) {
  return outputs.map((output, index) => {
    const base = {
      id: `out_${index + 1}`,
      type: output.type,
      content_type: output.contentType,
      user_id: userId,
      job_id: jobId,
    };

    if (output.data) {
      return {
        ...base,
        source: "inline_data",
        byte_length: output.data.byteLength,
      };
    }

    return {
      ...base,
      source_url: output.url,
    };
  });
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
    providerJobId: stringValue(job.provider_job_id),
    claimToken: stringValue(job.claim_token),
  };
}

async function runProviderAdapter({
  adapter,
  model,
  parameters,
  providerJobId,
  signal,
}: {
  adapter: MediaProviderAdapter;
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
  parameters: Record<string, unknown>;
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
      inputUrls: [],
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
    | "provider_failed"
    | "provider_not_configured"
    | "provider_output_not_persisted",
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

function isStaleClaimError(error: { message?: string }) {
  return error.message === "media_job_stale_claim";
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

function hasUnpersistedInlineOutputs(outputs: ProviderOutput[]) {
  return outputs.some((output) => output.data && !isDurableOutputUrl(output.url));
}

function isDurableOutputUrl(url: string | undefined) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
