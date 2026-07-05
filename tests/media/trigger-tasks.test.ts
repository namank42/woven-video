import { afterEach, describe, expect, it, vi } from "vitest";

type ProcessMediaJobTaskShape = {
  id: string;
  queue: { name: string; concurrencyLimit: number };
  run: (payload: { jobId: string }) => Promise<{ jobId: string; status: string }>;
};

type ReconcileMediaJobsTaskShape = {
  id: string;
  cron: string;
  run: () => Promise<{ finalized: number; dispatched: number }>;
};

const mocks = vi.hoisted(() => ({
  queue: vi.fn((definition) => definition),
  task: vi.fn((definition) => definition),
  schedulesTask: vi.fn((definition) => definition),
  waitFor: vi.fn(async () => undefined),
  processMediaJob: vi.fn(),
  finalizeExpiredMediaJobsForReconciliation: vi.fn(),
  findMediaJobsForTriggerReconciliation: vi.fn(),
  dispatchMediaJob: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  queue: mocks.queue,
  task: mocks.task,
  schedules: { task: mocks.schedulesTask },
  wait: { for: mocks.waitFor },
}));
vi.mock("@/lib/media/executor", () => ({ processMediaJob: mocks.processMediaJob }));
vi.mock("@/lib/media/job-claims", () => ({
  finalizeExpiredMediaJobsForReconciliation: mocks.finalizeExpiredMediaJobsForReconciliation,
  findMediaJobsForTriggerReconciliation: mocks.findMediaJobsForTriggerReconciliation,
}));
vi.mock("@/lib/media/trigger-dispatch", () => ({
  dispatchMediaJob: mocks.dispatchMediaJob,
  mediaQueueForKind: (kind: "image" | "video" | "audio") => {
    switch (kind) {
      case "image":
        return { name: "media-image", concurrencyLimit: 10 };
      case "video":
        return { name: "media-video", concurrencyLimit: 2 };
      case "audio":
        return { name: "media-audio", concurrencyLimit: 3 };
    }
  },
}));
vi.mock("@/lib/media/providers/fal", () => ({ falMediaAdapter: { provider: "fal" } }));
vi.mock("@/lib/media/providers/elevenlabs", () => ({ elevenLabsMediaAdapter: { provider: "elevenlabs" } }));

describe("Trigger media tasks", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
    });
  });

  it("defines process-media-job with real executor and Trigger wait", async () => {
    mocks.processMediaJob.mockResolvedValue({ jobId: "job_1", status: "succeeded" });
    const { processMediaJobTask } = await import("@/trigger/media");
    const processTask = processMediaJobTask as unknown as ProcessMediaJobTaskShape;

    expect(processTask.id).toBe("process-media-job");
    expect(processTask.queue).toEqual({ name: "media-image", concurrencyLimit: 10 });
    expect(mocks.queue).toHaveBeenCalledWith({ name: "media-image", concurrencyLimit: 10 });
    expect(mocks.queue).toHaveBeenCalledWith({ name: "media-video", concurrencyLimit: 2 });
    expect(mocks.queue).toHaveBeenCalledWith({ name: "media-audio", concurrencyLimit: 3 });
    await expect(processTask.run({ jobId: "job_1" })).resolves.toEqual({
      jobId: "job_1",
      status: "succeeded",
    });
    expect(mocks.processMediaJob).toHaveBeenCalledWith({
      jobId: "job_1",
      adapters: expect.objectContaining({
        fal: { provider: "fal" },
        elevenlabs: { provider: "elevenlabs" },
      }),
      waitFor: expect.any(Function),
    });
  });

  it("defines a scheduled reconciliation task that redispatches stale jobs idempotently", async () => {
    mocks.finalizeExpiredMediaJobsForReconciliation.mockResolvedValue([
      { jobId: "expired_1" },
      { jobId: "expired_2" },
    ]);
    mocks.findMediaJobsForTriggerReconciliation.mockResolvedValue([
      { jobId: "job_1", userId: "user_1", modelId: "fal-ai/nano-banana-lite", kind: "image" },
      { jobId: "job_2", userId: "user_2", modelId: "fal-ai/veo3.1", kind: "video" },
    ]);
    const { reconcileMediaJobsTask } = await import("@/trigger/media");
    const reconcileTask = reconcileMediaJobsTask as unknown as ReconcileMediaJobsTaskShape;

    expect(reconcileTask.id).toBe("reconcile-media-jobs");
    expect(reconcileTask.cron).toBe("*/5 * * * *");
    await expect(reconcileTask.run()).resolves.toEqual({ finalized: 2, dispatched: 2 });
    expect(mocks.finalizeExpiredMediaJobsForReconciliation).toHaveBeenCalledWith(100);
    expect(mocks.findMediaJobsForTriggerReconciliation).toHaveBeenCalledWith(25);
    expect(mocks.dispatchMediaJob).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchMediaJob).toHaveBeenNthCalledWith(1, {
      jobId: "job_1",
      userId: "user_1",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
      source: "reconcile",
    });
    expect(mocks.dispatchMediaJob).toHaveBeenNthCalledWith(2, {
      jobId: "job_2",
      userId: "user_2",
      modelId: "fal-ai/veo3.1",
      kind: "video",
      source: "reconcile",
    });
  });

  it("still dispatches stale jobs when no expired jobs were finalized", async () => {
    mocks.finalizeExpiredMediaJobsForReconciliation.mockResolvedValue([]);
    mocks.findMediaJobsForTriggerReconciliation.mockResolvedValue([
      { jobId: "job_1", userId: "user_1", modelId: "fal-ai/nano-banana-lite", kind: "image" },
    ]);

    const { reconcileMediaJobsTask } = await import("@/trigger/media");
    const reconcileTask = reconcileMediaJobsTask as unknown as ReconcileMediaJobsTaskShape;

    await expect(reconcileTask.run()).resolves.toEqual({ finalized: 0, dispatched: 1 });
    expect(mocks.dispatchMediaJob).toHaveBeenCalledWith({
      jobId: "job_1",
      userId: "user_1",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
      source: "reconcile",
    });
  });
});
