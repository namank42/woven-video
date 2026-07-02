import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type MediaDeletionCandidate = {
  id: string;
  storage_key: string;
};

export async function claimExpiredMediaForDeletion({
  limit = 100,
  nowIso = new Date().toISOString(),
}: {
  limit?: number;
  nowIso?: string;
} = {}): Promise<MediaDeletionCandidate[]> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "claim_expired_media_assets_for_deletion",
    {
      p_now: nowIso,
      p_limit: limit,
    },
  );

  if (error) throw new Error(error.message);
  return (data ?? []) as MediaDeletionCandidate[];
}

export async function completeMediaAssetDeletions(
  assetIds: string[],
  nowIso = new Date().toISOString(),
): Promise<void> {
  if (assetIds.length === 0) return;

  const { error } = await createSupabaseAdminClient().rpc(
    "complete_media_asset_deletions",
    {
      p_asset_ids: assetIds,
      p_now: nowIso,
    },
  );

  if (error) throw new Error(error.message);
}

export async function releaseMediaAssetDeletionClaims(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;

  const { error } = await createSupabaseAdminClient().rpc(
    "release_media_asset_deletion_claims",
    {
      p_asset_ids: assetIds,
    },
  );

  if (error) throw new Error(error.message);
}
