export const USD_MICROS_PER_CENT = 10_000;
export const USD_MICROS_PER_USD = 1_000_000;

export function centsToUsdMicros(cents: number) {
  return cents * USD_MICROS_PER_CENT;
}

export function usdMicrosToUsd(usdMicros: number) {
  return usdMicros / USD_MICROS_PER_USD;
}

export function usdMicrosToCentsRoundedDown(usdMicros: number) {
  return Math.floor(usdMicros / USD_MICROS_PER_CENT);
}

export function usdToMicrosCeil(value: number | string) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const decimalMatch = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);

    if (decimalMatch) {
      const whole = Number(decimalMatch[1]) * USD_MICROS_PER_USD;
      const fractional = decimalMatch[2] ?? "";
      const micros = Number(fractional.slice(0, 6).padEnd(6, "0"));
      const hasRemainder = /[1-9]/.test(fractional.slice(6));

      return whole + micros + (hasRemainder ? 1 : 0);
    }

    const parsed = Number(trimmed);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }

    return Math.ceil(parsed * USD_MICROS_PER_USD - 1e-9);
  }

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.ceil(value * USD_MICROS_PER_USD - 1e-9);
}

export function formatUsdFromMicros(
  usdMicros: number,
  options: { preciseSmallAmounts?: boolean } = {},
) {
  const value = usdMicrosToUsd(usdMicros);
  const absMicros = Math.abs(usdMicros);

  if (
    options.preciseSmallAmounts &&
    absMicros > 0 &&
    absMicros < USD_MICROS_PER_CENT
  ) {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }).format(value);
  }

  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function chargeWithMarkupUsdMicros({
  rawCostUsd,
  markupBps,
  minimumChargeUsdMicros,
}: {
  rawCostUsd: number | string;
  markupBps: number;
  minimumChargeUsdMicros: number;
}) {
  const rawCostUsdMicros = usdToMicrosCeil(rawCostUsd);
  const markedUpUsdMicros = Math.ceil(
    (rawCostUsdMicros * (10_000 + markupBps)) / 10_000,
  );
  const chargedAmountUsdMicros = Math.max(
    minimumChargeUsdMicros,
    markedUpUsdMicros,
  );

  return {
    rawCostUsdMicros,
    chargedAmountUsdMicros,
    markupAmountUsdMicros: Math.max(
      0,
      chargedAmountUsdMicros - rawCostUsdMicros,
    ),
  };
}
