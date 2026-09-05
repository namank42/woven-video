import { describe, expect, it, vi } from "vitest";
import { resolveTelemetryIdentity } from "../../supabase/functions/telemetry-ingest/auth.ts";

describe("telemetry identity verification", () => {
  const options = () => ({
    anonKey: "legacy-anon", publishableKeysJSON: JSON.stringify({ default: "sb_publishable_known" }),
    verifyUser: vi.fn(async () => ({ id: "verified-user" })),
  });
  it("admits only exact configured public keys without user identity", async () => {
    for (const key of ["legacy-anon", "sb_publishable_known"]) {
      const dependencies = options();
      expect(await resolveTelemetryIdentity(new Request("https://example.test", { headers: { apikey: key } }), dependencies)).toBeNull();
      expect(dependencies.verifyUser).not.toHaveBeenCalled();
    }
  });
  it("rejects missing, unknown and privileged keys", async () => {
    for (const key of ["", "unknown", "sb_publishable_other", "sb_secret_known", "service-role"]) {
      await expect(resolveTelemetryIdentity(new Request("https://example.test", { headers: { apikey: key } }), options())).rejects.toThrow();
    }
  });
  it("requires server verification of user JWTs even alongside a valid public key", async () => {
    const dependencies = options();
    const request = new Request("https://example.test", { headers: { apikey: "sb_publishable_known", Authorization: "Bearer user-jwt" } });
    expect(await resolveTelemetryIdentity(request, dependencies)).toBe("verified-user");
    expect(dependencies.verifyUser).toHaveBeenCalledWith(request);
    dependencies.verifyUser.mockRejectedValue(new Error("invalid-or-expired"));
    await expect(resolveTelemetryIdentity(request, dependencies)).rejects.toThrow();
  });
  it("rejects malformed authorization instead of silently using the public key", async () => {
    for (const authorization of ["", "Basic user", "Bearer", "Bearer two tokens"]) {
      await expect(resolveTelemetryIdentity(new Request("https://example.test", {
        headers: { apikey: "sb_publishable_known", Authorization: authorization },
      }), options())).rejects.toThrow();
    }
  });
  it("fails closed for malformed platform key dictionaries", async () => {
    for (const configured of ["invalid", "null", '["sb_publishable_known"]', '{}']) {
      await expect(resolveTelemetryIdentity(new Request("https://example.test", {
        headers: { apikey: "sb_publishable_known" },
      }), { ...options(), publishableKeysJSON: configured })).rejects.toThrow();
    }
  });
});
