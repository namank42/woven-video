import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

type BalanceRouteScenario = {
  hasAccess?: boolean;
  hasPerpetualAccess?: boolean;
  subscriptionRows?: Array<{
    status: "trialing" | "active" | "past_due" | "unpaid" | "canceled";
    trial_end: string | null;
  }>;
  subscriptionError?: { message: string } | null;
  trialUsed?: boolean;
};

async function callBalanceRoute({
  hasAccess = true,
  hasPerpetualAccess = false,
  subscriptionRows = [],
  subscriptionError = null,
  trialUsed = false,
}: BalanceRouteScenario = {}) {
  const subscriptionOrder = vi.fn(async () => ({
    data: subscriptionRows,
    error: subscriptionError,
  }));
  const subscriptionsQuery = {
    select: vi.fn(() => subscriptionsQuery),
    in: vi.fn(() => subscriptionsQuery),
    order: subscriptionOrder,
  };
  const licensesQuery = {
    select: vi.fn(() => licensesQuery),
    eq: vi.fn(() => licensesQuery),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  };
  const rpc = vi.fn(async (name: string) => {
    switch (name) {
      case "get_billing_balance":
        return {
          data: [{ balance_usd_micros: 2_500_000, currency: "usd" }],
          error: null,
        };
      case "has_access":
        return { data: hasAccess, error: null };
      case "has_active_license":
        return { data: hasPerpetualAccess, error: null };
      case "trial_used":
        return { data: trialUsed, error: null };
      default:
        throw new Error(`Unexpected RPC: ${name}`);
    }
  });
  const from = vi.fn((table: string) => {
    if (table === "licenses") {
      return licensesQuery;
    }
    if (table === "subscriptions") {
      return subscriptionsQuery;
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  vi.doMock("@/lib/api/auth", () => ({
    requireApiAuth: vi.fn(async () => ({
      ok: true,
      auth: {
        supabase: { rpc, from },
        user: { id: "user_1" },
      },
    })),
  }));

  const { GET } = await import("@/app/api/v1/billing/balance/route");
  const response = await GET(
    new Request("https://example.test/api/v1/billing/balance"),
  );

  return {
    body: await response.json(),
    from,
    response,
    subscriptionOrder,
  };
}

describe("billing balance API source", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns additive trial eligibility fields when available", async () => {
    const source = await readFile("app/api/v1/billing/balance/route.ts", "utf8");

    expect(source).toContain("resolveCheckoutMode");
    expect(source).toContain('supabase.rpc("trial_used")');
    expect(source).toContain("trial_used");
    expect(source).toContain("checkout_mode");
    expect(source).toContain("payment_required");
    expect(source).toContain("resolvePaymentRequired");
    expect(source).toContain('typeof trialUsedData === "boolean"');
  });

  it("publishes a trial-only offline access expiry", async () => {
    const source = await readFile("app/api/v1/billing/balance/route.ts", "utf8");

    expect(source).toContain("resolveOfflineAccessExpiry");
    expect(source).toContain('supabase.rpc("has_active_license")');
    expect(source).toContain('.from("subscriptions")');
    expect(source).toContain("offline_access_expires_at");
    expect(source).toContain("accessSourceResolution.ok");
  });

  it("does not use delinquent subscriptions as offline access sources", async () => {
    const source = await readFile("app/api/v1/billing/balance/route.ts", "utf8");

    expect(source).not.toContain('subscription.status === "past_due"');
    expect(source).not.toContain('subscription.status === "unpaid"');
  });

  it("omits license serialization when the access-source query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { body, response } = await callBalanceRoute({
      subscriptionError: { message: "query failed" },
    });

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("license");
    expect(body).not.toHaveProperty("payment_required");
    expect(body).toMatchObject({
      trial_used: false,
      checkout_mode: "none",
    });
  });

  it("omits license serialization for ambiguous trial access", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { body, response } = await callBalanceRoute({
      subscriptionRows: [
        {
          status: "trialing",
          trial_end: "2026-08-03T10:00:00.000Z",
        },
        {
          status: "trialing",
          trial_end: "2026-08-04T10:00:00.000Z",
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("license");
    expect(body).toMatchObject({
      trial_used: false,
      checkout_mode: "none",
    });
  });

  it("omits license serialization for an invalid trial timestamp", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { body, response } = await callBalanceRoute({
      subscriptionRows: [
        {
          status: "trialing",
          trial_end: "not-a-date",
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("license");
    expect(body).toMatchObject({
      trial_used: false,
      checkout_mode: "none",
    });
  });

  it("serializes ordinary inactive access with no payment recovery", async () => {
    const { body, from, response, subscriptionOrder } = await callBalanceRoute({
      hasAccess: false,
    });

    expect(response.status).toBe(200);
    expect(body).toEqual({
      currency: "usd",
      balance_usd_micros: 2_500_000,
      balance_usd: 2.5,
      license: {
        active: false,
        granted_at: null,
      },
      trial_used: false,
      payment_required: false,
      checkout_mode: "trial",
    });
    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("subscriptions");
    expect(subscriptionOrder).toHaveBeenCalledOnce();
  });

  it.each(["past_due", "unpaid"] as const)(
    "requires payment recovery for inactive %s subscriptions",
    async (status) => {
      const { body, response, subscriptionOrder } = await callBalanceRoute({
        hasAccess: false,
        subscriptionRows: [{ status, trial_end: null }],
        trialUsed: true,
      });

      expect(response.status).toBe(200);
      expect(body.license).toEqual({ active: false, granted_at: null });
      expect(body.payment_required).toBe(true);
      expect(body.checkout_mode).toBe("none");
      expect(subscriptionOrder).toHaveBeenCalledOnce();
    },
  );

  it("does not require payment recovery for grandfathered access with a delinquent row", async () => {
    const { body, response } = await callBalanceRoute({
      hasPerpetualAccess: true,
      subscriptionRows: [{ status: "unpaid", trial_end: null }],
      trialUsed: true,
    });

    expect(response.status).toBe(200);
    expect(body.license).toEqual({ active: true, granted_at: null });
    expect(body.payment_required).toBe(false);
    expect(body.checkout_mode).toBe("none");
  });

  it("serializes the exact expiry for trial-only active access", async () => {
    const trialEnd = "2026-08-03T10:00:00.000Z";

    const { body, response } = await callBalanceRoute({
      subscriptionRows: [
        {
          status: "trialing",
          trial_end: trialEnd,
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(body).toEqual({
      currency: "usd",
      balance_usd_micros: 2_500_000,
      balance_usd: 2.5,
      license: {
        active: true,
        granted_at: null,
        offline_access_expires_at: trialEnd,
      },
      trial_used: false,
      payment_required: false,
      checkout_mode: "none",
    });
  });
});
