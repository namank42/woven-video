import { getMediaEnv } from "@/lib/media/env";
import { claimMediaJobById, type MediaJobClaimRow } from "@/lib/media/job-claims";
import { getMediaModel } from "@/lib/media/model-registry";
import {
  createOutputAssetRows,
  failOutputAssetRowsForAttempt,
} from "@/lib/media/output-assets";
import { chargeMediaUsdMicros } from "@/lib/media/pricing";
import { deserializeMediaPricingQuote } from "@/lib/media/pricing-quotes";
import type { MediaProviderAdapter, ProviderInputAsset } from "@/lib/media/provider";
import { signMediaToken } from "@/lib/media/tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type MediaInputAssetRow = {
  id: string;
  storage_key: string;
  content_type: string;
};

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
  "provider_error_message",
  "provider_error_name",
  "provider_request_id",
  "provider_status",
  "request_id",
  "status",
]);
const SECRET_METADATA_VALUE = /(?:authorization:\s*bearer|bearer\s+[a-z0-9._~+/=-]+|api[_-]?key|secret|token\s*[:=])/i;

export type ProcessMediaJobResult =
  | { jobId: string; status: "not_claimed" }
  | { jobId: string; status: "failed" | "stale_claim" | "succeeded" | "waiting_provider" };

export async function processMediaJob({
  jobId,
  adapters,
  waitFor,
  signal,
}: {
  jobId: string;
  adapters: Record<string, MediaProviderAdapter>;
  waitFor: (delay: { seconds: number }) => Promise<void>;
  signal?: AbortSignal;
}): Promise<ProcessMediaJobResult> {
  for (;;) {
    const result = await processMediaJobStep({ jobId, adapters, signal });
    if (result.status !== "waiting_provider") {
      return result;
    }

    await waitFor({ seconds: 5 });
  }
}

async function processMediaJobStep({
  jobId,
  adapters,
  signal,
}: {
  jobId: string;
  adapters: Record<string, MediaProviderAdapter>;
  signal?: AbortSignal;
}): Promise<ProcessMediaJobResult> {
  const claimedJob = await claimMediaJobById(jobId, 300);
  if (!claimedJob) {
    return { jobId, status: "not_claimed" };
  }

  const admin = createSupabaseAdminClient();
  const job = normalizeClaimedJob(claimedJob);

  if (isExpiredJob(job.expiresAt)) {
    const status = await releaseJob(admin, job, "media_job_timed_out");
    return { jobId: job.id, status };
  }

  const model = job.mediaModelId ? await getMediaModel(job.mediaModelId) : null;
  if (!model) {
    const status = await releaseJob(admin, job, "model_not_enabled");
    return { jobId: job.id, status };
  }

  const adapter = adapters[model.provider];
  if (!adapter) {
    const status = await releaseJob(admin, job, "provider_not_configured");
    return { jobId: job.id, status };
  }

  let signedInputs: { inputUrls: string[]; inputAssets: ProviderInputAsset[] };
  try {
    signedInputs = job.providerJobId
      ? { inputUrls: [], inputAssets: [] }
      : await signedInputAssetUrls({ admin, job, model });
  } catch (error) {
    if (isStaleClaimError(error)) {
      return { jobId: job.id, status: "stale_claim" };
    }

    const status = await releaseJob(admin, job, "media_input_unavailable");
    return { jobId: job.id, status };
  }

  const result = await runProviderAdapter({
    adapter,
    model,
    parameters: objectValue(job.input.parameters),
    inputUrls: signedInputs.inputUrls,
    inputAssets: signedInputs.inputAssets,
    providerJobId: job.providerJobId,
    signal,
  });

  if (result.status === "provider_failed") {
    const status = await releaseJob(admin, job, "provider_failed", safeMetadata(result.metadata));
    return { jobId: job.id, status };
  }

  if (result.status === "waiting_provider") {
    const updated = await updateWaitingProviderJob({
      admin,
      jobId: job.id,
      claimToken: job.claimToken,
      providerJobId: result.providerJobId,
    });
    return { jobId: job.id, status: updated ? "waiting_provider" : "stale_claim" };
  }

  if (!job.claimToken) {
    return { jobId: job.id, status: "stale_claim" };
  }

  const charge = chargeMediaUsdMicros({
    model,
    rawCostUsd: result.rawCostUsd,
    pricingQuote: job.pricingQuote,
  });
  const providerMetadata = safeMetadata(result.metadata);

  let materializedOutputs;
  try {
    materializedOutputs = await createOutputAssetRows({
      userId: job.userId,
      jobId: job.id,
      claimToken: job.claimToken,
      outputs: result.outputs,
    });
  } catch (error) {
    if (isStaleClaimError(error)) {
      return { jobId: job.id, status: "stale_claim" };
    }

    const status = await releaseJob(admin, job, "media_output_materialization_failed");
    return { jobId: job.id, status };
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
      await failOutputAssetRowsForAttempt({
        userId: job.userId,
        jobId: job.id,
        attemptAssets: materializedOutputs.attemptAssets,
        reason: "media_output_materialization_failed",
      }).catch((error) => {
        if (!isStaleClaimError(error)) {
          throw error;
        }
      });
      return { jobId: job.id, status: "stale_claim" };
    }

    throw new Error(settleError.message);
  }

  return { jobId: job.id, status: "succeeded" };
}

