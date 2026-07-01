import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function markExpiredMediaForDeletion(nowIso = new Date().toISOString()) {
  const admin = createSupabaseAdminClient();
  const expiredPendingUploads = await admin
    .from("media_assets")
    .update({ status: "deleted", deleted_at: nowIso })
    .eq("status", "pending")
    .lt("upload_expires_at", nowIso)
    .select("id, storage_key");

  if (expiredPendingUploads.error) throw new Error(expiredPendingUploads.error.message);

  const expiredReadyDownloads = await admin
    .from("media_assets")
    .update({ status: "deleted", deleted_at: nowIso })
    .eq("status", "ready")
    .lt("download_expires_at", nowIso)
    .select("id, storage_key");

  if (expiredReadyDownloads.error) throw new Error(expiredReadyDownloads.error.message);

  return [
    ...(expiredPendingUploads.data ?? []),
    ...(expiredReadyDownloads.data ?? []),
  ];
}
