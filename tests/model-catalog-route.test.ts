import { afterEach, describe, expect, it, vi } from "vitest";

const solMetadata = {
  provider_model_id: "openai/gpt-5.6-sol",
  is_default: true,
  replaces_model_ids: ["openai/gpt-5.5"],
  supports_reasoning: true,
  supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
  default_reasoning_effort: "medium",
};

function model(metadata: unknown = solMetadata) {
  return {
    id: "rule_1",
    provider: "vercel-ai-gateway",
    model: "openai/gpt-5.6-sol",
    operation: "chat",
    display_name: "GPT-5.6 Sol",
    markup_bps: 2_000,
    minimum_charge_usd_micros: 1,
    reserve_amount_usd_micros: 100_000,
    enabled: true,
    metadata,
  };
}

async function loadRoute(
  metadata: unknown,
  gatewayCapabilities: Record<string, unknown> | null,
  catalog = [model(metadata)],
) {
  vi.doMock("@/lib/api/auth", () => ({
    requireApiAuth: vi.fn(async () => ({
      ok: true,
      auth: { user: { id: "user_1" } },
    })),
  }));
  vi.doMock("@/lib/billing/model-pricing", () => ({
    listHostedChatModels: vi.fn(async () => catalog),
  }));
  const getModelCapabilities = vi.fn(async () => gatewayCapabilities);
  vi.doMock("@/lib/ai/model-capabilities", () => ({
    getModelCapabilities,
    applyMarkupToPriceUsd: vi.fn((price: number | null) => price),
  }));

  const { GET } = await import("@/app/api/v1/models/route");
  const response = await GET(new Request("https://example.test/api/v1/models"));
  return { response, getModelCapabilities };
}

describe("hosted chat model catalog route", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/billing/model-pricing");
    vi.doUnmock("@/lib/ai/model-capabilities");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("publishes Kimi as the sole default while Sol retains the GPT-5.5 replacement", async () => {
    const sol = model({
      ...solMetadata,
      is_default: false,
    });
    const kimi = {
      ...model({
        provider_model_id: "moonshotai/kimi-k2.6",
        is_default: true,
        replaces_model_ids: [],
        supports_reasoning: true,
        supported_reasoning_efforts: [],
        default_reasoning_effort: null,
      }),
      id: "rule_kimi",
      model: "moonshotai/kimi-k2.6",
      display_name: "Kimi K2.6",
    };

    const { response } = await loadRoute(solMetadata, null, [sol, kimi]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.map(
        (entry: {
          id: string;
          is_default: boolean;
          replaces_model_ids: string[];
        }) => ({
          id: entry.id,
          is_default: entry.is_default,
          replaces_model_ids: entry.replaces_model_ids,
        }),
      ),
    ).toEqual([
      {
        id: "openai/gpt-5.6-sol",
        is_default: false,
        replaces_model_ids: ["openai/gpt-5.5"],
      },
      {
        id: "moonshotai/kimi-k2.6",
        is_default: true,
        replaces_model_ids: [],
      },
    ]);
    expect(
      body.data.filter((entry: { is_default: boolean }) => entry.is_default),
    ).toHaveLength(1);
  });

  it("publishes the database effort contract instead of Gateway's generic flag", async () => {
    const { response } = await loadRoute(solMetadata, {
      context_length: 1_000_000,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      supports_reasoning: false,
      supports_tools: true,
      supports_vision: true,
      supports_files: false,
      pricing_input_per_mtok_usd: 5,
      pricing_output_per_mtok_usd: 30,
      pricing_cached_input_per_mtok_usd: 0.5,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      object: "list",
      data: [
        {
          id: "openai/gpt-5.6-sol",
          is_default: true,
          replaces_model_ids: ["openai/gpt-5.5"],
          capabilities: {
            context_length: 1_000_000,
            supports_reasoning: true,
            supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
            default_reasoning_effort: "medium",
            supports_tools: true,
          },
          pricing: {
            input_per_mtok_usd: 5,
            output_per_mtok_usd: 30,
            cached_input_per_mtok_usd: 0.5,
            markup_bps: 2_000,
          },
        },
      ],
    });
  });

  it("preserves backend reasoning controls when Gateway enrichment fails", async () => {
    const { response } = await loadRoute(solMetadata, null);

    await expect(response.json()).resolves.toEqual({
      object: "list",
      data: [
        {
          id: "openai/gpt-5.6-sol",
          object: "model",
          created: 0,
          owned_by: "woven",
          display_name: "GPT-5.6 Sol",
          is_default: true,
          replaces_model_ids: ["openai/gpt-5.5"],
          capabilities: {
            context_length: null,
            input_modalities: [],
            output_modalities: [],
            supports_reasoning: true,
            supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
            default_reasoning_effort: "medium",
            supports_tools: false,
            supports_vision: false,
            supports_files: false,
          },
          pricing: null,
        },
      ],
    });
  });

  it("warns and publishes the safe fallback for invalid metadata", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { response } = await loadRoute(
      {
        is_default: true,
        replaces_model_ids: ["openai/gpt-5.5"],
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "imaginary"],
        default_reasoning_effort: "low",
      },
      null,
    );

    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          capabilities: {
            supports_reasoning: false,
            supported_reasoning_efforts: [],
            default_reasoning_effort: null,
          },
        },
      ],
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "[model-catalog] invalid reasoning metadata",
      {
        modelId: "openai/gpt-5.6-sol",
        reason: "supported_reasoning_efforts contains unsupported value: imaginary",
      },
    );
  });

  it("rejects invalid selection policy before Gateway enrichment", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { response, getModelCapabilities } = await loadRoute(null, null);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "Hosted model catalog metadata is invalid.",
        type: "invalid_model_catalog",
        code: "invalid_model_catalog",
      },
    });
    expect(getModelCapabilities).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[model-catalog] invalid selection policy",
      { reason: "openai/gpt-5.6-sol: metadata must be an object" },
    );
  });
});
