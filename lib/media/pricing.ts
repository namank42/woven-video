import { chargeWithMarkupUsdMicros } from "@/lib/billing/money";
import type { MediaModel } from "@/lib/media/types";

export function reservationUsdMicros(model: MediaModel): number {
  return model.pricing.reserveUsdMicros;
}

export function chargeMediaUsdMicros({
  model,
  rawCostUsd,
}: {
  model: MediaModel;
  rawCostUsd: number | string;
}) {
  return chargeWithMarkupUsdMicros({
    rawCostUsd,
    markupBps: model.pricing.markupBps,
    minimumChargeUsdMicros: model.pricing.minimumUsdMicros,
  });
}
