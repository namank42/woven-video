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
    vi.doUnmock("@/lib/media/trigger-dispatch");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("wakes the Trigger media task after a verified Fal webhook", async () => {
    const { select, update } = mockSupabaseWebhookJob({ error: null });
    mockFalWebhookVerifier();
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_1" }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const { POST, dynamic, runtime } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_123" }), routeContext());

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(update).toHaveBeenCalledWith({
      progress: {
        stage: "provider_webhook_received",
        percent: null,
        message: "Provider callback received",
      },
      last_provider_poll_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      claim_expires_at: "1970-01-01T00:00:00.000Z",
    });
    expect(select).toHaveBeenCalledWith("id, user_id, input");
    expect(dispatchMediaJob).toHaveBeenCalledWith({
      jobId: "job_1",
      userId: "user_1",
      modelId: "google/nano-banana-2-lite",
      kind: "image",
      source: "webhook",
      idempotencyDiscriminator: "fal_req_123",
    });
    expect(response.status).toBe(200);
  });

  it("adopts the request id when the job is found by path hint and nonce", async () => {
    const admin = mockSupabaseWebhookFlow({
      selectResults: [
        { data: null, error: null },
        { data: { id: "job_hint_1" }, error: null },
        {
          data: {
            id: "job_hint_1",
            user_id: "user_1",
            input: {
              media_model_id: "google/nano-banana-2-lite",
              operation: "image_generation",
            },
          },
          error: null,
        },
      ],
      updateResults: [{ error: null }, { error: null }],
    });
    mockFalWebhookVerifier();
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_1" }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const route = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const POST = route.POST as (
      request: Request,
      context: { params: Promise<{ hint?: string[] }> },
    ) => Promise<Response>;
    const response = await POST(signedJsonRequest({ request_id: "fal_req_hint" }), {
      params: Promise.resolve({ hint: ["job_hint_1", "nonce_1"] }),
    });

    expect(response.status).toBe(200);
    expect(admin.updateOperations).toContainEqual({
      table: "generation_jobs",
      values: { provider_job_id: "fal_req_hint" },
      filters: [
        ["eq", "id", "job_hint_1"],
        ["eq", "provider_attempt_nonce", "nonce_1"],
        ["eq", "provider", "fal"],
        ["eq", "type", "media_job"],
        ["is", "provider_job_id", null],
        ["in", "status", ["running", "waiting_provider"]],
      ],
    });
    expect(dispatchMediaJob).toHaveBeenCalledWith({
      jobId: "job_hint_1",
      userId: "user_1",
      modelId: "google/nano-banana-2-lite",
      kind: "image",
      source: "webhook",
      idempotencyDiscriminator: "fal_req_hint",
    });
  });

  it("does not dispatch a Trigger run when webhook job operation is unknown", async () => {
    mockSupabaseWebhookJob({
      error: null,
      input: {
        media_model_id: "legacy-model",
        operation: "unknown_generation",
      },
    });
    mockFalWebhookVerifier();
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_1" }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_123" }), routeContext());

    expect(response.status).toBe(200);
    expect(dispatchMediaJob).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith("Skipping Fal webhook Trigger dispatch for unsupported media operation", {
      jobId: "job_1",
      operation: "unknown_generation",
    });
  });

  it("ignores a hint with a wrong nonce", async () => {
    const admin = mockSupabaseWebhookFlow({
      selectResults: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      updateResults: [{ error: null }],
    });
    mockFalWebhookVerifier();
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_1" }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const route = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const POST = route.POST as (
      request: Request,
      context: { params: Promise<{ hint?: string[] }> },
    ) => Promise<Response>;
    const response = await POST(signedJsonRequest({ request_id: "fal_req_hint_miss" }), {
      params: Promise.resolve({ hint: ["job_hint_1", "nonce_wrong"] }),
    });

    expect(response.status).toBe(200);
    expect(admin.selectOperations).toContainEqual({
      table: "generation_jobs",
      columns: "id",
      filters: [
        ["eq", "id", "job_hint_1"],
        ["eq", "provider_attempt_nonce", "nonce_wrong"],
        ["eq", "provider", "fal"],
        ["eq", "type", "media_job"],
        ["is", "provider_job_id", null],
        ["in", "status", ["running", "waiting_provider"]],
      ],
    });
    expect(admin.updateOperations).toEqual([]);
    expect(dispatchMediaJob).not.toHaveBeenCalled();
  });

  it("accepts Fal requestId camelCase payloads", async () => {
    const { eq } = mockSupabaseUpdate({ error: null });
    mockFalWebhookVerifier();

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const response = await POST(signedJsonRequest({ requestId: "fal_req_camel" }), routeContext());

    expect(eq).toHaveBeenNthCalledWith(1, "provider_job_id", "fal_req_camel");
    expect(response.status).toBe(200);
  });

  it("fences updates to jobs still waiting on the provider", async () => {
    const { in: inFilter } = mockSupabaseUpdate({ error: null });
    mockFalWebhookVerifier();

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    await POST(signedJsonRequest({ request_id: "fal_req_replay" }), routeContext());

    expect(inFilter).toHaveBeenCalledWith("status", ["running", "waiting_provider"]);
  });

  it("rejects unsigned webhooks before touching Supabase", async () => {
    const { createSupabaseAdminClient } = mockSupabaseUpdate({ error: null });
    const { verifyFalWebhookSignature } = mockFalWebhookVerifier();

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const response = await POST(jsonRequest({ request_id: "fal_req_unsigned" }), routeContext());

    expect(response.status).toBe(401);
    expect(verifyFalWebhookSignature).not.toHaveBeenCalled();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects invalid webhook signatures before touching Supabase", async () => {
    const { createSupabaseAdminClient } = mockSupabaseUpdate({ error: null });
    const { verifyFalWebhookSignature } = mockFalWebhookVerifier({
      error: falVerifierError("invalid", "signature_mismatch"),
    });

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_invalid" }), routeContext());

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

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_infra" }), routeContext());

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

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const invalidJson = await POST(signedRequest("{"), routeContext());
    const arrayBody = await POST(signedJsonRequest([]), routeContext());
    const missingId = await POST(signedJsonRequest({ status: "completed" }), routeContext());

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

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const invalidJson = await POST(signedRequest("{"), routeContext());

    expect(invalidJson.status).toBe(400);
    expect(verifyFalWebhookSignature).toHaveBeenCalledOnce();
  });

  it("returns provider_failed when Supabase cannot update the job", async () => {
    const error = { message: "database unavailable" };
    mockSupabaseUpdate({ error });
    mockFalWebhookVerifier();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const response = await POST(signedJsonRequest({ request_id: "fal_req_123" }), routeContext());

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith("Failed to update Fal media webhook state", error);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Unable to update media job webhook state.",
        code: "provider_failed",
      },
    });
  });

  it("records provider_webhook_error progress on ERROR payloads", async () => {
    const admin = mockSupabaseWebhookFlow({
      selectResults: [
        { data: { id: "job_1" }, error: null },
        {
          data: {
            id: "job_1",
            user_id: "user_1",
            input: {
              media_model_id: "google/nano-banana-2-lite",
              operation: "image_generation",
            },
          },
          error: null,
        },
      ],
      updateResults: [{ error: null }],
    });
    mockFalWebhookVerifier();
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_1" }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const route = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const POST = route.POST as (
      request: Request,
      context?: { params: Promise<{ hint?: string[] }> },
    ) => Promise<Response>;
    const response = await POST(signedJsonRequest({
      request_id: "fal_req_error",
      status: "ERROR",
      error: "Invalid status code: 422",
    }), routeContext());

    expect(response.status).toBe(200);
    expect(admin.updateOperations).toContainEqual({
      table: "generation_jobs",
      values: {
        progress: {
          stage: "provider_webhook_error",
          percent: null,
          message: "Invalid status code: 422",
        },
        last_provider_poll_at: expect.any(String),
        claim_expires_at: "1970-01-01T00:00:00.000Z",
      },
      filters: [
        ["eq", "provider_job_id", "fal_req_error"],
        ["eq", "provider", "fal"],
        ["eq", "type", "media_job"],
        ["in", "status", ["running", "waiting_provider"]],
      ],
    });
    expect(dispatchMediaJob).toHaveBeenCalledWith({
      jobId: "job_1",
      userId: "user_1",
      modelId: "google/nano-banana-2-lite",
      kind: "image",
      source: "webhook",
      idempotencyDiscriminator: "fal_req_error",
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

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
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
    }), routeContext());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://rest.fal.ai/.well-known/jwks.json", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(createSupabaseAdminClient).toHaveBeenCalledOnce();
    expect(eq).toHaveBeenNthCalledWith(1, "provider_job_id", "fal_req_real");
  });

  it("returns unavailable for malformed fetched JWKS before mutating Supabase", async () => {
    process.env = {
      ...originalEnv,
      MEDIA_TOKEN_SECRET: "x".repeat(32),
      MEDIA_WORKER_SHARED_SECRET: "y".repeat(32),
      FAL_WEBHOOK_JWKS_URL: undefined,
    } as NodeJS.ProcessEnv;
    const body = JSON.stringify({ request_id: "fal_req_malformed_jwks" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      keys: [{ kty: "OKP", crv: "X25519", x: "not-ed25519" }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    const { createSupabaseAdminClient } = mockSupabaseUpdate({ error: null });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/[[...hint]]/route");
    const response = await POST(new Request("https://example.test/api/v1/media/webhooks/fal", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fal-webhook-request-id": "webhook_req_bad_jwks",
        "x-fal-webhook-user-id": "fal_user_bad_jwks",
        "x-fal-webhook-timestamp": timestamp,
        "x-fal-webhook-signature": "a".repeat(128),
      },
      body,
    }), routeContext());

    expect(response.status).toBe(503);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Fal webhook verifier infrastructure failure", {
      code: "jwks_malformed",
    });
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

function routeContext(hint?: string[]) {
  return {
    params: Promise.resolve(hint ? { hint } : {}),
  };
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
  const updateEq = vi.fn();
  const updateIn = vi.fn();
  const selectEq = vi.fn().mockReturnThis();
  const selectIn = vi.fn().mockReturnThis();
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const updateChain = {
    eq: updateEq.mockReturnThis(),
    in: updateIn.mockReturnThis(),
    then: (resolve: (value: { error: { message: string } | null }) => unknown) => {
      return Promise.resolve({ error }).then(resolve);
    },
  };
  const select = vi.fn(() => ({ eq: selectEq, in: selectIn, maybeSingle }));
  const update = vi.fn(() => updateChain);
  const from = vi.fn(() => ({ update, select }));
  const createSupabaseAdminClient = vi.fn(() => ({ from }));

  vi.doMock("@/lib/supabase/admin", () => ({
    createSupabaseAdminClient,
  }));

  return { createSupabaseAdminClient, from, update, select, eq: updateEq, in: updateIn, maybeSingle };
}

function mockSupabaseWebhookJob({
  error,
  job = {
    id: "job_1",
    user_id: "user_1",
  },
  input = {
    media_model_id: "google/nano-banana-2-lite",
    operation: "image_generation",
  },
}: {
  error: { message: string } | null;
  job?: Record<string, unknown> | null;
  input?: Record<string, unknown>;
}) {
  const resolvedJob = job
    ? {
        ...job,
        input: job.input ?? input,
      }
    : job;
  const eq = vi.fn().mockReturnThis();
  const inFilter = vi.fn().mockReturnThis();
  const maybeSingle = vi.fn(async () => ({ data: resolvedJob, error }));
  const update = vi.fn(() => ({ eq, in: inFilter }));
  const select = vi.fn(() => ({ eq, in: inFilter, maybeSingle }));
  const from = vi.fn(() => ({ update, select }));
  const createSupabaseAdminClient = vi.fn(() => ({ from }));
  vi.doMock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));
  return { createSupabaseAdminClient, from, update, select, eq, in: inFilter, maybeSingle };
}

