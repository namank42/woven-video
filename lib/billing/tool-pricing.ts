import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ModelPricingRule } from "@/lib/billing/model-pricing";

export type WebToolOperation = "search" | "fetch";

const PROVIDER = "exa";
const MODEL_BY_OPERATION: Record<WebToolOperation, string> = {
  search: "exa/search",
  fetch: "exa/contents",
};

type CacheEntry = {
  value: ModelPricingRule | null;
  expiresAt: number;
};

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<WebToolOperation, CacheEntry>();

export async function getWebToolPricing(
  operation: WebToolOperation,
): Promise<ModelPricingRule | null> {
  const cached = cache.get(operation);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("model_pricing_rules")
    .select(
      "id, provider, model, operation, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, metadata",
    )
    .eq("provider", PROVIDER)
    .eq("operation", operation)
    .eq("model", MODEL_BY_OPERATION[operation])
    .eq("enabled", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const value = data as ModelPricingRule | null;
  cache.set(operation, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Clear the in-memory pricing cache. Useful for tests and after rule edits. */
export function clearWebToolPricingCache(): void {
  cache.clear();
}
