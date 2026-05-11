import { getAiGatewayConfig } from "@/lib/ai/vercel-gateway";

export type ModelCapabilities = {
  context_length: number | null;
  input_modalities: string[];
  output_modalities: string[];
  supports_reasoning: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_files: boolean;
  pricing_input_per_mtok_usd: number | null;
  pricing_output_per_mtok_usd: number | null;
  pricing_cached_input_per_mtok_usd: number | null;
};

type GatewayEndpointPricing = {
  prompt?: string;
  completion?: string;
  input_cache_read?: string;
};

type GatewayEndpoint = {
  context_length?: number;
  supported_parameters?: string[];
  pricing?: GatewayEndpointPricing;
};

type GatewayModelInfo = {
  data?: {
    architecture?: {
      input_modalities?: string[];
      output_modalities?: string[];
    };
    endpoints?: GatewayEndpoint[];
  };
};

const CACHE_TTL_SUCCESS_MS = 5 * 60 * 1000;
const CACHE_TTL_FAILURE_MS = 30 * 1000;
const cache = new Map<string, { fetchedAt: number; value: ModelCapabilities | null }>();

function encodeModelPath(modelId: string) {
  return modelId.split("/").map(encodeURIComponent).join("/");
}

function safeNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchModelCapabilities(modelId: string): Promise<ModelCapabilities | null> {
  const { baseUrl } = getAiGatewayConfig();
  const url = `${baseUrl}/models/${encodeModelPath(modelId)}/endpoints`;

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[model-capabilities] gateway lookup failed", {
      modelId,
      url,
      status: response.status,
      body: body.slice(0, 500),
    });
    return null;
  }

  const payload = (await response.json().catch(() => null)) as GatewayModelInfo | null;
  const data = payload?.data;
  if (!data) {
    console.error("[model-capabilities] gateway lookup returned no data", { modelId });
    return null;
  }

  const endpoints = Array.isArray(data.endpoints) ? data.endpoints : [];
  if (endpoints.length === 0) return null;

  const supportedParams = new Set<string>();
  let maxContext = 0;
  for (const ep of endpoints) {
    if (typeof ep.context_length === "number") {
      maxContext = Math.max(maxContext, ep.context_length);
    }
    for (const param of ep.supported_parameters ?? []) {
      supportedParams.add(param);
    }
  }

  const inputModalities = data.architecture?.input_modalities ?? [];
  const outputModalities = data.architecture?.output_modalities ?? [];

  const firstPricing = endpoints[0]?.pricing;
  const promptPerToken = safeNumber(firstPricing?.prompt);
  const completionPerToken = safeNumber(firstPricing?.completion);
  const cachedPerToken = safeNumber(firstPricing?.input_cache_read);

  return {
    context_length: maxContext > 0 ? maxContext : null,
    input_modalities: inputModalities,
    output_modalities: outputModalities,
    supports_reasoning: supportedParams.has("reasoning"),
    supports_tools: supportedParams.has("tools"),
    supports_vision: inputModalities.includes("image"),
    supports_files: inputModalities.includes("file"),
    pricing_input_per_mtok_usd:
      promptPerToken !== null ? promptPerToken * 1_000_000 : null,
    pricing_output_per_mtok_usd:
      completionPerToken !== null ? completionPerToken * 1_000_000 : null,
    pricing_cached_input_per_mtok_usd:
      cachedPerToken !== null ? cachedPerToken * 1_000_000 : null,
  };
}

export async function getModelCapabilities(
  modelId: string,
): Promise<ModelCapabilities | null> {
  const cached = cache.get(modelId);
  if (cached) {
    const ttl = cached.value === null ? CACHE_TTL_FAILURE_MS : CACHE_TTL_SUCCESS_MS;
    if (Date.now() - cached.fetchedAt < ttl) {
      return cached.value;
    }
  }

  try {
    const value = await fetchModelCapabilities(modelId);
    cache.set(modelId, { fetchedAt: Date.now(), value });
    return value;
  } catch (error) {
    console.error("[model-capabilities] fetch threw", { modelId, error });
    if (cached) return cached.value;
    cache.set(modelId, { fetchedAt: Date.now(), value: null });
    return null;
  }
}

export function applyMarkupToPriceUsd(
  priceUsd: number | null,
  markupBps: number,
): number | null {
  if (priceUsd === null) return null;
  return priceUsd * (1 + markupBps / 10_000);
}
