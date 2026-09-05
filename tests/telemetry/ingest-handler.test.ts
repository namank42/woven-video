import { describe, expect, it, vi } from "vitest";

import { handleTelemetryIngest } from "../../supabase/functions/telemetry-ingest/handler.ts";
import type {
  TelemetryBatchRequestV1,
  TelemetryBatchResponseV1,
  TelemetryEnvelopeV1,
  TelemetryIngestDependencies,
} from "../../supabase/functions/_shared/telemetry/types.ts";

const indexMocks = vi.hoisted(() => ({
  requiredEnv: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../../supabase/functions/_shared/http.ts", () => ({
  requiredEnv: indexMocks.requiredEnv,
}));

vi.mock("../../supabase/functions/_shared/supabase.ts", () => ({
  createServiceClient: () => ({ rpc: indexMocks.rpc }),
  requireAuthenticatedUser: indexMocks.requireAuthenticatedUser,
}));

const USER_ID = "20000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000002";

function validBatch(): TelemetryBatchRequestV1 {
  const event: TelemetryEnvelopeV1 = {
    event_id: EVENT_ID,
    catalog_version: 1,
    stream: "product",
    event_name: "app_lifecycle",
    occurred_at: "2026-09-04T06:03:21.125Z",
    source: "desktop",
    source_sequence: 1,
    host_observed_sequence: 1,
    installation_id: "20000000-0000-4000-8000-000000000003",
    app_launch_id: "20000000-0000-4000-8000-000000000004",
    stage: "foregrounded",
    priority: 2,
    app: {
      version: "0.1.82",
      build: "182",
      environment: "production",
      release_channel: "stable",
    },
    system: { macos_major_minor: "15.6", architecture: "arm64" },
    properties: {},
  };
  return {
    catalog_version: 1,
    batch_id: "20000000-0000-4000-8000-000000000005",
    events: [event],
  };
}

