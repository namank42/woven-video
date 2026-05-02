import type { ModelPricingRule } from "@/lib/billing/model-pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

type RunResult<T> =
  | { ok: true; output: T; rawCostUsd?: number | string }
  | { ok: false; error: string; status?: number };

export type FlatToolChargeResult<T> =
  | { ok: true; output: T; jobId: string }
  | {
      ok: false;
      error: string;
      status: number;
      code: string;
      jobId?: string;
    };

/**
 * Run a flat-fee external API call against a user's Woven balance.
 *
 * Reserves `rule.reserve_amount_usd_micros` against the user's account,
 * runs the supplied function, then settles with the same amount on success
 * or releases the reservation on failure. Used for web search / web fetch
 * where cost per call is fixed and we don't need token-based settlement.
 *
 * Round trips on success path: 2 (start_flat_tool_call, settle_flat_tool_call).
 * Round trips on failure path: 2 (start_flat_tool_call, release_balance_reservation).
 */
export async function chargeFlatTool<T>({
  userId,
  rule,
  jobType,
  input,
  run,
}: {
  userId: string;
  rule: ModelPricingRule;
  jobType: string;
  input: Record<string, unknown>;
  run: () => Promise<RunResult<T>>;
}): Promise<FlatToolChargeResult<T>> {
  const admin = createSupabaseAdminClient();

  const { data: jobId, error: startError } = await admin.rpc(
    "start_flat_tool_call",
    {
      p_user_id: userId,
      p_provider: rule.provider,
      p_model: rule.model,
      p_operation: rule.operation,
      p_job_type: jobType,
      p_amount_usd_micros: rule.reserve_amount_usd_micros,
      p_input: input,
    },
  );

  if (startError) {
    const insufficient = startError.message === "insufficient_balance";
    return {
      ok: false,
      error: insufficient
        ? "Insufficient balance. Add funds before using Woven-hosted tools."
        : startError.message,
      status: insufficient ? 402 : 500,
      code: insufficient ? "insufficient_balance" : "tool_start_failed",
    };
  }

  const jobIdValue = jobId as string;

  let result: RunResult<T>;
  try {
    result = await run();
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 502,
    };
  }

  if (!result.ok) {
    await releaseReservation(admin, jobIdValue, result.error, "failed");
    return {
      ok: false,
      error: result.error,
      status: result.status ?? 502,
      code: "tool_call_failed",
      jobId: jobIdValue,
    };
  }

  const { error: settleError } = await admin.rpc("settle_flat_tool_call", {
    p_job_id: jobIdValue,
    p_operation: rule.operation,
    p_final_cost_usd_micros: rule.reserve_amount_usd_micros,
    p_raw_provider_cost: numeric(result.rawCostUsd) ?? 0,
    p_metadata: {},
  });

  if (settleError) {
    await releaseReservation(admin, jobIdValue, settleError.message, "failed");
    return {
      ok: false,
      error: settleError.message,
      status: 500,
      code: "usage_settlement_failed",
      jobId: jobIdValue,
    };
  }

  return { ok: true, output: result.output, jobId: jobIdValue };
}

async function releaseReservation(
  admin: SupabaseAdmin,
  jobId: string,
  error: string,
  status: "failed" | "cancelled",
) {
  const { error: releaseError } = await admin.rpc(
    "release_balance_reservation",
    {
      p_job_id: jobId,
      p_status: status,
      p_error: error,
      p_metadata: { reason: error },
    },
  );

  if (releaseError) {
    console.error("Failed to release flat-tool reservation", releaseError);
  }
}

function numeric(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