function normalizeClaimedJob(job: MediaJobClaimRow) {
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
    inputAssets: inputAssetEntriesValue(input.input_assets),
    inputAssetIds: stringArrayValue(input.input_asset_ids),
    pricingQuote: mediaPricingQuoteValue(input.pricing_quote),
    providerJobId: stringValue(job.provider_job_id),
    claimToken: stringValue(job.claim_token),
    expiresAt: stringValue(job.expires_at),
  };
}

async function runProviderAdapter({
  adapter,
  model,
  parameters,
  inputUrls,
  inputAssets,
  providerJobId,
  signal,
}: {
  adapter: MediaProviderAdapter;
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
  parameters: Record<string, unknown>;
  inputUrls: string[];
  inputAssets: ProviderInputAsset[];
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
      inputAssets,
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

    return {
      status: "provider_failed" as const,
      metadata: providerFailureMetadata(error),
    };
  }
}

async function signedInputAssetUrls({
  admin,
  job,
  model,
}: {
  admin: SupabaseAdminClient;
  job: {
    id: string;
    userId: string;
    inputAssets: Array<{ assetId: string; role: string }>;
    inputAssetIds: string[];
  };
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
}): Promise<{ inputUrls: string[]; inputAssets: ProviderInputAsset[] }> {
  const usesStoredRoles = job.inputAssets.length > 0;
  const inferredLegacyRole = usesStoredRoles ? null : inferLegacyRole(model.inputAssetSchema, job.inputAssetIds.length);
  const requestedAssetIds = usesStoredRoles
    ? job.inputAssets.map((asset) => asset.assetId)
    : job.inputAssetIds;

  if (requestedAssetIds.length === 0) {
    return { inputUrls: [], inputAssets: [] };
  }

  const { data, error } = await admin
    .from("media_assets")
    .select("id, storage_key, content_type")
    .eq("user_id", job.userId)
    .eq("job_id", job.id)
    .eq("kind", "input")
    .eq("status", "attached")
    .in("id", requestedAssetIds);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as MediaInputAssetRow[];
  if (rows.length !== requestedAssetIds.length) {
    throw new Error("media_input_unavailable");
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const env = getMediaEnv();
  const exp = Math.floor(Date.now() / 1000) + env.downloadUrlTtlSeconds;

  const signedAssets = await Promise.all(requestedAssetIds.map(async (assetId) => {
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

    return {
      assetId,
      contentType: asset.content_type,
      url: `${env.baseUrl}/objects/${assetId}?token=${encodeURIComponent(token)}`,
    };
  }));

  if (usesStoredRoles) {
    return {
      inputUrls: signedAssets.map((asset) => asset.url),
      inputAssets: signedAssets.map((asset, index) => ({
        ...asset,
        role: job.inputAssets[index]!.role,
      })),
    };
  }

  if (!inferredLegacyRole) {
    return {
      inputUrls: signedAssets.map((asset) => asset.url),
      inputAssets: [],
    };
  }

  return {
    inputUrls: signedAssets.map((asset) => asset.url),
    inputAssets: signedAssets.map((asset) => ({
      ...asset,
      role: inferredLegacyRole,
    })),
  };
}

function inferLegacyRole(
  schema: Parameters<MediaProviderAdapter["run"]>[0]["model"]["inputAssetSchema"],
  count: number,
) {
  if (count !== 1) {
    return null;
  }

  const roles = Array.isArray(schema?.roles) ? schema.roles : [];
  if (roles.length === 0) {
    return null;
  }

  if (roles.length === 1) {
    const [role] = roles;
    if (role && role.min <= 1 && role.max === 1) {
      return role.role;
    }
  }

  return null;
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
    | "media_job_timed_out"
    | "model_not_enabled"
    | "media_input_unavailable"
    | "media_output_materialization_failed"
    | "provider_failed"
    | "provider_not_configured",
  metadata: Record<string, unknown> = {},
) {
  if (!job.claimToken) {
    return "stale_claim" as const;
  }

  const { error } = await admin.rpc("release_claimed_media_job", {
    p_job_id: job.id,
    p_claim_token: job.claimToken,
    p_status: "failed",
    p_error: reason,
    p_metadata: { reason, ...metadata },
  });

  if (error) {
    if (isStaleClaimError(error)) {
      return "stale_claim" as const;
    }

    throw new Error(error.message);
  }

  return "failed" as const;
}

function isStaleClaimError(error: unknown) {
  return isRecord(error) && error.message === "media_job_stale_claim";
}

function isExpiredJob(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }

  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
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

function providerFailureMetadata(error: unknown): Record<string, unknown> {
  const record = isRecord(error) ? error : {};
  const metadata: Record<string, unknown> = {};
  const name = error instanceof Error ? error.name : stringValue(record.name);
  const message = error instanceof Error ? error.message : stringValue(record.message);

  if (name) {
    metadata.provider_error_name = name;
  }

  if (message && !SECRET_METADATA_VALUE.test(message)) {
    metadata.provider_error_message = truncate(message, 500);
  }

  const requestId = stringValue(record.requestId) ?? stringValue(record.request_id);
  const status = typeof record.status === "number" ? record.status : undefined;
  if (requestId) {
    metadata.provider_request_id = requestId;
  }

  if (status) {
    metadata.provider_status = status;
  }

  return metadata;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
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

function inputAssetEntriesValue(value: unknown): Array<{ assetId: string; role: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const inputAssets: Array<{ assetId: string; role: string }> = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const assetId = stringValue(item.asset_id);
    const role = stringValue(item.role);
    if (!assetId || !role) {
      continue;
    }

    inputAssets.push({ assetId, role });
  }

  return inputAssets;
}

function mediaPricingQuoteValue(value: unknown) {
  return deserializeMediaPricingQuote(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
