import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: mocks.trigger,
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

describe("dispatchMediaJob", () => {
  afterEach(() => {
    mocks.trigger.mockReset();
    mocks.createSupabaseAdminClient.mockReset();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("dispatches process-media-job with job idempotency, queue, tags, and per-user concurrency", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "job_123" }, error: null }));
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.trigger.mockResolvedValue({ id: "run_123" });
    const { dispatchMediaJob } = await import("@/lib/media/trigger-dispatch");

    await expect(dispatchMediaJob({
      jobId: "job_123",
      userId: "user_123",
      modelId: "google/nano-banana-2-lite",
      kind: "image",
      source: "create",
    })).resolves.toEqual({ runId: "run_123" });

    expect(mocks.trigger).toHaveBeenCalledWith(
      "process-media-job",
      { jobId: "job_123" },
      {
        idempotencyKey: "job_123",
        concurrencyKey: "media-user:user_123",
        queue: "media-image",
        tags: [
          "media",
          "media-job:job_123",
          "media-kind:image",
          "media-queue:media-image",
          "media-model:google/nano-banana-2-lite",
          "media-dispatch-source:create",
          "media-user:user_123",
        ],
      },
    );
    expect(rpc).toHaveBeenCalledWith("record_media_job_trigger_dispatch", {
      p_job_id: "job_123",
      p_run_id: "run_123",
      p_dispatch_source: "create",
      p_idempotency_key: "job_123",
      p_dispatched_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("does not fail dispatch when metadata persistence fails after Trigger accepts the run", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "database unavailable" } }));
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    mocks.trigger.mockResolvedValue({ id: "run_123" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { dispatchMediaJob } = await import("@/lib/media/trigger-dispatch");

    await expect(dispatchMediaJob({
      jobId: "job_123",
      userId: "user_123",
      modelId: "google/nano-banana-2-lite",
      kind: "image",
      source: "webhook",
    })).resolves.toEqual({ runId: "run_123" });

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to record media Trigger dispatch metadata",
      expect.any(Error),
    );
  });

  it("uses conservative video and audio queues", async () => {
    const { mediaQueueForKind } = await import("@/lib/media/trigger-dispatch");

    expect(mediaQueueForKind("video")).toEqual({
      name: "media-video",
      concurrencyLimit: 2,
    });
    expect(mediaQueueForKind("audio")).toEqual({
      name: "media-audio",
      concurrencyLimit: 3,
    });
  });

  it("exposes the Trigger-supported media kind predicate", async () => {
    const { isTriggerMediaKind } = await import("@/lib/media/trigger-dispatch");

    expect(isTriggerMediaKind("image")).toBe(true);
    expect(isTriggerMediaKind("video")).toBe(true);
    expect(isTriggerMediaKind("audio")).toBe(true);
    expect(isTriggerMediaKind("captions")).toBe(false);
  });
});