function request(
  body: string | TelemetryBatchRequestV1 = validBatch(),
  authorization = "Bearer verified-token",
) {
  return new Request("https://example.test/functions/v1/telemetry-ingest", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function dependencies(
  userId: string | null = USER_ID,
  response: TelemetryBatchResponseV1 = {
    accepted: [EVENT_ID],
    rejected: [],
    retry_after_ms: null,
  },
): TelemetryIngestDependencies {
  return {
    resolveVerifiedUserId: vi.fn().mockResolvedValue(userId),
    admitAndInsert: vi.fn().mockResolvedValue(response),
    now: () => new Date("2026-09-04T06:04:00.000Z"),
  };
}

describe("telemetry ingest handler", () => {
  it("admits a verified publishable apikey without manufacturing a bearer JWT", async () => {
    const deps = dependencies(null);
    const candidate = request();
    candidate.headers.delete("Authorization");
    candidate.headers.set("apikey", "sb_publishable_fixture");
    const response = await handleTelemetryIngest(candidate, deps);
    expect(response.status).toBe(200);
    expect(deps.resolveVerifiedUserId).toHaveBeenCalledWith(candidate);
    expect(deps.admitAndInsert).toHaveBeenCalledWith(validBatch(), null, deps.now());
  });
  it("wires the real index branch for anonymous and authenticated JWTs", async () => {
    vi.resetModules();
    indexMocks.requiredEnv.mockReturnValue("public-anon-key");
    indexMocks.requireAuthenticatedUser.mockResolvedValue({ id: USER_ID });
    indexMocks.rpc.mockResolvedValue({
      data: { accepted: [EVENT_ID], rejected: [], retry_after_ms: null },
      error: null,
    });
    const serve = vi.fn();
    vi.stubGlobal("Deno", { serve, env: { get: (name: string) => name === "SUPABASE_PUBLISHABLE_KEYS" ? JSON.stringify({ default: "sb_publishable_fixture" }) : undefined } });

    try {
      await import("../../supabase/functions/telemetry-ingest/index.ts");
      expect(serve).toHaveBeenCalledOnce();
      const registeredHandler = serve.mock.calls[0]?.[0] as (
        request: Request,
      ) => Promise<Response>;

      const anonymousResponse = await registeredHandler(
        request(validBatch(), "Bearer public-anon-key"),
      );
      expect(anonymousResponse.status).toBe(200);
      expect(indexMocks.requireAuthenticatedUser).not.toHaveBeenCalled();
      expect(indexMocks.rpc).toHaveBeenLastCalledWith(
        "telemetry_admit_and_insert",
        expect.objectContaining({ p_user_id: null }),
      );

      const publishableRequest = request();
      publishableRequest.headers.delete("Authorization");
      publishableRequest.headers.set("apikey", "sb_publishable_fixture");
      expect((await registeredHandler(publishableRequest)).status).toBe(200);
      expect(indexMocks.requireAuthenticatedUser).not.toHaveBeenCalled();
      expect(indexMocks.rpc).toHaveBeenLastCalledWith(
        "telemetry_admit_and_insert", expect.objectContaining({ p_user_id: null }),
      );
      for (const badKey of ["sb_publishable_unknown", "sb_secret_fixture", "unknown", ""]) {
        publishableRequest.headers.set("apikey", badKey);
        expect((await registeredHandler(new Request(publishableRequest.url, {
          method: "POST", headers: publishableRequest.headers, body: JSON.stringify(validBatch()),
        }))).status).toBe(401);
      }

      const authenticatedRequest = request(
        validBatch(),
        "Bearer gateway-verified-user-token",
      );
      const authenticatedResponse = await registeredHandler(
        authenticatedRequest,
      );
      expect(authenticatedResponse.status).toBe(200);
      expect(indexMocks.requireAuthenticatedUser).toHaveBeenCalledWith(
        authenticatedRequest,
      );
      expect(indexMocks.rpc).toHaveBeenLastCalledWith(
        "telemetry_admit_and_insert",
        expect.objectContaining({ p_user_id: USER_ID }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("admits the explicitly configured desktop public key when the hosted reserved key differs", async () => {
    vi.resetModules();
    indexMocks.requiredEnv.mockReturnValue("different-hosted-anon-key");
    indexMocks.requireAuthenticatedUser.mockRejectedValue(new Error("not a user JWT"));
    indexMocks.rpc.mockResolvedValue({
      data: { accepted: [EVENT_ID], rejected: [], retry_after_ms: null }, error: null,
    });
    const serve = vi.fn();
    vi.stubGlobal("Deno", { serve, env: { get: (name: string) =>
      name === "WOVEN_TELEMETRY_PUBLIC_ANON_KEY" ? "desktop-public-anon-key" : undefined,
    } });
    try {
      await import("../../supabase/functions/telemetry-ingest/index.ts");
      const handler = serve.mock.calls[0][0] as (request: Request) => Promise<Response>;
      const bearerResponse = await handler(request(validBatch(), "Bearer desktop-public-anon-key"));
      expect(bearerResponse.status).toBe(200);
      expect((await bearerResponse.json()).accepted).toEqual([EVENT_ID]);
      expect(indexMocks.rpc).toHaveBeenLastCalledWith(
        "telemetry_admit_and_insert", expect.objectContaining({ p_user_id: null }),
      );
      const apikeyOnly = request();
      apikeyOnly.headers.delete("Authorization");
      apikeyOnly.headers.set("apikey", "desktop-public-anon-key");
      expect((await handler(apikeyOnly)).status).toBe(200);
      const invalidBearer = request(validBatch(), "Bearer invalid-user-token");
      invalidBearer.headers.set("apikey", "desktop-public-anon-key");
      expect((await handler(invalidBearer)).status).toBe(401);
      expect((await handler(request(validBatch(), "Bearer different-hosted-anon-key"))).status).toBe(401);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires a credential before resolving identity", async () => {
    const deps = dependencies();
    const response = await handleTelemetryIngest(
      request(validBatch(), ""),
      deps,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(deps.resolveVerifiedUserId).not.toHaveBeenCalled();
    expect(deps.admitAndInsert).not.toHaveBeenCalled();
  });

  it("fails closed when the supplied JWT cannot be resolved", async () => {
    const deps = dependencies();
    vi.mocked(deps.resolveVerifiedUserId).mockRejectedValue(
      new Error("jwt body"),
    );
    const response = await handleTelemetryIngest(request(), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(deps.admitAndInsert).not.toHaveBeenCalled();
  });

  it("accepts signed-out installation traffic without inventing a user ID", async () => {
    const deps = dependencies(null);
    const response = await handleTelemetryIngest(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.admitAndInsert).toHaveBeenCalledWith(
      validBatch(),
      null,
      new Date("2026-09-04T06:04:00.000Z"),
    );
  });

  it("passes only the server-resolved signed-in identity to admission", async () => {
    const submitted = validBatch() as TelemetryBatchRequestV1 & {
      user_id?: string;
    };
    submitted.user_id = "20000000-0000-4000-8000-000000000099";
    const deps = dependencies(USER_ID);
    const response = await handleTelemetryIngest(request(submitted), deps);
    expect(response.status).toBe(400);
    expect(deps.admitAndInsert).not.toHaveBeenCalled();

    const validResponse = await handleTelemetryIngest(request(), deps);
    expect(validResponse.status).toBe(200);
    expect(deps.admitAndInsert).toHaveBeenCalledWith(
      validBatch(),
      USER_ID,
      new Date("2026-09-04T06:04:00.000Z"),
    );
  });

  it("returns the transaction's partial acceptance unchanged", async () => {
    const partial: TelemetryBatchResponseV1 = {
      accepted: [EVENT_ID],
      rejected: [
        {
          event_id: "20000000-0000-4000-8000-000000000006",
          reason: "rate_limited",
          permanent: false,
        },
      ],
      retry_after_ms: 25_000,
    };
    const response = await handleTelemetryIngest(
      request(),
      dependencies(USER_ID, partial),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(partial);
  });

  it("uses 429 plus Retry-After when admission rate-limits the entire batch", async () => {
    const limited: TelemetryBatchResponseV1 = {
      accepted: [],
      rejected: [
        { event_id: EVENT_ID, reason: "rate_limited", permanent: false },
      ],
      retry_after_ms: 61_001,
    };
    const response = await handleTelemetryIngest(
      request(),
      dependencies(null, limited),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("62");
    expect(await response.json()).toEqual(limited);
  });

  it("returns permanent schema/privacy rejections before storage", async () => {
    const body = validBatch();
    body.events[0].properties = { prompt: "must never be stored" };
    const deps = dependencies();
    const response = await handleTelemetryIngest(request(body), deps);
    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.rejected).toEqual([
      { event_id: EVENT_ID, reason: "privacy_violation", permanent: true },
    ]);
    expect(JSON.stringify(result)).not.toContain("must never be stored");
    expect(deps.admitAndInsert).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and oversized request bodies without storage", async () => {
    const malformedDeps = dependencies();
    const malformed = await handleTelemetryIngest(request("{"), malformedDeps);
    expect(malformed.status).toBe(400);
    expect(malformedDeps.admitAndInsert).not.toHaveBeenCalled();

    const oversizedDeps = dependencies();
    const oversized = await handleTelemetryIngest(
      request("x".repeat(65_537)),
      oversizedDeps,
    );
    expect(oversized.status).toBe(413);
    expect(oversizedDeps.resolveVerifiedUserId).not.toHaveBeenCalled();
    expect(oversizedDeps.admitAndInsert).not.toHaveBeenCalled();
  });

  it("turns transaction failures into a content-free retryable response", async () => {
    const deps = dependencies();
    vi.mocked(deps.admitAndInsert).mockRejectedValue(
      new Error("provider body with /Users/private/file.txt"),
    );
    const response = await handleTelemetryIngest(request(), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "ingestion_unavailable" });
  });
});
