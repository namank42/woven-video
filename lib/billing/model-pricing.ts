import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ModelPricingRule = {
  id: string;
  provider: string;
  model: string;
  operation: string;
  display_name: string;
  markup_bps: number;
  minimum_charge_usd_micros: number;
  reserve_amount_usd_micros: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
};

export function normalizeHostedModelId(model: unknown) {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("woven:") ? trimmed.slice("woven:".length) : trimmed;
}

export async function listHostedChatModels() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("model_pricing_rules")
    .select(
      "id, provider, model, operation, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, metadata",
    )
    .eq("operation", "chat")
    .eq("enabled", true)
    .order("display_name");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ModelPricingRule[];
}

export async function getHostedChatModel(model: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("model_pricing_rules")
    .select(
      "id, provider, model, operation, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, metadata",
    )
    .eq("provider", "vercel-ai-gateway")
    .eq("operation", "chat")
    .eq("model", model)
    .eq("enabled", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as ModelPricingRule | null;
}
