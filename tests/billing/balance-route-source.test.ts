import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("billing balance API source", () => {
  it("returns additive trial eligibility fields when available", async () => {
    const source = await readFile("app/api/v1/billing/balance/route.ts", "utf8");

    expect(source).toContain("resolveCheckoutMode");
    expect(source).toContain('supabase.rpc("trial_used")');
    expect(source).toContain("trial_used");
    expect(source).toContain("checkout_mode");
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
});
