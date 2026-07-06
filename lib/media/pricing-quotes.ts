import { chargeWithMarkupUsdMicros, usdToMicrosCeil } from "@/lib/billing/money";
import type { MediaModel, MediaPricingFormula, MediaPricingQuote } from "@/lib/media/types";

export function quoteMediaJob({
  model,
  parameters,
}: {
  model: MediaModel;
  parameters: Record<string, unknown>;
}): MediaPricingQuote {
  const formula = model.pricingFormula;

  switch (formula.type as string) {
    case "nano_banana":
      return quoteProviderCost(
        model,
        "parameter_quote",
        "nano_banana",
        quoteNanoBananaProviderCost(formula, parameters),
        {
          num_images: integerParameter(parameters, stringValue(formula.image_parameter) ?? "num_images", 1),
          resolution: stringParameter(parameters, stringValue(formula.resolution_parameter) ?? "resolution", "1K"),
          enable_web_search: booleanParameter(
            parameters,
            stringValue(formula.web_search_parameter) ?? "enable_web_search",
            false,
          ),
        },
      );
    case "gemini_unit":
      return quoteProviderCost(
        model,
        "parameter_quote",
        "gemini_unit",
        usdToMicrosCeil(stringValue(formula.provider_rate_usd_per_generation) ?? "1"),
        {},
      );
    case "veo_seconds":
    case "seedance_seconds":
    case "kling_seconds":
      return quoteProviderCost(
        model,
        "parameter_quote",
        formula.type,
        quotePerSecondProviderCost(formula, parameters),
        quotePerSecondInputs(formula, parameters),
      );
    case "music_minutes":
      return quoteMusic(model, formula, parameters);
    case "gpt_image_sized": {
      const sizeParameter = stringValue(formula.size_parameter) ?? "image_size";
      const tier = gptImageSizeTier(parameters[sizeParameter]);
      return quoteProviderCost(
        model,
        "conservative_quote",
        "gpt_image_sized",
        quoteGptImageSizedProviderCost(formula, parameters, tier),
        {
          num_images: integerParameter(parameters, stringValue(formula.image_parameter) ?? "num_images", 1),
          quality: stringParameter(parameters, stringValue(formula.quality_parameter) ?? "quality", "high"),
          size_tier: tier,
        },
      );
    }
    case "gpt_image_conservative":
      return quoteProviderCost(
        model,
        "conservative_quote",
        "gpt_image_conservative",
        quoteGptImageProviderCost(formula, parameters),
        {
          num_images: integerParameter(parameters, stringValue(formula.image_parameter) ?? "num_images", 1),
          quality: stringParameter(parameters, stringValue(formula.quality_parameter) ?? "quality", "high"),
        },
      );
    case "flat_generation":
      return quoteProviderCost(
        model,
        "parameter_quote",
        "flat_generation",
        usdToMicrosCeil(stringValue(formula.provider_rate_usd) ?? "0"),
        {},
      );
    case "static":
    default:
      return {
        estimateKind: "static",
        providerCostUsdMicros: model.pricing.reserveUsdMicros,
        chargedAmountUsdMicros: model.pricing.reserveUsdMicros,
        reservedAmountUsdMicros: model.pricing.reserveUsdMicros,
        markupAmountUsdMicros: 0,
        formula: "static",
        inputs: {},
      };
  }
}

export function serializeMediaPricingQuote(quote: MediaPricingQuote) {
  return {
    estimate_kind: quote.estimateKind,
    provider_cost_usd_micros: quote.providerCostUsdMicros,
    charged_amount_usd_micros: quote.chargedAmountUsdMicros,
    reserved_amount_usd_micros: quote.reservedAmountUsdMicros,
    markup_amount_usd_micros: quote.markupAmountUsdMicros,
    formula: quote.formula,
    inputs: quote.inputs,
  };
}

export function deserializeMediaPricingQuote(value: unknown): MediaPricingQuote | null {
  if (!isRecord(value) || !isRecord(value.inputs)) {
    return null;
  }

  const estimateKind = estimateKindValue(value.estimate_kind);
  const providerCostUsdMicros = finiteNumberValue(value.provider_cost_usd_micros);
  const chargedAmountUsdMicros = finiteNumberValue(value.charged_amount_usd_micros);
  const reservedAmountUsdMicros = finiteNumberValue(value.reserved_amount_usd_micros);
  const markupAmountUsdMicros = finiteNumberValue(value.markup_amount_usd_micros);

  if (
    !estimateKind ||
    providerCostUsdMicros === null ||
    chargedAmountUsdMicros === null ||
    reservedAmountUsdMicros === null ||
    markupAmountUsdMicros === null ||
    typeof value.formula !== "string"
  ) {
    return null;
  }

  return {
    estimateKind,
    providerCostUsdMicros,
    chargedAmountUsdMicros,
    reservedAmountUsdMicros,
    markupAmountUsdMicros,
    formula: value.formula,
    inputs: value.inputs,
  };
}

