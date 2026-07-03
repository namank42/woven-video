import { chargeWithMarkupUsdMicros } from "@/lib/billing/money";
import type { MediaModel, MediaPricingQuote } from "@/lib/media/types";

export function reservationUsdMicros(model: MediaModel, pricingQuote?: MediaPricingQuote): number {
  return pricingQuote?.reservedAmountUsdMicros ?? model.pricing.reserveUsdMicros;
}

export function chargeMediaUsdMicros({
  model,
  rawCostUsd,
  pricingQuote,
}: {
  model: MediaModel;
  rawCostUsd: number | string;
  pricingQuote?: MediaPricingQuote | null;
}) {
  const rawCost = Number(rawCostUsd);
  if ((!Number.isFinite(rawCost) || rawCost <= 0) && pricingQuote) {
    return {
      rawCostUsdMicros: pricingQuote.providerCostUsdMicros,
      chargedAmountUsdMicros: pricingQuote.chargedAmountUsdMicros,
      markupAmountUsdMicros: pricingQuote.markupAmountUsdMicros,
    };
  }

  return chargeWithMarkupUsdMicros({
    rawCostUsd,
    markupBps: model.pricing.markupBps,
    minimumChargeUsdMicros: model.pricing.minimumUsdMicros,
  });
}
