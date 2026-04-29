export type GatewayGeneration = {
  id: string;
  total_cost?: number;
  usage?: number;
  model?: string;
  provider_name?: string;
  streamed?: boolean;
  tokens_prompt?: number;
  tokens_completion?: number;
  native_tokens_prompt?: number;
  native_tokens_completion?: number;
  native_tokens_reasoning?: number;
  native_tokens_cached?: number;
};

export function getAiGatewayConfig() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const baseUrl =
    process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1";

  if (!apiKey) {
    throw new Error("Missing AI_GATEWAY_API_KEY.");
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
}

export async function lookupGatewayGeneration(id: string) {
  const { apiKey, baseUrl } = getAiGatewayConfig();
  const response = await fetch(
    `${baseUrl}/generation?id=${encodeURIComponent(id)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: GatewayGeneration }
    | null;

  return payload?.data ?? null;
}

export function gatewayChatCompletionsUrl() {
  const { baseUrl } = getAiGatewayConfig();

  return `${baseUrl}/chat/completions`;
}

export function gatewayAuthorizationHeader() {
  const { apiKey } = getAiGatewayConfig();

  return `Bearer ${apiKey}`;
}
