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

const CLAIM_LEASE_SECONDS = 300;
const SECRET_METADATA_KEY = /(?:api[_-]?key|authorization|bearer|password|secret|token)/i;

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

  if (!(await touchClaimLease(admin, job))) {
    return { claimed: true, jobId: job.id, status: "stale_claim" };
  }

  const charge = chargeMediaUsdMicros({ model, rawCostUsd: result.rawCostUsd });
  const providerMetadata = safeMetadata(result.metadata);
  const outputPayload = {
    media_model_id: model.id,
    outputs: materializeOutputs(job.userId, job.id, result.outputs),
    provider_metadata: providerMetadata,
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
  };

  const { error: usageError } = await admin.from("usage_events").insert({
    user_id: job.userId,
    job_id: job.id,
    provider: model.provider,
    model: model.providerModel,
    operation: model.operation,
    raw_provider_cost: rawProviderCostNumber(result.rawCostUsd),
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
    markup_amount_usd_micros: charge.markupAmountUsdMicros,
    metadata: providerMetadata,
  });

  if (usageError) {
    throw new Error(usageError.message);
  }

  const { error: settleError } = await admin.rpc("settle_balance_reservation", {
    p_job_id: job.id,
    p_final_cost_usd_micros: charge.chargedAmountUsdMicros,
    p_output: outputPayload,
    p_metadata: outputPayload,
  });

  if (settleError) {
    throw new Error(settleError.message);
  }

  return { claimed: true, jobId: job.id, status: "succeeded" };
}

export function materializeOutputs(
  userId: string,
  jobId: string,
  outputs: ProviderOutput[],
) {
  return outputs.map((output, index) => ({
    id: `out_${index + 1}`,
    type: output.type,
    content_type: output.contentType,
    source_url: output.url,
    user_id: userId,
    job_id: jobId,
  }));
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
  try {
    return await adapter.run({
      model,
      parameters,
      inputUrls: [],
      providerJobId,
      signal,
    });
  } catch {
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
  let updateQuery = admin
    .from("generation_jobs")
    .update({
      status: "waiting_provider",
      provider_job_id: providerJobId,
      progress: PROVIDER_WAIT_PROGRESS,
    })
    .eq("id", jobId);

  if (claimToken) {
    updateQuery = updateQuery.eq("claim_token", claimToken);
  }

  const { data, error } = await updateQuery.select("id");
  if (error) {
    throw new Error(error.message);
  }

  return updatedRowCount(data) > 0;
}

async function releaseJob(
  admin: SupabaseAdminClient,
  job: { id: string; claimToken: string | null },
  reason: "model_not_enabled" | "provider_failed" | "provider_not_configured",
) {
  if (!(await touchClaimLease(admin, job))) {
    return "stale_claim";
  }

  const { error } = await admin.rpc("release_balance_reservation", {
    p_job_id: job.id,
    p_status: "failed",
    p_error: reason,
    p_metadata: { reason },
  });

  if (error) {
    throw new Error(error.message);
  }

  return "failed";
}

async function touchClaimLease(
  admin: SupabaseAdminClient,
  job: { id: string; claimToken: string | null },
) {
  if (!job.claimToken) {
    return true;
  }

  const claimExpiresAt = new Date(Date.now() + CLAIM_LEASE_SECONDS * 1000).toISOString();
  const { data, error } = await admin
    .from("generation_jobs")
    .update({ claim_expires_at: claimExpiresAt })
    .eq("id", job.id)
    .eq("claim_token", job.claimToken)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  return updatedRowCount(data) > 0;
}

function updatedRowCount(data: unknown) {
  if (Array.isArray(data)) {
    return data.length;
  }

  return data ? 1 : 0;
}

function rawProviderCostNumber(rawCostUsd: number | string) {
  const rawCost = Number(rawCostUsd);
  return Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
}

function safeMetadata(metadata: Record<string, unknown> | undefined) {
  return sanitizeRecord(metadata ?? {}, new WeakSet(), 0);
}

function sanitizeRecord(
  value: Record<string, unknown>,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  if (seen.has(value)) {
    return {};
  }

  seen.add(value);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_METADATA_KEY.test(key))
      .map(([key, item]) => [key, sanitizeMetadataValue(item, seen, depth + 1)])
      .filter(([, item]) => item !== undefined),
  );
}

function sanitizeMetadataValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > 5) {
    return "[truncated]";
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeMetadataValue(item, seen, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (isRecord(value)) {
    return sanitizeRecord(value, seen, depth);
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
