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
  metadata: OutputMetadata;
};

const OUTPUT_ASSET_SELECT =
  "id, user_id, job_id, kind, status, content_type, size_bytes, storage_key, metadata";

export async function createOutputAssetRows({
  userId,
  jobId,
  outputs,
}: {
  userId: string;
  jobId: string;
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
        output,
        outputIndex: index,
      });
      materializedOutputs.push(materialized.output);
      if (materialized.createdOrRetried) {
        completedThisAttempt.push({
          id: materialized.id,
          metadata: materialized.metadata,
        });
      }
    }
  } catch (error) {
    await markAttemptOutputsFailed(admin, completedThisAttempt);
    throw error;
  }

  return materializedOutputs;
}

export function deterministicOutputAssetId(jobId: string, outputIndex: number): string {
  const hash = createHash("sha256")
    .update(`woven-media-output:${jobId}:${outputIndex}`)
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
  output,
  outputIndex,
}: {
  admin: SupabaseAdminClient;
  env: MediaEnv;
  userId: string;
  jobId: string;
  output: ProviderOutput;
  outputIndex: number;
}) {
  const outputId = deterministicOutputAssetId(jobId, outputIndex);
  const storageKey = mediaOutputKey({
    userId,
    jobId,
    outputId,
    contentType: output.contentType,
  });
  const metadata = outputMetadata(output, outputIndex);
  const existing = await findExistingOutputAsset({ admin, outputId, userId, jobId });

  if (canReuseReadyAsset({
    existing,
    output,
    storageKey,
    maxBytes: env.maxUploadBytes,
  })) {
    return {
      id: outputId,
      metadata,
      createdOrRetried: false,
      output: await publicOutputObject({ env, userId, jobId, outputId, storageKey, output }),
    };
  }

  const bytes = await readProviderOutput(output, env.maxUploadBytes);

  if (existing) {
    await resetOutputAsset({
      admin,
      outputId,
      output,
      storageKey,
      sizeBytes: bytes.byteLength,
      metadata,
    });
  } else {
    await insertOutputAsset({
      admin,
      outputId,
      userId,
      jobId,
      output,
      storageKey,
      sizeBytes: bytes.byteLength,
      metadata,
    });
  }

  try {
    await uploadOutputBytes({ env, userId, jobId, outputId, output, storageKey, bytes });
    await markOutputAssetReady({ admin, env, outputId, metadata });
  } catch (error) {
    const failureReason = safeFailureReason(error);
    await markOutputAssetFailed(admin, outputId, metadata, failureReason);
    throw safeError(error, failureReason);
  }

  return {
    id: outputId,
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

function canReuseReadyAsset({
  existing,
  output,
  storageKey,
  maxBytes,
}: {
  existing: OutputAssetRow | null;
  output: ProviderOutput;
  storageKey: string;
  maxBytes: number;
}): boolean {
  if (!existing || existing.status !== "ready") return false;
  if (existing.content_type !== output.contentType) return false;
  if (existing.storage_key !== storageKey) return false;

  const existingSize = numberValue(existing.size_bytes);
  if (existingSize === null || existingSize <= 0 || existingSize > maxBytes) {
    return false;
  }

  if (output.data && existingSize !== output.data.byteLength) {
    return false;
  }

  return true;
}

async function insertOutputAsset({
  admin,
  outputId,
  userId,
  jobId,
  output,
  storageKey,
  sizeBytes,
  metadata,
}: {
  admin: SupabaseAdminClient;
  outputId: string;
  userId: string;
  jobId: string;
  output: ProviderOutput;
  storageKey: string;
  sizeBytes: number;
  metadata: OutputMetadata;
}): Promise<void> {
  const { data, error } = await admin
    .from("media_assets")
    .insert({
      id: outputId,
      user_id: userId,
      job_id: jobId,
      kind: "output",
      status: "pending",
      content_type: output.contentType,
      size_bytes: sizeBytes,
      storage_key: storageKey,
      download_expires_at: null,
      metadata,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "media_output_create_failed");
  }
}

async function resetOutputAsset({
  admin,
  outputId,
  output,
  storageKey,
  sizeBytes,
  metadata,
}: {
  admin: SupabaseAdminClient;
  outputId: string;
  output: ProviderOutput;
  storageKey: string;
  sizeBytes: number;
  metadata: OutputMetadata;
}): Promise<void> {
  const { data, error } = await admin
    .from("media_assets")
    .update({
      status: "pending",
      content_type: output.contentType,
      size_bytes: sizeBytes,
      storage_key: storageKey,
      download_expires_at: null,
      metadata,
    })
    .eq("id", outputId)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "media_output_update_failed");
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
  outputId,
  metadata,
}: {
  admin: SupabaseAdminClient;
  env: MediaEnv;
  outputId: string;
  metadata: OutputMetadata;
}): Promise<void> {
  const downloadExp = Math.floor(Date.now() / 1000) + env.downloadUrlTtlSeconds;
  const { error: readyError } = await admin
    .from("media_assets")
    .update({
      status: "ready",
      download_expires_at: new Date(downloadExp * 1000).toISOString(),
      metadata: {
        ...metadata,
        copied_to_r2_at: new Date().toISOString(),
      },
    })
    .eq("id", outputId)
    .select("id")
    .single();

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

function outputMetadata(output: ProviderOutput, outputIndex: number): OutputMetadata {
  return {
    source: "provider_output",
    output_index: outputIndex,
    provider_source_type: providerSourceType(output),
  };
}

function providerSourceType(output: ProviderOutput): ProviderSourceType {
  if (output.data) return "inline_data";
  if (output.url?.startsWith("data:")) return "data_url";
  return "remote_url";
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
  completedThisAttempt: CompletedAttemptAsset[],
): Promise<void> {
  await Promise.all(completedThisAttempt.map((asset) => (
    markOutputAssetFailed(admin, asset.id, asset.metadata, "media_output_materialization_failed")
  )));
}

async function markOutputAssetFailed(
  admin: SupabaseAdminClient,
  outputId: string,
  metadata: OutputMetadata,
  failureReason: string,
): Promise<void> {
  const { error } = await admin
    .from("media_assets")
    .update({
      status: "failed",
      metadata: {
        ...metadata,
        failure_reason: failureReason,
        failed_at: new Date().toISOString(),
      },
    })
    .eq("id", outputId)
    .select("id")
    .single();

  if (error) {
    console.error("Failed to mark media output asset failed", error);
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
