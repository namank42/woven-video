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

  it("lists only enabled, visible hosted Gateway chat models", async () => {
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
    expect(query.select).toHaveBeenCalledWith(
      "id, provider, model, operation, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, catalog_visible, metadata",
    );
    expect(query.eq.mock.calls).toEqual([
      ["provider", "vercel-ai-gateway"],
      ["operation", "chat"],
      ["enabled", true],
      ["catalog_visible", true],
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

    await expect(getHostedChatModel("moonshotai/kimi-k3")).resolves.toBeNull();

    expect(from).toHaveBeenCalledWith("model_pricing_rules");
    expect(query.select).toHaveBeenCalledWith(
      "id, provider, model, operation, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, catalog_visible, metadata",
    );
    expect(query.eq.mock.calls).toEqual([
      ["provider", "vercel-ai-gateway"],
      ["operation", "chat"],
      ["model", "moonshotai/kimi-k3"],
      ["enabled", true],
    ]);
    expect(maybeSingle).toHaveBeenCalledOnce();
  });
});
