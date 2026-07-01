import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function markExpiredMediaForDeletion(nowIso = new Date().toISOString()) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("media_assets")
    .update({ status: "deleted", deleted_at: nowIso })
    .or(`upload_expires_at.lt.${nowIso},download_expires_at.lt.${nowIso}`)
    .neq("status", "deleted")
    .select("id, storage_key");

  if (error) throw new Error(error.message);
  return data ?? [];
}
