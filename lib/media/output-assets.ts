import { createHash } from "node:crypto";

import { getMediaEnv, type MediaEnv } from "@/lib/media/env";
import type { ProviderOutput } from "@/lib/media/provider";
import { mediaOutputKey } from "@/lib/media/storage-keys";
import { signMediaToken } from "@/lib/media/tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ProviderSourceType = "remote_url" | "data_url" | "inline_data";
type OutputMetadata = {
  source: "provider_output";
  output_index: number;
  provider_source_type: ProviderSourceType;
  output_attempt_id: string;
  reused_from_output_attempt_id?: string;
  copied_to_r2_at?: string;
  failure_reason?: string;
  failed_at?: string;
};
type OutputAssetRow = {
  id: string;
  user_id: string;
  job_id: string | null;
  kind: "input" | "output";
  status: string;
  content_type: string;
  size_bytes: number | string;
  storage_key: string;
  metadata?: Record<string, unknown> | null;
};
type CompletedAttemptAsset = {
  id: string;
  outputAttemptId: string;
  storageKey: string;
  metadata: OutputMetadata;
};

const OUTPUT_ASSET_SELECT =
  "id, user_id, job_id, kind, status, content_type, size_bytes, storage_key, metadata";

export async function createOutputAssetRows({
  userId,
  jobId,
  claimToken,
  outputs,
}: {
  userId: string;
  jobId: string;
  claimToken: string;
  outputs: ProviderOutput[];
}) {
  const admin = createSupabaseAdminClient();
  const env = getMediaEnv();
  const completedThisAttempt: CompletedAttemptAsset[] = [];
  const materializedOutputs = [];

  try {
    for (const [index, output] of outputs.entries()) {
      const materialized = await materializeOutputAsset({
        admin,
        env,
        userId,
        jobId,
        claimToken,
        output,
        outputIndex: index,
      });
      materializedOutputs.push(materialized.output);
      if (materialized.createdOrRetried) {
        completedThisAttempt.push({
          id: materialized.id,
          outputAttemptId: materialized.outputAttemptId,
          storageKey: materialized.storageKey,
          metadata: materialized.metadata,
        });
      }
    }
  } catch (error) {
    await markAttemptOutputsFailed(admin, userId, jobId, claimToken, completedThisAttempt);
    throw error;
  }

  return {
    outputs: materializedOutputs,
    attemptAssets: completedThisAttempt,
  };
}

export function deterministicOutputAssetId(jobId: string, outputIndex: number): string {
  return deterministicUuid(`woven-media-output:${jobId}:${outputIndex}`);
}

export function deterministicOutputAttemptId(
  jobId: string,
  outputIndex: number,
  claimToken: string,
): string {
  return deterministicUuid(`woven-media-output-attempt:${jobId}:${outputIndex}:${claimToken}`);
}

