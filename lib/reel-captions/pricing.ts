import type { ModelPricingRule } from "@/lib/billing/model-pricing";
import { USD_MICROS_PER_CENT, USD_MICROS_PER_USD } from "@/lib/billing/money";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const REEL_CAPTION_PROVIDER = "elevenlabs";
export const REEL_CAPTION_MODEL = "scribe_v2";
export const REEL_CAPTION_OPERATION = "reel_captions";
export const REEL_CAPTION_JOB_TYPE = "reel_captions";
export const REEL_CAPTION_BUCKET = "generated-media";

export const DEFAULT_PUBLIC_RATE_USD_PER_MINUTE = 0.01;
export const DEFAULT_PROVIDER_RATE_USD_PER_HOUR = 0.4;
export const DEFAULT_MINIMUM_CHARGE_USD_MICROS = USD_MICROS_PER_CENT;
export const MAX_REEL_CAPTION_DURATION_SECONDS = 10 * 60;

type CacheEntry = {
  value: ModelPricingRule | null;
  expiresAt: number;
};

const CACHE_TTL_MS = 5 * 60_000;
let cache: CacheEntry | null = null;

export async function getReelCaptionPricing(): Promise<ModelPricingRule | null> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("model_pricing_rules")
    .select(
      "id, provider, model, operation, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, metadata",
    )
    .eq("provider", REEL_CAPTION_PROVIDER)
    .eq("model", REEL_CAPTION_MODEL)
    .eq("operation", REEL_CAPTION_OPERATION)
    .eq("enabled", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const value = data as ModelPricingRule | null;
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function clearReelCaptionPricingCache(): void {
  cache = null;
}

export function chargeUsdMicrosForDuration(
  durationSeconds: number,
  rule?: ModelPricingRule | null,
): number {
  const publicRateUsdPerMinute =
    numberFromMetadata(rule?.metadata?.public_rate_usd_per_minute) ??
    DEFAULT_PUBLIC_RATE_USD_PER_MINUTE;
  const minimum =
    Number(rule?.minimum_charge_usd_micros) ||
    DEFAULT_MINIMUM_CHARGE_USD_MICROS;

  const micros = Math.ceil(
    (durationSeconds / 60) * publicRateUsdPerMinute * USD_MICROS_PER_USD,
  );

  return Math.max(minimum, micros);
}

export function providerRawCostUsdForDuration(
  durationSeconds: number,
  rule?: ModelPricingRule | null,
): number {
  const providerRateUsdPerHour =
    numberFromMetadata(rule?.metadata?.provider_rate_usd_per_hour) ??
    DEFAULT_PROVIDER_RATE_USD_PER_HOUR;
  return (durationSeconds / 3600) * providerRateUsdPerHour;
}

export function markupUsdMicros({
  chargedAmountUsdMicros,
  rawProviderCostUsd,
}: {
  chargedAmountUsdMicros: number;
  rawProviderCostUsd: number;
}): number {
  const rawMicros = Math.ceil(rawProviderCostUsd * USD_MICROS_PER_USD);
  return Math.max(0, chargedAmountUsdMicros - rawMicros);
}

function numberFromMetadata(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}
