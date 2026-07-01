import { afterEach, describe, expect, it, vi } from "vitest";

describe("media job routes", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/api/license");
    vi.doUnmock("@/lib/media/jobs");
    vi.doUnmock("@/lib/media/model-registry");
    vi.doUnmock("@/lib/media/schema");
    vi.resetModules();
  });

  it("rejects malformed input_asset_ids without creating a job", async () => {
    const createReservedMediaJob = vi.fn(async () => ({
      id: "job_1",
      status: "queued",
      model: "fal:frontier-video",
      estimatedCostUsdMicros: 500_000,
      reservedCreditsUsdMicros: 500_000,
      createdAt: "2026-07-01T12:00:00.000Z",
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
      expires_at: null,
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
});

function jsonRequest(pathname: string, body: unknown): Request {
  return new Request(`https://example.test${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