function deterministicUuid(value: string): string {
  const hash = createHash("sha256")
    .update(value)
    .digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function materializeOutputAsset({
  admin,
  env,
  userId,
  jobId,
  claimToken,
  output,
  outputIndex,
}: {
  admin: SupabaseAdminClient;
  env: MediaEnv;
  userId: string;
  jobId: string;
  claimToken: string;
  output: ProviderOutput;
  outputIndex: number;
}) {
  const outputId = deterministicOutputAssetId(jobId, outputIndex);
  const outputAttemptId = deterministicOutputAttemptId(jobId, outputIndex, claimToken);
  const storageKey = mediaOutputKey({
    userId,
    jobId,
    outputId,
    attemptId: outputAttemptId,
    contentType: output.contentType,
  });
  const existing = await findExistingOutputAsset({ admin, outputId, userId, jobId });
  const reusableSizeBytes = existing ? reusableReadyAssetSize({
    existing,
    output,
    userId,
    jobId,
    outputId,
    maxBytes: env.maxUploadBytes,
  }) : null;

  if (existing && reusableSizeBytes !== null) {
    const reuseMetadata = outputMetadataForReuse(output, outputIndex, outputAttemptId, existing.metadata);
    await reuseOutputAsset({
      admin,
      userId,
      jobId,
      claimToken,
      outputId,
      output,
      storageKey: existing.storage_key,
      sizeBytes: reusableSizeBytes,
      metadata: reuseMetadata,
    });

    return {
      id: outputId,
      outputAttemptId,
      storageKey: existing.storage_key,
      metadata: reuseMetadata,
      createdOrRetried: false,
      output: await publicOutputObject({
        env,
        userId,
        jobId,
        outputId,
        storageKey: existing.storage_key,
        output,
      }),
    };
  }

  const metadata = outputMetadata(output, outputIndex, outputAttemptId);
  const bytes = await readProviderOutput(output, env.maxUploadBytes);

  await prepareOutputAsset({
    admin,
    outputId,
    userId,
    jobId,
    claimToken,
    output,
    storageKey,
    sizeBytes: bytes.byteLength,
    metadata,
  });

  try {
    await uploadOutputBytes({ env, userId, jobId, outputId, output, storageKey, bytes });
    await markOutputAssetReady({
      admin,
      env,
      userId,
      jobId,
      claimToken,
      outputId,
      metadata,
    });
  } catch (error) {
    const staleClaim = isStaleClaimError(error);
    const failureReason = staleClaim
      ? "media_output_materialization_failed"
      : safeFailureReason(error);
    await markOutputAssetFailed({
      admin,
      userId,
      jobId,
      claimToken,
      outputId,
      storageKey,
      metadata,
      failureReason,
    });
    if (staleClaim) {
      throw error;
    }
    throw safeError(error, failureReason);
  }

  return {
    id: outputId,
    outputAttemptId,
    storageKey,
    metadata,
    createdOrRetried: true,
    output: await publicOutputObject({ env, userId, jobId, outputId, storageKey, output }),
  };
}

async function findExistingOutputAsset({
  admin,
  outputId,
  userId,
  jobId,
}: {
  admin: SupabaseAdminClient;
  outputId: string;
  userId: string;
  jobId: string;
}): Promise<OutputAssetRow | null> {
  const { data, error } = await admin
    .from("media_assets")
    .select(OUTPUT_ASSET_SELECT)
    .eq("id", outputId)
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("kind", "output")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as OutputAssetRow | null;
}

function reusableReadyAssetSize({
  existing,
  output,
  userId,
  jobId,
  outputId,
  maxBytes,
}: {
  existing: OutputAssetRow;
  output: ProviderOutput;
  userId: string;
  jobId: string;
  outputId: string;
  maxBytes: number;
}): number | null {
  if (!existing || existing.status !== "ready") return null;
  if (existing.content_type !== output.contentType) return null;
  if (!isOutputAttemptStorageKey({
    storageKey: existing.storage_key,
    userId,
    jobId,
    outputId,
  })) return null;

  const existingSize = numberValue(existing.size_bytes);
  if (existingSize === null || existingSize <= 0 || existingSize > maxBytes) {
    return null;
  }

  if (output.data && existingSize !== output.data.byteLength) {
    return null;
  }

  return existingSize;
}

async function reuseOutputAsset({
  admin,
  outputId,
  userId,
  jobId,
  claimToken,
  output,
  storageKey,
  sizeBytes,
  metadata,
}: {
  admin: SupabaseAdminClient;
  outputId: string;
  userId: string;
  jobId: string;
  claimToken: string;
  output: ProviderOutput;
  storageKey: string;
  sizeBytes: number;
  metadata: OutputMetadata;
}): Promise<void> {
  const { data, error } = await admin
    .rpc("reuse_claimed_media_output_asset", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_asset_id: outputId,
      p_user_id: userId,
      p_content_type: output.contentType,
      p_size_bytes: sizeBytes,
      p_storage_key: storageKey,
      p_metadata: metadata,
    });

  if (error || !data) {
    throw new Error(error?.message ?? "media_output_reuse_failed");
  }
}

async function prepareOutputAsset({
  admin,
  outputId,
  userId,
  jobId,
  claimToken,
  output,
  storageKey,
  sizeBytes,
  metadata,
}: {
  admin: SupabaseAdminClient;
  outputId: string;
  userId: string;
  jobId: string;
  claimToken: string;
  output: ProviderOutput;
  storageKey: string;
  sizeBytes: number;
  metadata: OutputMetadata;
}): Promise<void> {
  const { data, error } = await admin
    .rpc("prepare_claimed_media_output_asset", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_asset_id: outputId,
      p_user_id: userId,
      p_content_type: output.contentType,
      p_size_bytes: sizeBytes,
      p_storage_key: storageKey,
      p_metadata: metadata,
    });

  if (error || !data) {
    throw new Error(error?.message ?? "media_output_create_failed");
  }
}

async function uploadOutputBytes({
  env,
  userId,
  jobId,
  outputId,
  output,
  storageKey,
  bytes,
}: {
  env: MediaEnv;
  userId: string;
  jobId: string;
  outputId: string;
  output: ProviderOutput;
  storageKey: string;
  bytes: Buffer;
}): Promise<void> {
  const uploadToken = await signMediaToken({
    kind: "upload",
    sub: userId,
    key: storageKey,
    assetId: outputId,
    jobId,
    contentType: output.contentType,
    sizeBytes: bytes.byteLength,
    exp: Math.floor(Date.now() / 1000) + env.uploadUrlTtlSeconds,
  }, env.tokenSecret);

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(
      `${env.baseUrl}/uploads/${outputId}?token=${encodeURIComponent(uploadToken)}`,
      {
        method: "PUT",
        headers: {
          "content-type": output.contentType,
          "content-length": String(bytes.byteLength),
        },
        body: arrayBufferBody(bytes),
      },
    );
  } catch {
    throw new Error("media_output_upload_failed:network");
  }

  if (!uploadResponse.ok) {
    throw new Error(`media_output_upload_failed:${uploadResponse.status}`);
  }
}

