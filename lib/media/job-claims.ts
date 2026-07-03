import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type MediaJobClaimRow = {
  id?: unknown;
  user_id?: unknown;
  input?: unknown;
  provider_job_id?: unknown;
  claim_token?: unknown;
  expires_at?: unknown;
};

export type ReconciliationMediaJob = {
  jobId: string;
  userId: string;
  modelId: string;
  kind: "image" | "video" | "audio";
};

type ReconciliationRpcRow = {
  id?: unknown;
  user_id?: unknown;
  media_model_id?: unknown;
  media_kind?: unknown;
};

export async function claimMediaJobById(jobId: string, leaseSeconds = 300): Promise<MediaJobClaimRow | null> {
  const { data, error } = await createSupabaseAdminClient().rpc("claim_media_job_by_id", {
    p_job_id: jobId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as MediaJobClaimRow | null;
}

export async function findMediaJobsForTriggerReconciliation(limit = 25): Promise<ReconciliationMediaJob[]> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "find_media_jobs_for_trigger_reconciliation",
    { p_limit: limit, p_now: new Date().toISOString() },
  );

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).flatMap((row: ReconciliationRpcRow) => {
    const jobId = stringValue(row.id);
    const userId = stringValue(row.user_id);
    const modelId = stringValue(row.media_model_id);
    const kind = mediaKindValue(row.media_kind);
    return jobId && userId && modelId && kind ? [{ jobId, userId, modelId, kind }] : [];
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function mediaKindValue(value: unknown): ReconciliationMediaJob["kind"] | null {
  return value === "image" || value === "video" || value === "audio" ? value : null;
}
