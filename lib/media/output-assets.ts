import { getMediaEnv } from "@/lib/media/env";
import type { ProviderOutput } from "@/lib/media/provider";
import { mediaOutputKey } from "@/lib/media/storage-keys";
import { signMediaToken } from "@/lib/media/tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type OutputMetadata = {
  provider_source_url?: string;
  copied_to_r2_at?: string;
  upload_error?: string;
  failed_at?: string;
};

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

  return Promise.all(outputs.map(async (output) => {
    const outputId = crypto.randomUUID();
    const storageKey = mediaOutputKey({
      userId,
      jobId,
      outputId,
      contentType: output.contentType,
    });
    const bytes = await readProviderOutput(output);
    const metadata = output.url ? { provider_source_url: output.url } : {};

    const { data, error } = await admin
      .from("media_assets")
      .insert({
        id: outputId,
        user_id: userId,
        job_id: jobId,
        kind: "output",
        status: "pending",
        content_type: output.contentType,
        size_bytes: bytes.byteLength,
        storage_key: storageKey,
        metadata,
      })
      .select("id, storage_key")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "media_output_create_failed");
    }

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
      const message = "media_output_upload_failed:network";
      await markOutputAssetFailed(admin, outputId, metadata, message);
      throw new Error(message);
    }

    if (!uploadResponse.ok) {
      const message = `media_output_upload_failed:${uploadResponse.status}`;
      await markOutputAssetFailed(admin, outputId, metadata, message);
      throw new Error(message);
    }

    const downloadExp = Math.floor(Date.now() / 1000) + env.downloadUrlTtlSeconds;
    const expiresAt = new Date(downloadExp * 1000).toISOString();
    const copiedAt = new Date().toISOString();
    const { error: readyError } = await admin
      .from("media_assets")
      .update({
        status: "ready",
        download_expires_at: expiresAt,
        metadata: {
          ...metadata,
          copied_to_r2_at: copiedAt,
        },
      })
      .eq("id", outputId)
      .select("id")
      .single();

    if (readyError) {
      throw new Error(readyError.message);
    }

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
      expires_at: expiresAt,
    };
  }));
}

async function readProviderOutput(output: ProviderOutput): Promise<Buffer> {
  if (output.data) {
    return Buffer.from(output.data);
  }

  if (!output.url) {
    throw new Error("provider_output_missing_data");
  }

  if (output.url.startsWith("data:")) {
    return readDataUrl(output.url);
  }

  const url = new URL(output.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("provider_output_url_unsupported");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`provider_output_download_failed:${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
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

function arrayBufferBody(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

async function markOutputAssetFailed(
  admin: SupabaseAdminClient,
  outputId: string,
  metadata: OutputMetadata,
  uploadError: string,
): Promise<void> {
  const { error } = await admin
    .from("media_assets")
    .update({
      status: "failed",
      metadata: {
        ...metadata,
        upload_error: uploadError,
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