async function markOutputAssetReady({
  admin,
  env,
  userId,
  jobId,
  claimToken,
  outputId,
  metadata,
}: {
  admin: SupabaseAdminClient;
  env: MediaEnv;
  userId: string;
  jobId: string;
  claimToken: string;
  outputId: string;
  metadata: OutputMetadata;
}): Promise<void> {
  const downloadExp = Math.floor(Date.now() / 1000) + env.downloadUrlTtlSeconds;
  const { error: readyError } = await admin
    .rpc("mark_claimed_media_output_asset_ready", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_asset_id: outputId,
      p_user_id: userId,
      p_download_expires_at: new Date(downloadExp * 1000).toISOString(),
      p_metadata: {
        ...metadata,
        copied_to_r2_at: new Date().toISOString(),
      },
    });

  if (readyError) {
    throw new Error(readyError.message);
  }
}

async function publicOutputObject({
  env,
  userId,
  jobId,
  outputId,
  storageKey,
  output,
}: {
  env: MediaEnv;
  userId: string;
  jobId: string;
  outputId: string;
  storageKey: string;
  output: ProviderOutput;
}) {
  const downloadExp = Math.floor(Date.now() / 1000) + env.downloadUrlTtlSeconds;
  const downloadToken = await signMediaToken({
    kind: "download",
    sub: userId,
    key: storageKey,
    assetId: outputId,
    jobId,
    exp: downloadExp,
  }, env.tokenSecret);

  return {
    id: outputId,
    type: output.type,
    content_type: output.contentType,
    url: `${env.baseUrl}/objects/${outputId}?token=${encodeURIComponent(downloadToken)}`,
    expires_at: new Date(downloadExp * 1000).toISOString(),
  };
}

async function readProviderOutput(output: ProviderOutput, maxBytes: number): Promise<Buffer> {
  if (output.data) {
    assertWithinMaxBytes(output.data.byteLength, maxBytes);
    return Buffer.from(output.data);
  }

  if (!output.url) {
    throw new Error("provider_output_missing_data");
  }

  if (output.url.startsWith("data:")) {
    const bytes = readDataUrl(output.url);
    assertWithinMaxBytes(bytes.byteLength, maxBytes);
    return bytes;
  }

  const url = new URL(output.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("provider_output_url_unsupported");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`provider_output_download_failed:${response.status}`);
  }

  const contentLength = parsePositiveInteger(response.headers.get("content-length"));
  if (contentLength !== null) {
    assertWithinMaxBytes(contentLength, maxBytes);
  }

  return readResponseBytes(response, maxBytes);
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    assertWithinMaxBytes(bytes.byteLength, maxBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error("media_output_too_large");
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, totalBytes);
}

function readDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    throw new Error("invalid_provider_output_data_url");
  }

  const metadata = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  if (metadata.split(";").includes("base64")) {
    return Buffer.from(payload, "base64");
  }

  return Buffer.from(decodeURIComponent(payload), "utf8");
}

function outputMetadata(
  output: ProviderOutput,
  outputIndex: number,
  outputAttemptId: string,
): OutputMetadata {
  return {
    source: "provider_output",
    output_index: outputIndex,
    provider_source_type: providerSourceType(output),
    output_attempt_id: outputAttemptId,
  };
}

function outputMetadataForReuse(
  output: ProviderOutput,
  outputIndex: number,
  outputAttemptId: string,
  existingMetadata: Record<string, unknown> | null | undefined,
): OutputMetadata {
  const metadata: OutputMetadata = outputMetadata(output, outputIndex, outputAttemptId);
  const reusedFromOutputAttemptId = stringMetadataValue(existingMetadata, "output_attempt_id");
  const copiedToR2At = stringMetadataValue(existingMetadata, "copied_to_r2_at");

  if (reusedFromOutputAttemptId) {
    metadata.reused_from_output_attempt_id = reusedFromOutputAttemptId;
  }
  if (copiedToR2At) {
    metadata.copied_to_r2_at = copiedToR2At;
  }

  return metadata;
}

function stringMetadataValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function providerSourceType(output: ProviderOutput): ProviderSourceType {
  if (output.data) return "inline_data";
  if (output.url?.startsWith("data:")) return "data_url";
  return "remote_url";
}

