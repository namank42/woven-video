import { getMediaEnv } from "@/lib/media/env";
import { signMediaToken } from "@/lib/media/tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type StoredOutput = {
  id: string;
  type: string | null;
  content_type: string | null;
};

export type PresentedOutput = StoredOutput & {
  url: string | null;
  expires_at: string | null;
};

type OutputAssetRow = {
  id: string;
  storage_key: string | null;
  status: string;
  download_expires_at: string | null;
};

export async function presentJobOutputs({
  userId,
  jobId,
  outputs,
}: {
  userId: string;
  jobId: string;
  outputs: unknown[];
}): Promise<PresentedOutput[]> {
  const stored = outputs
    .map(storedOutput)
    .filter((output): output is StoredOutput => output !== null);
  if (stored.length === 0) {
    return [];
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("media_assets")
    .select("id, storage_key, status, download_expires_at")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("kind", "output")
    .in("id", stored.map((output) => output.id));

  if (error) {
    throw new Error(error.message);
  }

  const rows = new Map(((data ?? []) as OutputAssetRow[]).map((row) => [row.id, row]));
  const env = getMediaEnv();
  const nowSeconds = Math.floor(Date.now() / 1000);

  return Promise.all(stored.map(async (output) => {
    const row = rows.get(output.id);
    const retentionExp = retentionExpSeconds(row);
    if (!row || row.status !== "ready" || !row.storage_key || (retentionExp !== null && retentionExp <= nowSeconds)) {
      return { ...output, url: null, expires_at: null };
    }

    const exp = retentionExp === null
      ? nowSeconds + env.downloadUrlTtlSeconds
      : Math.min(nowSeconds + env.downloadUrlTtlSeconds, retentionExp);
    const token = await signMediaToken({
      kind: "download",
      sub: userId,
      key: row.storage_key,
      assetId: output.id,
      jobId,
      exp,
    }, env.tokenSecret);

    return {
      ...output,
      url: `${env.baseUrl}/objects/${output.id}?token=${encodeURIComponent(token)}`,
      expires_at: new Date(exp * 1000).toISOString(),
    };
  }));
}

function retentionExpSeconds(row: OutputAssetRow | undefined): number | null {
  if (!row?.download_expires_at) return null;
  const parsed = Date.parse(row.download_expires_at);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function storedOutput(value: unknown): StoredOutput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id : null;
  if (!id) return null;

  return {
    id,
    type: typeof record.type === "string" ? record.type : null,
    content_type: typeof record.content_type === "string" ? record.content_type : null,
  };
}
