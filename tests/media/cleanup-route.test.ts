import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimExpiredMediaForDeletion: vi.fn(),
  completeMediaAssetDeletions: vi.fn(),
  releaseMediaAssetDeletionClaims: vi.fn(),
}));

vi.mock("@/lib/media/cleanup", () => mocks);
vi.mock("@/lib/media/env", () => ({
  getMediaEnv: () => ({
    workerSharedSecret: "s".repeat(32),
    baseUrl: "https://media.woven.video",
  }),
}));

describe("POST /api/internal/media/cleanup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("CRON_SECRET", "cron_secret_123456");
  });

  it("rejects requests without the worker shared secret before DB mutation", async () => {
    const { POST } = await import("@/app/api/internal/media/cleanup/route");

    const response = await POST(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "wrong" },
    }));

    expect(response.status).toBe(401);
    expect(mocks.claimExpiredMediaForDeletion).not.toHaveBeenCalled();
    expect(mocks.completeMediaAssetDeletions).not.toHaveBeenCalled();
    expect(mocks.releaseMediaAssetDeletionClaims).not.toHaveBeenCalled();
  });

  it("deletes claimed R2 keys and completes DB deletion", async () => {
    mocks.claimExpiredMediaForDeletion.mockResolvedValue([
      { id: "asset_1", storage_key: "users/u1/tmp/a.mp4" },
    ]);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ deleted_count: 1 }), { status: 200 }),
    );
    const { POST } = await import("@/app/api/internal/media/cleanup/route");

    const response = await POST(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "s".repeat(32) },
    }));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith("https://media.woven.video/internal/delete", expect.objectContaining({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-woven-media-worker-secret": "s".repeat(32),
      },
      body: JSON.stringify({ keys: ["users/u1/tmp/a.mp4"] }),
    }));
    expect(mocks.completeMediaAssetDeletions).toHaveBeenCalledWith(["asset_1"]);
    expect(mocks.releaseMediaAssetDeletionClaims).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      deleted_count: 1,
      object_delete_count: 1,
    });
  });

  it("releases DB deletion claims when Worker deletion fails", async () => {
    mocks.claimExpiredMediaForDeletion.mockResolvedValue([
      { id: "asset_1", storage_key: "users/u1/tmp/a.mp4" },
    ]);
    vi.mocked(fetch).mockResolvedValue(new Response("bad", { status: 502 }));
    const { POST } = await import("@/app/api/internal/media/cleanup/route");

    const response = await POST(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "s".repeat(32) },
    }));

    expect(response.status).toBe(500);
    expect(mocks.completeMediaAssetDeletions).not.toHaveBeenCalled();
    expect(mocks.releaseMediaAssetDeletionClaims).toHaveBeenCalledWith(["asset_1"]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "media_cleanup_failed" },
    });
  });

  it("returns zero counts when there are no claimed objects", async () => {
    mocks.claimExpiredMediaForDeletion.mockResolvedValue([]);
    const { POST } = await import("@/app/api/internal/media/cleanup/route");

    const response = await POST(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "s".repeat(32) },
    }));

    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.completeMediaAssetDeletions).toHaveBeenCalledWith([]);
    await expect(response.json()).resolves.toEqual({
      deleted_count: 0,
      object_delete_count: 0,
    });
  });
});

describe("GET /api/internal/media/cleanup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("allows Vercel Cron GET requests with CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "cron_secret_123456");
    mocks.claimExpiredMediaForDeletion.mockResolvedValue([]);
    const { GET } = await import("@/app/api/internal/media/cleanup/route");

    const response = await GET(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "GET",
      headers: {
        authorization: "Bearer cron_secret_123456",
        "x-vercel-cron-schedule": "0 8 * * *",
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.claimExpiredMediaForDeletion).toHaveBeenCalled();
  });

  it("rejects Vercel Cron GET requests without CRON_SECRET before DB mutation", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { GET } = await import("@/app/api/internal/media/cleanup/route");

    const response = await GET(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "GET",
    }));

    expect(response.status).toBe(401);
    expect(mocks.claimExpiredMediaForDeletion).not.toHaveBeenCalled();
  });

  it("rejects Vercel Cron GET requests with the wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "cron_secret_123456");
    const { GET } = await import("@/app/api/internal/media/cleanup/route");

    const response = await GET(new Request("https://www.woven.video/api/internal/media/cleanup", {
      method: "GET",
      headers: { authorization: "Bearer wrong" },
    }));

    expect(response.status).toBe(401);
    expect(mocks.claimExpiredMediaForDeletion).not.toHaveBeenCalled();
  });
});