function isOutputAttemptStorageKey({
  storageKey,
  userId,
  jobId,
  outputId,
}: {
  storageKey: string;
  userId: string;
  jobId: string;
  outputId: string;
}): boolean {
  const prefix = `users/${userId}/media/outputs/${jobId}/${outputId}/attempts/`;
  if (!storageKey.startsWith(prefix)) return false;

  const rest = storageKey.slice(prefix.length);
  const parts = rest.split("/");
  if (parts.length !== 2) return false;

  const [attemptId, filename] = parts;
  return /^[A-Za-z0-9_-]+$/.test(attemptId) && /^output\.[A-Za-z0-9]+$/.test(filename);
}

function assertWithinMaxBytes(sizeBytes: number, maxBytes: number): void {
  if (sizeBytes > maxBytes) {
    throw new Error("media_output_too_large");
  }
}

function arrayBufferBody(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

async function markAttemptOutputsFailed(
  admin: SupabaseAdminClient,
  userId: string,
  jobId: string,
  claimToken: string,
  completedThisAttempt: CompletedAttemptAsset[],
): Promise<void> {
  await Promise.all(completedThisAttempt.map((asset) => (
    markOutputAssetFailed({
      admin,
      userId,
      jobId,
      claimToken,
      outputId: asset.id,
      storageKey: asset.storageKey,
      metadata: asset.metadata,
      failureReason: "media_output_materialization_failed",
    })
  )));
}

export async function failOutputAssetRowsForAttempt({
  userId,
  jobId,
  attemptAssets,
  reason,
}: {
  userId: string;
  jobId: string;
  attemptAssets: CompletedAttemptAsset[];
  reason: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  await Promise.all(attemptAssets.map((asset) => (
    markOutputAssetAttemptFailed({
      admin,
      userId,
      jobId,
      outputId: asset.id,
      outputAttemptId: asset.outputAttemptId,
      storageKey: asset.storageKey,
      metadata: asset.metadata,
      failureReason: reason,
    })
  )));
}

async function markOutputAssetFailed({
  admin,
  userId,
  jobId,
  claimToken,
  outputId,
  storageKey,
  metadata,
  failureReason,
}: {
  admin: SupabaseAdminClient;
  userId: string;
  jobId: string;
  claimToken: string;
  outputId: string;
  storageKey: string;
  metadata: OutputMetadata;
  failureReason: string;
}): Promise<void> {
  const { error } = await admin
    .rpc("fail_claimed_media_output_asset", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_asset_id: outputId,
      p_user_id: userId,
      p_metadata: {
        ...metadata,
        failure_reason: failureReason,
        failed_at: new Date().toISOString(),
      },
    });

  if (error) {
    if (error.message === "media_job_stale_claim") {
      await markOutputAssetAttemptFailed({
        admin,
        userId,
        jobId,
        outputId,
        outputAttemptId: metadata.output_attempt_id,
        storageKey,
        metadata,
        failureReason,
      });
      return;
    }

    throw new Error(error.message);
  }
}

async function markOutputAssetAttemptFailed({
  admin,
  userId,
  jobId,
  outputId,
  outputAttemptId,
  storageKey,
  metadata,
  failureReason,
}: {
  admin: SupabaseAdminClient;
  userId: string;
  jobId: string;
  outputId: string;
  outputAttemptId: string;
  storageKey: string;
  metadata: OutputMetadata;
  failureReason: string;
}): Promise<void> {
  const { error } = await admin
    .rpc("fail_media_output_asset_attempt", {
      p_job_id: jobId,
      p_asset_id: outputId,
      p_user_id: userId,
      p_output_attempt_id: outputAttemptId,
      p_storage_key: storageKey,
      p_metadata: {
        ...metadata,
        failure_reason: failureReason,
        failed_at: new Date().toISOString(),
      },
    });

  if (error && error.message !== "media_output_asset_attempt_not_found") {
    throw new Error(error.message);
  }
}

function safeError(error: unknown, failureReason: string): Error {
  if (error instanceof Error && error.message === failureReason) {
    return error;
  }

  return new Error(failureReason);
}

function safeFailureReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return "media_output_materialization_failed";
  }

  if (
    error.message === "media_output_upload_failed:network" ||
    error.message === "media_output_too_large" ||
    error.message === "provider_output_missing_data" ||
    error.message === "provider_output_url_unsupported" ||
    error.message === "invalid_provider_output_data_url" ||
    /^media_output_upload_failed:[0-9]{3}$/.test(error.message) ||
    /^provider_output_download_failed:[0-9]{3}$/.test(error.message)
  ) {
    return error.message;
  }

  return "media_output_materialization_failed";
}

function isStaleClaimError(error: unknown): boolean {
  return error instanceof Error && error.message === "media_job_stale_claim";
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function numberValue(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (!/^[0-9]+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
