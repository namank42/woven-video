import { afterEach, describe, expect, it, vi } from "vitest";

describe("Fal media webhook route", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/supabase/admin");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("updates matching Fal media jobs from request_id and returns no-store ok response", async () => {
    const { createSupabaseAdminClient, update, eq } = mockSupabaseUpdate({ error: null });

    const { POST, dynamic, runtime } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(jsonRequest({ request_id: "fal_req_123" }));

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
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
    });
    expect(eq).toHaveBeenNthCalledWith(1, "provider_job_id", "fal_req_123");
    expect(eq).toHaveBeenNthCalledWith(2, "provider", "fal");
    expect(eq).toHaveBeenNthCalledWith(3, "type", "media_job");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("accepts Fal requestId camelCase payloads", async () => {
    const { eq } = mockSupabaseUpdate({ error: null });

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(jsonRequest({ requestId: "fal_req_camel" }));

    expect(eq).toHaveBeenNthCalledWith(1, "provider_job_id", "fal_req_camel");
    expect(response.status).toBe(200);
  });

  it("rejects invalid JSON object bodies and missing request ids", async () => {
    const { createSupabaseAdminClient } = mockSupabaseUpdate({ error: null });

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const invalidJson = await POST(new Request("https://example.test/api/v1/media/webhooks/fal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }));
    const arrayBody = await POST(jsonRequest([]));
    const missingId = await POST(jsonRequest({ status: "completed" }));

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

  it("returns provider_failed when Supabase cannot update the job", async () => {
    mockSupabaseUpdate({ error: { message: "database unavailable" } });

    const { POST } = await import("@/app/api/v1/media/webhooks/fal/route");
    const response = await POST(jsonRequest({ request_id: "fal_req_123" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "database unavailable", code: "provider_failed" },
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
