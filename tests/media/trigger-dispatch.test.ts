import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: mocks.trigger,
  },
}));

describe("dispatchMediaJob", () => {
  afterEach(() => {
    mocks.trigger.mockReset();
    vi.resetModules();
  });

  it("dispatches process-media-job with job idempotency, queue, tags, and per-user concurrency", async () => {
    mocks.trigger.mockResolvedValue({ id: "run_123" });
    const { dispatchMediaJob } = await import("@/lib/media/trigger-dispatch");

    await expect(dispatchMediaJob({
      jobId: "job_123",
      userId: "user_123",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
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
          "media-kind:image",
          "media-queue:media-image",
          "media-queue-limit:10",
          "media-model:fal-ai/nano-banana-lite",
          "media-user:user_123",
        ],
      },
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
});
