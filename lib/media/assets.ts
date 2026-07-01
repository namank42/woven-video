import { getMediaEnv } from "@/lib/media/env";
import { mediaInputKey } from "@/lib/media/storage-keys";
import { signMediaToken } from "@/lib/media/tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type MediaAssetRow = {
  id: string;
  user_id: string;
  job_id: string | null;
  kind: "input" | "output";
  status: string;
  content_type: string;
  size_bytes: number | string;
  original_filename: string | null;
  storage_key: string;
  upload_expires_at: string | null;
  metadata: Record<string, unknown>;
};

const MEDIA_ASSET_SELECT =
  "id, user_id, job_id, kind, status, content_type, size_bytes, original_filename, storage_key, upload_expires_at, metadata";

export function isSupportedInputContentType(contentType: string): boolean {
  return /^(image|video|audio)\//.test(contentType);
}

export async function createInputAssetUpload({
  userId,
  filename,
  contentType,
  sizeBytes,
}: {
  userId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{
  asset: MediaAssetRow;
  uploadUrl: string;
  expiresAt: string;
}> {
  const env = getMediaEnv();
  if (!isSupportedInputContentType(contentType)) {
    throw new Error("invalid_media_input");
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("invalid_media_input");
  }
  if (sizeBytes > env.maxUploadBytes) {
    throw new Error("upload_too_large");
  }

  const admin = createSupabaseAdminClient();
  const expiresAt = new Date(Date.now() + env.uploadUrlTtlSeconds * 1000).toISOString();

  const { data: initial, error: insertError } = await admin
    .from("media_assets")
    .insert({
      user_id: userId,
      kind: "input",
      status: "pending",
      content_type: contentType,
      size_bytes: sizeBytes,
      original_filename: filename.slice(0, 180),
      storage_key: `pending/${crypto.randomUUID()}`,
      upload_expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !initial?.id) {
    throw new Error(insertError?.message ?? "media_asset_create_failed");
  }

  const assetId = String(initial.id);
  const storageKey = mediaInputKey({ userId, assetId, filename, contentType });
  const { data, error: updateError } = await admin
    .from("media_assets")
    .update({ storage_key: storageKey })
    .eq("id", assetId)
    .select(MEDIA_ASSET_SELECT)
    .single();

  if (updateError || !data) {
    const message = updateError?.message ?? "media_asset_update_failed";
    await markAssetSetupFailed(admin, assetId, message);
    throw new Error(message);
  }

  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
  const token = await signMediaToken(
    {
      kind: "upload",
      sub: userId,
      key: storageKey,
      assetId,
      contentType,
      sizeBytes,
      exp,
    },
    env.tokenSecret,
  );

  return {
    asset: data as MediaAssetRow,
    uploadUrl: `${env.baseUrl}/uploads/${assetId}?token=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

export async function markInputAssetUploaded({
  assetId,
  storageKey,
  sizeBytes,
}: {
  assetId: string;
  storageKey: string;
  sizeBytes: number;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("media_assets")
    .update({
      status: "uploaded",
      size_bytes: sizeBytes,
      metadata: { uploaded_at: new Date().toISOString() },
    })
    .eq("id", assetId)
    .eq("storage_key", storageKey)
    .eq("status", "pending")
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "media_asset_upload_complete_failed");
  }
}

async function markAssetSetupFailed(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  assetId: string,
  setupError: string,
): Promise<void> {
  const { error } = await admin
    .from("media_assets")
    .update({
      status: "failed",
      metadata: {
        setup_error: setupError,
        failed_at: new Date().toISOString(),
      },
    })
    .eq("id", assetId);

  if (error) {
    console.error("Failed to mark media asset setup failed", error);
  }
}
