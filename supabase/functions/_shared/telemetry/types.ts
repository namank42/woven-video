export type TelemetryStream = "product" | "operational";
export type TelemetryPriority = 0 | 1 | 2 | 3;

export type TelemetryValue =
  | string
  | number
  | boolean
  | string[]
  | number[];

export type TelemetryEnvelopeV1 = {
  event_id: string;
  catalog_version: 1;
  stream: TelemetryStream;
  event_name: string;
  occurred_at: string;
  source: "desktop" | "sidecar";
  source_sequence: number;
  host_observed_sequence: number;
  installation_id: string;
  app_launch_id: string;
  workspace_id?: string;
  chat_id?: string;
  operation_id?: string;
  turn_id?: string;
  incident_id?: string;
  tool_call_id?: string;
  stage: string;
  priority: TelemetryPriority;
  app: {
    version: string;
    build: string;
    environment: "development" | "beta" | "production";
    release_channel: "internal" | "beta" | "stable";
  };
  system: {
    macos_major_minor: string;
    architecture: "arm64" | "x86_64" | "other";
  };
  properties: Record<string, TelemetryValue>;
};

export type TelemetryBatchRequestV1 = {
  catalog_version: 1;
  batch_id: string;
  events: TelemetryEnvelopeV1[];
};

export type TelemetryRejectionReason =
  | "invalid_schema"
  | "unknown_event"
  | "privacy_violation"
  | "rate_limited";

export type TelemetryBatchResponseV1 = {
  accepted: string[];
  rejected: Array<{
    event_id: string;
    reason: TelemetryRejectionReason;
    permanent: boolean;
  }>;
  retry_after_ms: number | null;
};

export type TelemetryValidationResult =
  | { ok: true; batch: TelemetryBatchRequestV1 }
  | { ok: false; status: 400 | 413; response: TelemetryBatchResponseV1 };

export type TelemetryIngestDependencies = {
  resolveVerifiedUserId(request: Request): Promise<string | null>;
  admitAndInsert(
    batch: TelemetryBatchRequestV1,
    userId: string | null,
    receivedAt: Date,
  ): Promise<TelemetryBatchResponseV1>;
  now(): Date;
};
