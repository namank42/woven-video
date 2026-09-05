import { requiredEnv } from "../_shared/http.ts";
import {
  createServiceClient,
  requireAuthenticatedUser,
} from "../_shared/supabase.ts";
import type { TelemetryBatchResponseV1 } from "../_shared/telemetry/types.ts";
import { handleTelemetryIngest } from "./handler.ts";
import { resolveTelemetryIdentity } from "./auth.ts";

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
      return await resolveTelemetryIdentity(candidate, {
        // Pin legacy desktop admission to the verified public project key when
        // the hosted runtime's reserved anon credential differs from that key.
        anonKey: Deno.env.get("WOVEN_TELEMETRY_PUBLIC_ANON_KEY") ??
          requiredEnv("SUPABASE_ANON_KEY"),
        publishableKeysJSON: Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
        verifyUser: requireAuthenticatedUser,
      });
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
