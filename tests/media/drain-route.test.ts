import { afterEach, describe, expect, it, vi } from "vitest";

describe("internal media drain route", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/media/env");
    vi.doUnmock("@/lib/media/providers/fal");
    vi.doUnmock("@/lib/media/providers/elevenlabs");
    vi.doUnmock("@/lib/media/worker");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects requests without the worker shared secret", async () => {
    const drainOneMediaJob = vi.fn();
    mockRouteDependencies({ drainOneMediaJob });
    const { POST, dynamic, runtime } = await import("@/app/api/internal/media/jobs/drain/route");

    const response = await POST(new Request("https://example.test/api/internal/media/jobs/drain", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "wrong" },
    }));

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
    expect(drainOneMediaJob).not.toHaveBeenCalled();
  });

  it("drains one job with provider adapters when the secret is valid", async () => {
    const drainOneMediaJob = vi.fn(async () => ({
      claimed: true,
      jobId: "job_1",
      status: "waiting_provider",
    }));
    const adapters = mockRouteDependencies({ drainOneMediaJob });
    const { POST } = await import("@/app/api/internal/media/jobs/drain/route");

    const response = await POST(new Request("https://example.test/api/internal/media/jobs/drain", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "shared_secret" },
    }));

    expect(drainOneMediaJob).toHaveBeenCalledWith({
      adapters: {
        fal: adapters.falMediaAdapter,
        elevenlabs: adapters.elevenLabsMediaAdapter,
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "waiting_provider",
    });
  });

  it("returns a safe 500 when draining throws unexpectedly", async () => {
    const drainOneMediaJob = vi.fn(async () => {
      throw new Error("database details");
    });
    mockRouteDependencies({ drainOneMediaJob });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/internal/media/jobs/drain/route");

    const response = await POST(new Request("https://example.test/api/internal/media/jobs/drain", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "shared_secret" },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "media_job_drain_failed",
        message: "Unable to drain media job.",
      },
    });
  });
});

function mockRouteDependencies({
  drainOneMediaJob,
}: {
  drainOneMediaJob: ReturnType<typeof vi.fn>;
}) {
  const falMediaAdapter = { run: vi.fn() };
  const elevenLabsMediaAdapter = { run: vi.fn() };

  vi.doMock("@/lib/media/env", () => ({
    getMediaEnv: () => ({
      workerSharedSecret: "shared_secret",
    }),
  }));
  vi.doMock("@/lib/media/providers/fal", () => ({ falMediaAdapter }));
  vi.doMock("@/lib/media/providers/elevenlabs", () => ({ elevenLabsMediaAdapter }));
  vi.doMock("@/lib/media/worker", () => ({ drainOneMediaJob }));

  return { falMediaAdapter, elevenLabsMediaAdapter };
}