type SupabaseResult<T> = { data: T; error: { message: string } | null };
type SupabaseUpdateResult = { error: { message: string } | null };
type SupabaseFilter = ["eq" | "in" | "is", string, unknown];
type SupabaseUpdateOperation = {
  table: string;
  values: Record<string, unknown>;
  filters: SupabaseFilter[];
};
type SupabaseSelectOperation = {
  table: string;
  columns: string;
  filters: SupabaseFilter[];
};

function mockSupabaseWebhookFlow({
  selectResults,
  updateResults,
}: {
  selectResults: SupabaseResult<Record<string, unknown> | null>[];
  updateResults: SupabaseUpdateResult[];
}) {
  const selectOperations: SupabaseSelectOperation[] = [];
  const updateOperations: SupabaseUpdateOperation[] = [];

  const from = vi.fn((table: string) => ({
    select: (columns: string) => {
      const operation: SupabaseSelectOperation = {
        table,
        columns,
        filters: [],
      };
      selectOperations.push(operation);
      return createSelectChain(operation, selectResults.shift() ?? { data: null, error: null });
    },
    update: (values: Record<string, unknown>) => {
      const operation: SupabaseUpdateOperation = {
        table,
        values,
        filters: [],
      };
      updateOperations.push(operation);
      return createUpdateChain(operation, updateResults.shift() ?? { error: null });
    },
  }));
  const createSupabaseAdminClient = vi.fn(() => ({ from }));

  vi.doMock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

  return { createSupabaseAdminClient, from, selectOperations, updateOperations };
}

function createSelectChain(
  operation: SupabaseSelectOperation,
  result: SupabaseResult<Record<string, unknown> | null>,
) {
  const chain = {
    eq(column: string, value: unknown) {
      operation.filters.push(["eq", column, value]);
      return chain;
    },
    in(column: string, values: unknown[]) {
      operation.filters.push(["in", column, values]);
      return chain;
    },
    is(column: string, value: unknown) {
      operation.filters.push(["is", column, value]);
      return chain;
    },
    maybeSingle: vi.fn(async () => result),
  };

  return chain;
}

function createUpdateChain(
  operation: SupabaseUpdateOperation,
  result: SupabaseUpdateResult,
) {
  const chain = {
    eq(column: string, value: unknown) {
      operation.filters.push(["eq", column, value]);
      return chain;
    },
    in(column: string, values: unknown[]) {
      operation.filters.push(["in", column, values]);
      return chain;
    },
    is(column: string, value: unknown) {
      operation.filters.push(["is", column, value]);
      return chain;
    },
    then(resolve: (value: SupabaseUpdateResult) => unknown) {
      return Promise.resolve(result).then(resolve);
    },
  };

  return chain;
}
