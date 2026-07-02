import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Fal media webhook route", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.doUnmock("@/lib/supabase/admin");
    vi.doUnmock("@/lib/media/providers/fal-webhooks");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("updates matching Fal media jobs from request_id and returns no-store ok response", async () => {
    const { createSupabaseAdminClient, update, eq } = mockSupabaseUpdate({ error: null });
    const { verifyFalWebhookSignature } = mockFalWebhookVerifier();

    const { POST, dynamic, runtime } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_123" }));

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(verifyFalWebhookSignature).toHaveBeenCalledWith({
      headers: {
        requestId: "webhook_req_1",
        userId: "fal_user_1",
        timestamp: "1700000000",
        signature: "a".repeat(128),
      },
      rawBody: Buffer.from(JSON.stringify({ request_id: "fal_req_123" })),
    });
    expect(createSupabaseAdminClient).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      progress: {
        stage: "provider_webhook_received",
        percent: null,
        message: "Provider callback received",
      },
      last_provider_poll_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
      claim_expires_at: "1970-01-01T00:00:00.000Z",
    });
    expect(eq).toHaveBeenNthCalledWith(1, "provider_job_id", "fal_req_123");
    expect(eq).toHaveBeenNthCalledWith(2, "provider", "fal");
    expect(eq).toHaveBeenNthCalledWith(3, "type", "media_job");
    expect(eq).toHaveBeenNthCalledWith(4, "status", "waiting_provider");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("accepts Fal requestId camelCase payloads", async () => {
    const { eq } = mockSupabaseUpdate({ error: null });
    mockFalWebhookVerifier();

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(signedJsonRequest({ requestId: "fal_req_camel" }));

    expect(eq).toHaveBeenNthCalledWith(1, "provider_job_id", "fal_req_camel");
    expect(response.status).toBe(200);
  });

  it("fences updates to jobs still waiting on the provider", async () => {
    const { eq } = mockSupabaseUpdate({ error: null });
    mockFalWebhookVerifier();

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    await POST(signedJsonRequest({ request_id: "fal_req_replay" }));

    expect(eq).toHaveBeenCalledWith("status", "waiting_provider");
  });

  it("rejects unsigned webhooks before touching Supabase", async () => {
    const { createSupabaseAdminClient } = mockSupabaseUpdate({ error: null });
    const { verifyFalWebhookSignature } = mockFalWebhookVerifier();

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(jsonRequest({ request_id: "fal_req_unsigned" }));

    expect(response.status).toBe(401);
    expect(verifyFalWebhookSignature).not.toHaveBeenCalled();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects invalid webhook signatures before touching Supabase", async () => {
    const { createSupabaseAdminClient } = mockSupabaseUpdate({ error: null });
    const { verifyFalWebhookSignature } = mockFalWebhookVerifier({
      error: falVerifierError("invalid", "signature_mismatch"),
    });

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_invalid" }));

    expect(response.status).toBe(401);
    expect(verifyFalWebhookSignature).toHaveBeenCalledOnce();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("returns unavailable for verifier infrastructure failures before touching Supabase", async () => {
    const { createSupabaseAdminClient } = mockSupabaseUpdate({ error: null });
    const { verifyFalWebhookSignature } = mockFalWebhookVerifier({
      error: falVerifierError("infrastructure", "jwks_fetch_failed"),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_infra" }));

    expect(response.status).toBe(503);
    expect(verifyFalWebhookSignature).toHaveBeenCalledOnce();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Fal webhook verifier infrastructure failure", {
      code: "jwks_fetch_failed",
    });
  });

  it("rejects invalid JSON object bodies and missing request ids", async () => {
    const { createSupabaseAdminClient } = mockSupabaseUpdate({ error: null });
    mockFalWebhookVerifier();

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const invalidJson = await POST(signedRequest("{"));
    const arrayBody = await POST(signedJsonRequest([]));
    const missingId = await POST(signedJsonRequest({ status: "completed" }));

    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toMatchObject({
      error: { message: "Request body must be a JSON object.", code: "bad_request" },
    });
    expect(arrayBody.status).toBe(400);
    await expect(arrayBody.json()).resolves.toMatchObject({
      error: { message: "Request body must be a JSON object.", code: "bad_request" },
    });
    expect(missingId.status).toBe(400);
    await expect(missingId.json()).resolves.toMatchObject({
      error: { message: "Missing Fal request id.", code: "invalid_media_input" },
    });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON only after verifying the signature", async () => {
    mockSupabaseUpdate({ error: null });
    const { verifyFalWebhookSignature } = mockFalWebhookVerifier();

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const invalidJson = await POST(signedRequest("{"));

    expect(invalidJson.status).toBe(400);
    expect(verifyFalWebhookSignature).toHaveBeenCalledOnce();
  });

  it("returns provider_failed when Supabase cannot update the job", async () => {
    const error = { message: "database unavailable" };
    mockSupabaseUpdate({ error });
    mockFalWebhookVerifier();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_123" }));

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith("Failed to update Fal media webhook state", error);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Unable to update media job webhook state.",
        code: "provider_failed",
      },
    });
  });

  it("verifies a real Ed25519 Fal webhook before mutating Supabase", async () => {
    process.env = {
      ...originalEnv,
      MEDIA_TOKEN_SECRET: "x".repeat(32),
      MEDIA_WORKER_SHARED_SECRET: "y".repeat(32),
      FAL_WEBHOOK_JWKS_URL: undefined,
    } as NodeJS.ProcessEnv;
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const body = JSON.stringify({ request_id: "fal_req_real" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signFalWebhook({
      privateKey,
      rawBody: Buffer.from(body),
      requestId: "webhook_req_real",
      userId: "fal_user_real",
      timestamp,
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      keys: [publicKey.export({ format: "jwk" })],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { createSupabaseAdminClient, eq } = mockSupabaseUpdate({ error: null });

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(new Request("https://example.test/api/v1/media/webhooks/fal", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fal-webhook-request-id": "webhook_req_real",
        "x-fal-webhook-user-id": "fal_user_real",
        "x-fal-webhook-timestamp": timestamp,
        "x-fal-webhook-signature": signature,
      },
      body,
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://rest.fal.ai/.well-known/jwks.json", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(createSupabaseAdminClient).toHaveBeenCalledOnce();
    expect(eq).toHaveBeenNthCalledWith(1, "provider_job_id", "fal_req_real");
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://example.test/api/v1/media/webhooks/fal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function signedJsonRequest(body: unknown): Request {
  return signedRequest(JSON.stringify(body));
}

function signedRequest(body: string): Request {
  return new Request("https://example.test/api/v1/media/webhooks/fal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fal-webhook-request-id": "webhook_req_1",
      "x-fal-webhook-user-id": "fal_user_1",
      "x-fal-webhook-timestamp": "1700000000",
      "x-fal-webhook-signature": "a".repeat(128),
    },
    body,
  });
}

function mockFalWebhookVerifier({
  error,
}: {
  error?: unknown;
} = {}) {
  const verifyFalWebhookSignature = vi.fn(() => {
    if (error) {
      return Promise.reject(error);
    }
    return Promise.resolve(true);
  });

  vi.doMock("@/lib/media/providers/fal-webhooks", () => ({
    falWebhookHeaders: (request: Request) => {
      const headers = {
        requestId: request.headers.get("x-fal-webhook-request-id")?.trim() ?? "",
        userId: request.headers.get("x-fal-webhook-user-id")?.trim() ?? "",
        timestamp: request.headers.get("x-fal-webhook-timestamp")?.trim() ?? "",
        signature: request.headers.get("x-fal-webhook-signature")?.trim() ?? "",
      };
      if (!headers.requestId || !headers.userId || !headers.timestamp || !headers.signature) {
        throw falVerifierError("invalid", "missing_headers");
      }
      return headers;
    },
    verifyFalWebhookSignature,
    isFalWebhookVerificationError: (error: unknown) => (
      typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "FalWebhookVerificationError" &&
      ((error as { kind?: unknown }).kind === "invalid" ||
        (error as { kind?: unknown }).kind === "infrastructure")
    ),
  }));

  return { verifyFalWebhookSignature };
}

function falVerifierError(
  kind: "invalid" | "infrastructure",
  code: string,
) {
  return {
    name: "FalWebhookVerificationError",
    kind,
    code,
    message: code,
  };
}

function signFalWebhook({
  privateKey,
  rawBody,
  requestId,
  userId,
  timestamp,
}: {
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  rawBody: Buffer;
  requestId: string;
  userId: string;
  timestamp: string;
}) {
  const bodyDigest = createHash("sha256").update(rawBody).digest("hex");
  const message = `${requestId}\n${userId}\n${timestamp}\n${bodyDigest}`;
  return sign(null, Buffer.from(message), privateKey).toString("hex");
}

function mockSupabaseUpdate({
  error,
}: {
  error: { message: string } | null;
}) {
  const chain = {
    eq: vi.fn(() => chain),
    then: (resolve: (value: { error: { message: string } | null }) => unknown) => {
      return Promise.resolve({ error }).then(resolve);
    },
  };
  const update = vi.fn(() => chain);
  const from = vi.fn(() => ({ update }));
  const createSupabaseAdminClient = vi.fn(() => ({ from }));

  vi.doMock("@/lib/supabase/admin", () => ({
    createSupabaseAdminClient,
  }));

  return { createSupabaseAdminClient, from, update, eq: chain.eq };
}
