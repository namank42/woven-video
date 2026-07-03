import { afterEach, describe, expect, it, vi } from "vitest";

describe("media job routes", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/api/license");
    vi.doUnmock("@/lib/media/jobs");
    vi.doUnmock("@/lib/media/model-registry");
    vi.doUnmock("@/lib/media/output-urls");
    vi.doUnmock("@/lib/media/schema");
    vi.doUnmock("@/lib/media/trigger-dispatch");
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
        kind: "video",
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
      failReservedMediaJobDispatch: vi.fn(),
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
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_123" }));

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
        kind: "video",
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
      failReservedMediaJobDispatch: vi.fn(),
    }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

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
        kind: "video",
        parameterSchema: { type: "object" },
      },
      parameters: { prompt: "a mountain" },
      inputAssets: [{ assetId: "asset_1", role: "image" }],
      inputAssetIds: ["asset_1"],
    });
    expect(dispatchMediaJob).toHaveBeenCalledWith({
      jobId: "job_1",
      userId: "user_1",
      modelId: "fal:frontier-video",
      kind: "video",
    });
  });

  it("rejects media models that cannot run through the Trigger executor", async () => {
    const createReservedMediaJob = vi.fn();
    const dispatchMediaJob = vi.fn();

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
        id: "captions:model",
        kind: "captions",
        parameterSchema: { type: "object" },
        inputAssetSchema: { roles: [] },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({
        ok: true,
        value: { prompt: "caption this reel" },
      })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
      failReservedMediaJobDispatch: vi.fn(),
    }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "captions:model",
      parameters: { prompt: "caption this reel" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_media_input" },
    });
    expect(createReservedMediaJob).not.toHaveBeenCalled();
    expect(dispatchMediaJob).not.toHaveBeenCalled();
  });

  it("fails closed and releases reservation when Trigger dispatch fails", async () => {
    const createReservedMediaJob = vi.fn(async () => ({
      id: "job_1",
      status: "queued",
      model: "fal-ai/nano-banana-lite",
      estimatedCostUsdMicros: 1_200_000,
      reservedCreditsUsdMicros: 1_200_000,
      createdAt: "2026-07-03T12:00:00.000Z",
      expiresAt: "2026-07-03T13:00:00.000Z",
    }));
    const failReservedMediaJobDispatch = vi.fn(async () => undefined);
    const dispatchMediaJob = vi.fn(async () => {
      throw new Error("trigger unavailable");
    });

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({ ok: true, auth: { user: { id: "user_1" } } })),
    }));
    vi.doMock("@/lib/api/license", () => ({ licenseGateResponse: vi.fn(async () => null) }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal-ai/nano-banana-lite",
        kind: "image",
        parameterSchema: { type: "object" },
        inputAssetSchema: { roles: [] },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({ ok: true, value: { prompt: "a mountain" } })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
      failReservedMediaJobDispatch,
    }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal-ai/nano-banana-lite",
      parameters: { prompt: "a mountain" },
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "media_executor_unavailable" },
    });
    expect(failReservedMediaJobDispatch).toHaveBeenCalledWith("job_1");
    expect(consoleError).toHaveBeenCalledWith("Failed to dispatch media job", expect.any(Error));
  });

  it("returns media_executor_unavailable when cleanup fails after Trigger dispatch failure", async () => {
    const createReservedMediaJob = vi.fn(async () => ({
      id: "job_1",
      status: "queued",
      model: "fal-ai/nano-banana-lite",
      estimatedCostUsdMicros: 1_200_000,
      reservedCreditsUsdMicros: 1_200_000,
      createdAt: "2026-07-03T12:00:00.000Z",
      expiresAt: "2026-07-03T13:00:00.000Z",
    }));
    const failReservedMediaJobDispatch = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const dispatchMediaJob = vi.fn(async () => {
      throw new Error("trigger unavailable");
    });

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({ ok: true, auth: { user: { id: "user_1" } } })),
    }));
    vi.doMock("@/lib/api/license", () => ({ licenseGateResponse: vi.fn(async () => null) }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal-ai/nano-banana-lite",
        kind: "image",
        parameterSchema: { type: "object" },
        inputAssetSchema: { roles: [] },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({ ok: true, value: { prompt: "a mountain" } })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
      failReservedMediaJobDispatch,
    }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal-ai/nano-banana-lite",
      parameters: { prompt: "a mountain" },
    }));
    const responseBody = await response.clone().json();

    expect(response.status).toBe(503);
    expect(responseBody).toMatchObject({
      error: { code: "media_executor_unavailable" },
    });
    expect(failReservedMediaJobDispatch).toHaveBeenCalledWith("job_1");
    expect(consoleError).toHaveBeenCalledWith("Failed to release media job reservation after Trigger dispatch failure", expect.any(Error));
    expect(consoleError).toHaveBeenCalledWith("Failed to dispatch media job", expect.any(Error));
    expect(JSON.stringify(responseBody)).not.toContain("run_");
  });

  it("passes role-aware input_assets to job creation", async () => {
    const createReservedMediaJob = vi.fn(async () => ({
      id: "job_1",
      status: "queued",
      model: "fal-ai/veo3.1/first-last-frame-to-video",
      estimatedCostUsdMicros: 3_840_000,
      reservedCreditsUsdMicros: 3_840_000,
      createdAt: "2026-07-01T12:00:00.000Z",
      expiresAt: "2026-07-01T13:00:00.000Z",
    }));
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_123" }));

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({ ok: true, auth: { user: { id: "user_1" } } })),
    }));
    vi.doMock("@/lib/api/license", () => ({ licenseGateResponse: vi.fn(async () => null) }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal-ai/veo3.1/first-last-frame-to-video",
        kind: "video",
        parameterSchema: { type: "object" },
        inputAssetSchema: {
          roles: [
            { role: "first_frame", providerField: "first_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
            { role: "last_frame", providerField: "last_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
          ],
        },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({ ok: true, value: { prompt: "reveal" } })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
      failReservedMediaJobDispatch: vi.fn(),
    }));
    vi.doMock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob }));

    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal-ai/veo3.1/first-last-frame-to-video",
      parameters: { prompt: "reveal" },
      input_assets: [
        { asset_id: "asset_first", role: "first_frame" },
        { asset_id: "asset_last", role: "last_frame" },
      ],
    }));

    expect(response.status).toBe(200);
    expect(createReservedMediaJob).toHaveBeenCalledWith(expect.objectContaining({
      inputAssets: [
        { assetId: "asset_first", role: "first_frame" },
        { assetId: "asset_last", role: "last_frame" },
      ],
      inputAssetIds: ["asset_first", "asset_last"],
    }));
  });

  it("rejects requests that send both input_assets and input_asset_ids", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({ ok: true, auth: { user: { id: "user_1" } } })),
    }));
    vi.doMock("@/lib/api/license", () => ({ licenseGateResponse: vi.fn(async () => null) }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({ id: "model_1", kind: "image", parameterSchema: { type: "object" }, inputAssetSchema: { roles: [] } })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({ ok: true, value: {} })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob: vi.fn(),
      failReservedMediaJobDispatch: vi.fn(),
    }));

    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "model_1",
      input_asset_ids: ["asset_1"],
      input_assets: [{ asset_id: "asset_1", role: "image" }],
      parameters: {},
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_media_input" },
    });
  });

  it("maps known media job creation failures to stable public errors", async () => {
    const createReservedMediaJob = vi.fn()
      .mockRejectedValueOnce(new Error("insufficient_balance"))
      .mockRejectedValueOnce(new Error("upload_not_complete"))
      .mockRejectedValueOnce(new Error("media_quote_requires_explicit_duration"));

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
        kind: "video",
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
      failReservedMediaJobDispatch: vi.fn(),
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
    const invalidQuote = await POST(jsonRequest("/api/v1/media/jobs", {
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
    expect(invalidQuote.status).toBe(400);
    await expect(invalidQuote.json()).resolves.toMatchObject({
      error: { code: "invalid_media_input" },
    });
  });

  it("rejects stringified Nano Banana Lite typed parameters with invalid_media_input", async () => {
    const createReservedMediaJob = vi.fn();

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
        id: "fal-ai/nano-banana-lite",
        kind: "image",
        parameterSchema: {
          type: "object",
          required: ["prompt"],
          additionalProperties: false,
          properties: {
            prompt: { type: "string", minLength: 3 },
            num_images: { type: "integer", minimum: 1, maximum: 4 },
            sync_mode: { type: "boolean" },
            limit_generations: { type: "boolean" },
            safety_tolerance: { type: "string", enum: ["1", "2", "3", "4", "5", "6"] },
          },
        },
        inputAssetSchema: { roles: [] },
      })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
      failReservedMediaJobDispatch: vi.fn(),
    }));

    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal-ai/nano-banana-lite",
      parameters: {
        prompt: "test image prompt",
        num_images: "1",
        sync_mode: "false",
        limit_generations: "true",
        safety_tolerance: "4",
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_media_input",
        message: "Invalid parameter type for num_images: expected integer.",
      },
    });
    expect(createReservedMediaJob).not.toHaveBeenCalled();
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

  it("preserves model_not_enabled as the public failure code on status reads", async () => {
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
        estimated_cost_usd_micros: 1_200_000,
        reserved_amount_usd_micros: 1_200_000,
        final_cost_usd_micros: 0,
        progress: { stage: "failed", percent: null },
        input: { media_model_id: "fal-ai/nano-banana-lite" },
        output: null,
        error: "model_not_enabled",
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
      presentJobOutputs: vi.fn(async () => []),
    }));

    const { GET } = await import("@/app/api/v1/media/jobs/[jobId]/route");
    const response = await GET(
      new Request("https://example.test/api/v1/media/jobs/job_1"),
      { params: Promise.resolve({ jobId: "job_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "job_1",
      status: "failed",
      model: "fal-ai/nano-banana-lite",
      error: {
        code: "model_not_enabled",
        message: "Media model is not enabled.",
      },
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
