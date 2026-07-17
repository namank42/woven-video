import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiAuth: vi.fn(),
  licenseGateResponse: vi.fn(),
  getHostedChatModel: vi.fn(),
  gatewayChatCompletionsUrl: vi.fn(),
  gatewayAuthorizationHeader: vi.fn(),
  lookupGatewayGeneration: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireApiAuth: mocks.requireApiAuth,
}));
vi.mock("@/lib/api/license", () => ({
  licenseGateResponse: mocks.licenseGateResponse,
}));
vi.mock("@/lib/billing/model-pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/model-pricing")>();
  return { ...actual, getHostedChatModel: mocks.getHostedChatModel };
});
vi.mock("@/lib/ai/vercel-gateway", () => ({
  gatewayChatCompletionsUrl: mocks.gatewayChatCompletionsUrl,
  gatewayAuthorizationHeader: mocks.gatewayAuthorizationHeader,
  lookupGatewayGeneration: mocks.lookupGatewayGeneration,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

import {
  maxDuration,
  POST,
} from "@/app/api/v1/chat/completions/route";

const kimiK3Rule = {
  id: "rule_kimi_k3",
  provider: "vercel-ai-gateway",
  model: "moonshotai/kimi-k3",
  operation: "chat",
  display_name: "Kimi K3",
  markup_bps: 2_000,
  minimum_charge_usd_micros: 1,
  reserve_amount_usd_micros: 50_000,
  enabled: true,
  metadata: {
    is_default: true,
    replaces_model_ids: ["moonshotai/kimi-k2.6"],
  },
};

function createAdmin() {
  const single = vi.fn(async () => ({ data: { id: "job_1" }, error: null }));
  const select = vi.fn(() => ({ single }));
  const generationJobInsert = vi.fn(() => ({ select }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const generationJobUpdate = vi.fn(() => ({ eq: updateEq }));
  const usageInsert = vi.fn(async () => ({ error: null }));
  const from = vi.fn((table: string) => {
    if (table === "generation_jobs") {
      return { insert: generationJobInsert, update: generationJobUpdate };
    }
    if (table === "usage_events") {
      return { insert: usageInsert };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  const rpc = vi.fn(async (...args: [string, Record<string, unknown>]) => {
    void args;
    return { error: null };
  });

  return {
    admin: { from, rpc },
    generationJobInsert,
    usageInsert,
    rpc,
  };
}

function request(model: string) {
  return new Request("https://example.test/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 32,
      stream: false,
    }),
  });
}

describe("hosted chat model policy", () => {
  it("allows hosted chat streams to run up to Vercel's Pro limit", () => {
    expect(maxDuration).toBe(800);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.requireApiAuth.mockResolvedValue({
      ok: true,
      auth: { user: { id: "user_1" }, supabase: {} },
    });
    mocks.licenseGateResponse.mockResolvedValue(null);
    mocks.gatewayChatCompletionsUrl.mockReturnValue(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
    );
    mocks.gatewayAuthorizationHeader.mockReturnValue("Bearer test-key");
    mocks.lookupGatewayGeneration.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("executes K3 under its exact ID and settles Gateway cost", async () => {
    const admin = createAdmin();
    mocks.createSupabaseAdminClient.mockReturnValue(admin.admin);
    mocks.getHostedChatModel.mockResolvedValue(kimiK3Rule);
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "generation_1",
          model: "moonshotai/kimi-k3",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: "ok" },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_cost: "0.0001",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await POST(request("moonshotai/kimi-k3"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-woven-job-id")).toBe("job_1");
    expect(body.model).toBe("moonshotai/kimi-k3");
    expect(mocks.getHostedChatModel).toHaveBeenCalledWith("moonshotai/kimi-k3");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const gatewayBody = JSON.parse(String(mocks.fetch.mock.calls[0]?.[1]?.body));
    expect(gatewayBody).toMatchObject({
      model: "moonshotai/kimi-k3",
      providerOptions: { gateway: { sort: "ttft" } },
    });
    expect(admin.generationJobInsert).toHaveBeenCalledOnce();
    expect(admin.usageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: "job_1",
        model: "moonshotai/kimi-k3",
        raw_provider_cost: 0.0001,
        charged_amount_usd_micros: 120,
      }),
    );
    expect(admin.rpc.mock.calls.map(([name]) => name)).toEqual([
      "reserve_balance",
      "settle_balance_reservation",
    ]);
    expect(admin.rpc.mock.calls[1]?.[1]).toMatchObject({
      p_job_id: "job_1",
      p_final_cost_usd_micros: 120,
    });
  });

  it("rejects disabled K2.6 before Gateway, job creation, or billing", async () => {
    mocks.getHostedChatModel.mockResolvedValue(null);

    const response = await POST(request("moonshotai/kimi-k2.6"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "Hosted model is not enabled: moonshotai/kimi-k2.6",
        type: "model_not_found",
        code: "model_not_found",
      },
    });
    expect(mocks.getHostedChatModel).toHaveBeenCalledWith(
      "moonshotai/kimi-k2.6",
    );
    expect(mocks.gatewayChatCompletionsUrl).not.toHaveBeenCalled();
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
