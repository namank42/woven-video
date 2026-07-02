import { afterEach, describe, expect, it, vi } from "vitest";

describe("media job routes", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/api/license");
    vi.doUnmock("@/lib/media/jobs");
    vi.doUnmock("@/lib/media/model-registry");
    vi.doUnmock("@/lib/media/output-urls");
    vi.doUnmock("@/lib/media/schema");
    vi.doUnmock("@/lib/supabase/admin");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects malformed input_asset_ids without creating a job", async () => {
    const createReservedMediaJob = vi.fn(async () => ({
      id: "job_1",
      status: "queued",
      model: "fal:frontier-video",
      estimatedCostUsdMicros: 500_000,
      reservedCreditsUsdMicros: 500_000,
      createdAt: "2026-07-01T12:00:00.000Z",
      expiresAt: "2026-07-01T13:00:00.000Z",
    }));

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal:frontier-video",
        parameterSchema: { type: "object" },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({
        ok: true,
        value: { prompt: "a mountain" },
      })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
    }));

    const { POST } = await import("@/app/api/v1/media/jobs/route");

    for (const inputAssetIds of ["asset_1", [""], ["asset_1", 7], null]) {
      const response = await POST(jsonRequest("/api/v1/media/jobs", {
        model: "fal:frontier-video",
        parameters: { prompt: "a mountain" },
        input_asset_ids: inputAssetIds,
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_media_input" },
      });
    }

    expect(createReservedMediaJob).not.toHaveBeenCalled();
  });

  it("returns the queued job response without caching", async () => {
    const createReservedMediaJob = vi.fn(async () => ({
      id: "job_1",
      status: "queued",
      model: "fal:frontier-video",
      estimatedCostUsdMicros: 500_000,
      reservedCreditsUsdMicros: 500_000,
      createdAt: "2026-07-01T12:00:00.000Z",
      expiresAt: "2026-07-01T13:00:00.000Z",
    }));

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal:frontier-video",
        parameterSchema: { type: "object" },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({
        ok: true,
        value: { prompt: "a mountain" },
      })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
    }));

    const { POST, dynamic, runtime } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal:frontier-video",
      parameters: { prompt: "a mountain" },
      input_asset_ids: ["asset_1"],
    }));

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      id: "job_1",
      status: "queued",
      model: "fal:frontier-video",
      estimated_cost_usd_micros: 500_000,
      reserved_credits_usd_micros: 500_000,
      created_at: "2026-07-01T12:00:00.000Z",
      expires_at: "2026-07-01T13:00:00.000Z",
    });
    expect(createReservedMediaJob).toHaveBeenCalledWith({
      userId: "user_1",
      model: {
        id: "fal:frontier-video",
        parameterSchema: { type: "object" },
      },
      parameters: { prompt: "a mountain" },
      inputAssetIds: ["asset_1"],
    });
  });

  it("maps known media job creation failures to stable public errors", async () => {
    const createReservedMediaJob = vi.fn()
      .mockRejectedValueOnce(new Error("insufficient_balance"))
      .mockRejectedValueOnce(new Error("upload_not_complete"));

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal:frontier-video",
        parameterSchema: { type: "object" },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({
        ok: true,
        value: { prompt: "a mountain" },
      })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
    }));

    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const insufficient = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal:frontier-video",
      parameters: { prompt: "a mountain" },
      input_asset_ids: [],
    }));
    const uploadIncomplete = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal:frontier-video",
      parameters: { prompt: "a mountain" },
      input_asset_ids: ["asset_1"],
    }));

    expect(insufficient.status).toBe(402);
    await expect(insufficient.json()).resolves.toMatchObject({
      error: { code: "insufficient_balance" },
    });
    expect(uploadIncomplete.status).toBe(409);
    await expect(uploadIncomplete.json()).resolves.toMatchObject({
      error: { code: "upload_not_complete" },
    });
  });

  it("re-signs stored outputs on read and returns a generic public provider error message", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));

    const maybeSingle = vi.fn(async () => ({
      data: {
        id: "job_1",
        status: "failed",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 500_000,
        final_cost_usd_micros: 0,
        progress: { stage: "failed", percent: null },
        input: { media_model_id: "fal:input-model" },
        output: {
          media_model_id: "fal:output-model",
          outputs: [{ id: "out_1", type: "video" }],
        },
        error: "provider stack trace with private details",
        created_at: "2026-07-01T12:00:00.000Z",
        expires_at: "2026-07-01T13:00:00.000Z",
        started_at: "2026-07-01T12:01:00.000Z",
        completed_at: "2026-07-01T12:02:00.000Z",
      },
      error: null,
    }));
    const chain = {
      eq: vi.fn(() => chain),
      maybeSingle,
    };
    const select = vi.fn(() => chain);
    const from = vi.fn(() => ({ select }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createSupabaseAdminClient: vi.fn(() => ({ from })),
    }));
    const presentJobOutputs = vi.fn(async () => ([{
      id: "out_1",
      type: "video",
      content_type: "video/mp4",
      url: "https://media.example.test/objects/out_1?token=fresh",
      expires_at: "2026-07-01T12:17:00.000Z",
    }]));
    vi.doMock("@/lib/media/output-urls", () => ({ presentJobOutputs }));

    const { GET } = await import("@/app/api/v1/media/jobs/[jobId]/route");
    const response = await GET(
      new Request("https://example.test/api/v1/media/jobs/job_1"),
      { params: Promise.resolve({ jobId: "job_1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(presentJobOutputs).toHaveBeenCalledWith({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ id: "out_1", type: "video" }],
    });
    await expect(response.json()).resolves.toMatchObject({
      id: "job_1",
      status: "failed",
      model: "fal:output-model",
      outputs: [{
        id: "out_1",
        url: "https://media.example.test/objects/out_1?token=fresh",
        expires_at: "2026-07-01T12:17:00.000Z",
      }],
      error: { code: "provider_failed", message: "Generation failed." },
      expires_at: "2026-07-01T13:00:00.000Z",
    });
  });

  it("returns a 500 when output url signing fails", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));

    const maybeSingle = vi.fn(async () => ({
      data: {
        id: "job_1",
        status: "failed",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 500_000,
        final_cost_usd_micros: 0,
        progress: { stage: "failed", percent: null },
        input: { media_model_id: "fal:input-model" },
        output: {
          media_model_id: "fal:output-model",
          outputs: [{ id: "out_1", type: "video" }],
        },
        error: "provider stack trace with private details",
        created_at: "2026-07-01T12:00:00.000Z",
        expires_at: "2026-07-01T13:00:00.000Z",
        started_at: "2026-07-01T12:01:00.000Z",
        completed_at: "2026-07-01T12:02:00.000Z",
      },
      error: null,
    }));
    const chain = {
      eq: vi.fn(() => chain),
      maybeSingle,
    };
    const select = vi.fn(() => chain);
    const from = vi.fn(() => ({ select }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createSupabaseAdminClient: vi.fn(() => ({ from })),
    }));
    vi.doMock("@/lib/media/output-urls", () => ({
      presentJobOutputs: vi.fn(async () => {
        throw new Error("MEDIA_TOKEN_SECRET missing");
      }),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/v1/media/jobs/[jobId]/route");
    const response = await GET(
      new Request("https://example.test/api/v1/media/jobs/job_1"),
      { params: Promise.resolve({ jobId: "job_1" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "media_job_lookup_failed" },
    });
  });

  it("cancels queued media jobs through the atomic RPC and maps not-ready jobs to 409", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));

    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "media_job_not_ready" },
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createSupabaseAdminClient: vi.fn(() => ({ rpc })),
    }));

    const { POST } = await import("@/app/api/v1/media/jobs/[jobId]/cancel/route");
    const response = await POST(
      new Request("https://example.test/api/v1/media/jobs/job_1/cancel", {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: "job_1" }) },
    );

    expect(rpc).toHaveBeenCalledWith("cancel_queued_media_job", {
      p_user_id: "user_1",
      p_job_id: "job_1",
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "job_not_ready" },
    });
  });
});

function jsonRequest(pathname: string, body: unknown): Request {
  return new Request(`https://example.test${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