function quoteProviderCost(
  model: MediaModel,
  estimateKind: MediaPricingQuote["estimateKind"],
  formula: string,
  providerCostUsdMicros: number,
  inputs: Record<string, unknown>,
): MediaPricingQuote {
  const charge = chargeWithMarkupUsdMicros({
    rawCostUsd: providerCostUsdMicros / 1_000_000,
    markupBps: model.pricing.markupBps,
    minimumChargeUsdMicros: model.pricing.minimumUsdMicros,
  });

  return {
    estimateKind,
    providerCostUsdMicros: charge.rawCostUsdMicros,
    chargedAmountUsdMicros: charge.chargedAmountUsdMicros,
    reservedAmountUsdMicros: charge.chargedAmountUsdMicros,
    markupAmountUsdMicros: charge.markupAmountUsdMicros,
    formula,
    inputs,
  };
}

function quoteNanoBananaProviderCost(
  formula: MediaPricingFormula,
  parameters: Record<string, unknown>,
) {
  const imageParameter = stringValue(formula.image_parameter) ?? "num_images";
  const resolutionParameter = stringValue(formula.resolution_parameter) ?? "resolution";
  const webSearchParameter = stringValue(formula.web_search_parameter) ?? "enable_web_search";
  const numImages = integerParameter(parameters, imageParameter, 1);
  const resolution = stringParameter(parameters, resolutionParameter, "1K");
  const fourKMultiplier = positiveNumberValue(formula.four_k_multiplier) ?? 1;
  const providerRateUsdPerImageMicros = usdToMicrosCeil(stringValue(formula.provider_rate_usd_per_image) ?? "0");
  const providerRateUsdPerWebSearchMicros = usdToMicrosCeil(
    stringValue(formula.provider_rate_usd_per_web_search) ?? "0",
  );
  const multiplier = resolution.toLowerCase() === "4k" ? fourKMultiplier : 1;
  const imageCostUsdMicros = Math.ceil(providerRateUsdPerImageMicros * numImages * multiplier);
  const webSearchCostUsdMicros = booleanParameter(parameters, webSearchParameter, false)
    ? providerRateUsdPerWebSearchMicros * numImages
    : 0;

  return imageCostUsdMicros + webSearchCostUsdMicros;
}

function quotePerSecondProviderCost(
  formula: MediaPricingFormula,
  parameters: Record<string, unknown>,
) {
  const durationSeconds = parseDurationSeconds(
    parameters[stringValue(formula.duration_parameter) ?? "duration"],
  );
  const resolution = stringParameter(
    parameters,
    stringValue(formula.resolution_parameter) ?? "resolution",
    "720p",
  );
  const generateAudio = booleanParameter(
    parameters,
    stringValue(formula.audio_parameter) ?? "generate_audio",
    false,
  );
  const rateUsdMicrosPerSecond = rateUsdMicrosForResolution(formula.rates, resolution, generateAudio);

  return rateUsdMicrosPerSecond * durationSeconds;
}

function quotePerSecondInputs(
  formula: MediaPricingFormula,
  parameters: Record<string, unknown>,
) {
  return {
    duration_seconds: parseDurationSeconds(parameters[stringValue(formula.duration_parameter) ?? "duration"]),
    resolution: stringParameter(parameters, stringValue(formula.resolution_parameter) ?? "resolution", "720p"),
    generate_audio: booleanParameter(
      parameters,
      stringValue(formula.audio_parameter) ?? "generate_audio",
      false,
    ),
  };
}

function quoteMusic(
  model: MediaModel,
  _formula: MediaPricingFormula,
  parameters: Record<string, unknown>,
): MediaPricingQuote {
  const musicLengthMs = positiveNumberValue(parameters.music_length_ms) ?? positiveNumberValue(parameters.musicLengthMs) ?? 60_000;
  const chargedAmountUsdMicros = Math.max(200_000, Math.ceil((musicLengthMs / 60_000) * 200_000));
  const divisor = 10_000 + model.pricing.markupBps;
  const providerCostUsdMicros = divisor > 0
    ? Math.ceil((chargedAmountUsdMicros * 10_000) / divisor)
    : chargedAmountUsdMicros;

  return {
    estimateKind: "parameter_quote",
    providerCostUsdMicros,
    chargedAmountUsdMicros,
    reservedAmountUsdMicros: chargedAmountUsdMicros,
    markupAmountUsdMicros: Math.max(0, chargedAmountUsdMicros - providerCostUsdMicros),
    formula: "music_minutes",
    inputs: { music_length_ms: musicLengthMs },
  };
}

