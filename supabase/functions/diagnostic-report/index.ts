import { resolveTelemetryIdentity } from "../_shared/auth.ts";
import type { DiagnosticAdmitResult } from "../_shared/diagnostics/types.ts";
import { requiredEnv } from "../_shared/http.ts";
import {
  createServiceClient,
  requireAuthenticatedUser,
} from "../_shared/supabase.ts";
import { handleDiagnosticReport } from "./handler.ts";

function parseAdmitResponse(value: unknown): DiagnosticAdmitResult {
  if (!value || typeof value !== "object") {
    throw new Error("invalid_diagnostic_admit_response");
  }
  const response = value as Record<string, unknown>;
  if (
    !Array.isArray(response.accepted) ||
    !response.accepted.every((id) => typeof id === "string") ||
    !Array.isArray(response.rejected) ||
    !response.rejected.every((entry) =>
      entry && typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).record_id === "string" &&
      typeof (entry as Record<string, unknown>).reason === "string"
    ) ||
    (response.retry_after_ms !== null &&
      typeof response.retry_after_ms !== "number")
  ) {
    throw new Error("invalid_diagnostic_admit_response");
  }
  return value as DiagnosticAdmitResult;
}

Deno.serve((request) =>
  handleDiagnosticReport(request, {
    // Resolves identity exactly like telemetry-ingest: a verified user JWT
    // sets userId, and the anon/publishable key alone means installation
    // only (userId stays null).
    async resolveVerifiedUserId(candidate) {
      return await resolveTelemetryIdentity(candidate, {
        anonKey: Deno.env.get("WOVEN_TELEMETRY_PUBLIC_ANON_KEY") ??
          requiredEnv("SUPABASE_ANON_KEY"),
        publishableKeysJSON: Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
        verifyUser: requireAuthenticatedUser,
      });
    },
    async admitAndInsert(batch, userId, receivedAt) {
      const { data, error } = await createServiceClient().rpc(
        "diagnostic_report_admit_and_insert",
        {
          p_records: batch.records,
          p_installation_id: batch.installation_id,
          p_app_version: batch.app_version,
          p_build: batch.build,
          p_user_id: userId,
          p_received_at: receivedAt.toISOString(),
        },
      );
      if (error) throw new Error("diagnostic_report_transaction_failed");
      return parseAdmitResponse(data);
    },
    now: () => new Date(),
  })
);
