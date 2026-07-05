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

export type MediaDispatchSource = "create" | "reconcile" | "webhook";

export type RecordMediaJobTriggerDispatchInput = {
  jobId: string;
  runId: string;
  source: MediaDispatchSource;
  idempotencyKey: string;
  dispatchedAt?: string;
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

  return normalizeClaimMediaJobByIdResponse(data);
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

export async function recordMediaJobTriggerDispatch({
  jobId,
  runId,
  source,
  idempotencyKey,
  dispatchedAt = new Date().toISOString(),
}: RecordMediaJobTriggerDispatchInput): Promise<void> {
  const { error } = await createSupabaseAdminClient().rpc("record_media_job_trigger_dispatch", {
    p_job_id: jobId,
    p_run_id: runId,
    p_dispatch_source: source,
    p_idempotency_key: idempotencyKey,
    p_dispatched_at: dispatchedAt,
  });

  if (error) {
    throw new Error(error.message);
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function mediaKindValue(value: unknown): ReconciliationMediaJob["kind"] | null {
  return value === "image" || value === "video" || value === "audio" ? value : null;
}

function normalizeClaimMediaJobByIdResponse(data: unknown): MediaJobClaimRow | null {
  if (data === null || isNullCompositeMediaJobClaim(data)) {
    return null;
  }

  return data as MediaJobClaimRow;
}

function isNullCompositeMediaJobClaim(value: unknown): value is MediaJobClaimRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as MediaJobClaimRow;
  return row.id === null &&
    row.user_id === null &&
    row.input === null &&
    row.provider_job_id === null &&
    row.claim_token === null &&
    row.expires_at === null;
}
