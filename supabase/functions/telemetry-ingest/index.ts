import { requiredEnv } from "../_shared/http.ts";
import {
  createServiceClient,
  requireAuthenticatedUser,
} from "../_shared/supabase.ts";
import type { TelemetryBatchResponseV1 } from "../_shared/telemetry/types.ts";
import { handleTelemetryIngest } from "./handler.ts";

function parseIngestResponse(value: unknown): TelemetryBatchResponseV1 {
  if (!value || typeof value !== "object") {
    throw new Error("invalid_ingest_response");
  }
  const response = value as Record<string, unknown>;
  if (
    !Array.isArray(response.accepted) || !Array.isArray(response.rejected) ||
    (response.retry_after_ms !== null &&
      typeof response.retry_after_ms !== "number")
  ) {
    throw new Error("invalid_ingest_response");
  }
  return value as TelemetryBatchResponseV1;
}

Deno.serve((request) =>
  handleTelemetryIngest(request, {
    async resolveVerifiedUserId(candidate) {
      const authorization = candidate.headers.get("Authorization") ?? "";
      const token = authorization.replace(/^Bearer\s+/i, "");
      if (token === requiredEnv("SUPABASE_ANON_KEY")) return null;
      return (await requireAuthenticatedUser(candidate)).id;
    },
    async admitAndInsert(batch, userId, receivedAt) {
      const { data, error } = await createServiceClient().rpc(
        "telemetry_admit_and_insert",
        {
          p_batch: batch,
          p_user_id: userId,
          p_received_at: receivedAt.toISOString(),
        },
      );
      if (error) throw new Error("telemetry_ingest_transaction_failed");
      return parseIngestResponse(data);
    },
    now: () => new Date(),
  })
);