const GPT_IMAGE_SIZE_PRESETS_MEGAPIXELS: Record<string, number> = {
  square_hd: 1.05, square: 0.27, portrait_4_3: 0.79,
  portrait_16_9: 0.59, landscape_4_3: 0.79, landscape_16_9: 0.59,
};
const GPT_IMAGE_SIZE_TIERS = [
  { tier: "standard", maxMegapixels: 2.1 },
  { tier: "large", maxMegapixels: 3.7 },
  { tier: "max", maxMegapixels: 8.3 },
] as const;

export function gptImageSizeTier(imageSize: unknown): "standard" | "large" | "max" {
  if (isRecord(imageSize)) {
    const width = positiveNumberValue(imageSize.width);
    const height = positiveNumberValue(imageSize.height);
    if (!width || !height) throw new Error("media_quote_unsupported_size");
    const megapixels = (width * height) / 1_000_000;
    const match = GPT_IMAGE_SIZE_TIERS.find((entry) => megapixels <= entry.maxMegapixels);
    if (!match) throw new Error("media_quote_unsupported_size");
    return match.tier;
  }
  const name = stringValue(imageSize);
  if (!name) return "standard";
  if (name === "auto") return "large";
  if (name in GPT_IMAGE_SIZE_PRESETS_MEGAPIXELS) return "standard";
  throw new Error("media_quote_unsupported_size");
}

function quoteGptImageSizedProviderCost(
  formula: MediaPricingFormula,
  parameters: Record<string, unknown>,
  tier: "standard" | "large" | "max",
) {
  const rates = recordValue(formula.provider_rate_usd_by_quality_and_size);
  const quality = stringParameter(parameters, stringValue(formula.quality_parameter) ?? "quality", "high");
  const normalizedQuality = quality === "auto" ? "high" : quality;
  const numImages = integerParameter(parameters, stringValue(formula.image_parameter) ?? "num_images", 1);
  const tierRates = recordValue(rates?.[normalizedQuality]) ?? recordValue(rates?.high);
  const rate = stringValue(tierRates?.[tier]) ?? stringValue(tierRates?.max) ?? "0";
  return usdToMicrosCeil(rate) * numImages;
}

function quoteGptImageProviderCost(
  formula: MediaPricingFormula,
  parameters: Record<string, unknown>,
) {
  const providerRateUsdByQuality = recordValue(formula.provider_rate_usd_by_quality);
  const quality = stringParameter(parameters, stringValue(formula.quality_parameter) ?? "quality", "high");
  const numImages = integerParameter(parameters, stringValue(formula.image_parameter) ?? "num_images", 1);
  const qualityRate = stringValue(providerRateUsdByQuality?.[quality])
    ?? stringValue(providerRateUsdByQuality?.high)
    ?? "0";

  return usdToMicrosCeil(qualityRate) * numImages;
}

function parseDurationSeconds(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;

  if (normalized === "auto") {
    throw new Error("media_quote_requires_explicit_duration");
  }

  if (typeof normalized === "number" && Number.isFinite(normalized) && normalized > 0) {
    return Math.ceil(normalized);
  }

  if (typeof normalized === "string") {
    const match = /^(\d+)(?:s)?$/.exec(normalized);
    if (match) {
      return Number(match[1]);
    }
  }

  throw new Error("media_quote_requires_explicit_duration");
}

function rateUsdMicrosForResolution(
  value: unknown,
  resolution: string,
  generateAudio: boolean,
) {
  const rates = recordValue(value);
  if (!rates) {
    return 0;
  }

  const resolutionKey = normalizedResolutionKey(resolution);
  const configuredRate =
    rates[resolutionKey]
    ?? rates[resolution]
    ?? rates.default;

  if (typeof configuredRate === "string" || typeof configuredRate === "number") {
    return usdToMicrosCeil(configuredRate);
  }

  const audioRates = recordValue(configuredRate);
  const selectedRate = audioRates?.[generateAudio ? "audio" : "no_audio"];

  return usdToMicrosCeil(stringValue(selectedRate) ?? "0");
}

function integerParameter(
  parameters: Record<string, unknown>,
  key: string,
  fallback: number,
) {
  const value = parameters[key];
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return fallback;
}

function stringParameter(
  parameters: Record<string, unknown>,
  key: string,
  fallback: string,
) {
  return stringValue(parameters[key]) ?? fallback;
}

function booleanParameter(
  parameters: Record<string, unknown>,
  key: string,
  fallback: boolean,
) {
  return typeof parameters[key] === "boolean" ? parameters[key] : fallback;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function estimateKindValue(value: unknown): MediaPricingQuote["estimateKind"] | null {
  return value === "static" || value === "parameter_quote" || value === "conservative_quote"
    ? value
    : null;
}

function normalizedResolutionKey(value: string) {
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
