import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

import {
  getHostedChatModel,
  listHostedChatModels,
} from "@/lib/billing/model-pricing";

describe("listHostedChatModels", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("scopes the model catalog query to the hosted Gateway provider", async () => {
    const order = vi.fn(async () => ({ data: [], error: null }));
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const from = vi.fn(() => query);
    mocks.createSupabaseAdminClient.mockReturnValue({ from });

    await expect(listHostedChatModels()).resolves.toEqual([]);

    expect(from).toHaveBeenCalledWith("model_pricing_rules");
    expect(query.eq.mock.calls).toEqual([
      ["provider", "vercel-ai-gateway"],
      ["operation", "chat"],
      ["enabled", true],
    ]);
    expect(order).toHaveBeenCalledWith("display_name");
  });

  it("requires an exact enabled row for a direct hosted model lookup", async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const from = vi.fn(() => query);
    mocks.createSupabaseAdminClient.mockReturnValue({ from });

    await expect(getHostedChatModel("moonshotai/kimi-k2.6")).resolves.toBeNull();

    expect(from).toHaveBeenCalledWith("model_pricing_rules");
    expect(query.eq.mock.calls).toEqual([
      ["provider", "vercel-ai-gateway"],
      ["operation", "chat"],
      ["model", "moonshotai/kimi-k2.6"],
      ["enabled", true],
    ]);
    expect(maybeSingle).toHaveBeenCalledOnce();
  });
});
