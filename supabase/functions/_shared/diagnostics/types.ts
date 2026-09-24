export type DiagnosticSource = "turn" | "compaction" | "tool" | "export";

export type DiagnosticErrorEntryV1 = {
  name: string;
  message: string;
  response_body?: string;
  detail?: string;
};

export type DiagnosticRecordV1 = {
  record_id: string;
  occurred_at: string;
  source: DiagnosticSource;
  failure_site: string;
  error_class?: string;
  http_status?: number;
  native_error_domain?: string;
  native_error_code?: number;
  code_site?: string;
  woven_job_id?: string;
  chat_id?: string;
  turn_id?: string;
  operation_id?: string;
  model_id?: string;
  errors: DiagnosticErrorEntryV1[];
};

export type DiagnosticReportBatchV1 = {
  schema_version: 1;
  installation_id: string;
  app_version: string;
  build: string;
  records: DiagnosticRecordV1[];
};

// "invalid_schema" covers shape, enum, uuid, and pattern failures, plus any
// per-record DB-level rejection that isn't the row-size cap (a record that
// passed validation.ts can still fail a DB constraint or cast -- see
// DiagnosticAdmitResult below -- and that also reports invalid_schema).
// "payload_too_large" covers a single record exceeding the row-size cap,
// whether caught by validation.ts's conservative pre-check or, at the exact
// byte boundary, only by the DB's own row-size CHECK constraint.
export type DiagnosticRejectionReason = "invalid_schema" | "payload_too_large";

export type DiagnosticReportResponseV1 = {
  accepted: string[];
  rejected: Array<{ record_id: string; reason: DiagnosticRejectionReason }>;
  // Non-null only on a 429: the whole batch was rejected for rate limiting
  // (all or nothing), never mixed with individual accepted/rejected entries.
  retry_after_ms: number | null;
};

export type DiagnosticAdmitBatch = {
  installation_id: string;
  app_version: string;
  build: string;
  records: DiagnosticRecordV1[];
};

// What the RPC returns: either the whole batch was rate-limited
// (retry_after_ms set, accepted/rejected both empty -- nothing was inserted),
// or each submitted record was individually inserted or rejected inside its
// own exception-handled subtransaction (retry_after_ms null).
export type DiagnosticAdmitResult = {
  accepted: string[];
  rejected: Array<{ record_id: string; reason: DiagnosticRejectionReason }>;
  retry_after_ms: number | null;
};

export type DiagnosticIngestDependencies = {
  resolveVerifiedUserId(request: Request): Promise<string | null>;
  admitAndInsert(
    batch: DiagnosticAdmitBatch,
    userId: string | null,
    receivedAt: Date,
  ): Promise<DiagnosticAdmitResult>;
  now(): Date;
};
