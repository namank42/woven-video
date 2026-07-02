import { afterEach, describe, expect, it, vi } from "vitest";

describe("media model catalog route", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/media/model-registry");
    vi.resetModules();
  });

  it("returns authenticated media models in the public catalog shape without caching", async () => {
    const requireApiAuth = vi.fn(async () => ({
      ok: true,
      auth: { user: { id: "user_1" } },
    }));
    const listMediaModels = vi.fn(async () => [
      {
        id: "fal:frontier-video-1",
        provider: "fal",
        providerModel: "fal-ai/frontier-video-1",
        providerEndpoint: "fal-ai/frontier-video-1",
        operation: "video_generation",
        kind: "video",
        displayName: "Frontier Video 1",
        supportsUploadedInputs: true,
        supportedInputTypes: ["image"],
        outputTypes: ["video"],
        defaultParameters: { duration: 5 },
        parameterSchema: {
          type: "object",
          required: ["prompt"],
          properties: { prompt: { type: "string" } },
        },
        pricing: {
          unit: "job",
          minimumUsdMicros: 100_000,
          reserveUsdMicros: 500_000,
          markupBps: 2_000,
        },
        metadata: {},
        rule: {},
      },
    ]);

    vi.doMock("@/lib/api/auth", () => ({ requireApiAuth }));
    vi.doMock("@/lib/media/model-registry", () => ({ listMediaModels }));

    const { GET, dynamic, runtime } = await import("@/app/api/v1/media/models/route");

    const request = new Request("https://example.test/api/v1/media/models", {
      headers: { authorization: "Bearer token" },
    });
    const response = await GET(request);

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(requireApiAuth).toHaveBeenCalledWith(request);
    expect(listMediaModels).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      models: [
        {
          id: "fal:frontier-video-1",
          provider: "fal",
          kind: "video",
          display_name: "Frontier Video 1",
          enabled: true,
          supports_uploaded_inputs: true,
          supported_input_types: ["image"],
          output_types: ["video"],
          estimated_price: {
            unit: "job",
            minimum_usd_micros: 100_000,
            reserve_usd_micros: 500_000,
            markup_bps: 2_000,
          },
          default_parameters: { duration: 5 },
          parameter_schema: {
            type: "object",
            required: ["prompt"],
            properties: { prompt: { type: "string" } },
          },
        },
      ],
    });
  });

  it("returns a safe error response when model listing fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/media/model-registry", () => ({
      listMediaModels: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    }));

    const { GET } = await import("@/app/api/v1/media/models/route");

    const response = await GET(new Request("https://example.test/api/v1/media/models"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "media_models_failed",
        message: "Unable to list media models.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to list media models",
      expect.any(Error),
    );
  });
});
