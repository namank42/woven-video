import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: vi.fn((definition) => definition),
  schedulesTask: vi.fn((definition) => definition),
  waitFor: vi.fn(async () => undefined),
  processMediaJob: vi.fn(),
  findMediaJobsForTriggerReconciliation: vi.fn(),
  dispatchMediaJob: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  task: mocks.task,
  schedules: { task: mocks.schedulesTask },
  wait: { for: mocks.waitFor },
}));
vi.mock("@/lib/media/executor", () => ({ processMediaJob: mocks.processMediaJob }));
vi.mock("@/lib/media/job-claims", () => ({
  findMediaJobsForTriggerReconciliation: mocks.findMediaJobsForTriggerReconciliation,
}));
vi.mock("@/lib/media/trigger-dispatch", () => ({ dispatchMediaJob: mocks.dispatchMediaJob }));
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
    const processTask = processMediaJobTask as any;

    expect(processTask.id).toBe("process-media-job");
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
    mocks.findMediaJobsForTriggerReconciliation.mockResolvedValue([
      { jobId: "job_1", userId: "user_1", modelId: "fal-ai/nano-banana-lite", kind: "image" },
      { jobId: "job_2", userId: "user_2", modelId: "fal-ai/veo3.1", kind: "video" },
    ]);
    const { reconcileMediaJobsTask } = await import("@/trigger/media");
    const reconcileTask = reconcileMediaJobsTask as any;

    expect(reconcileTask.id).toBe("reconcile-media-jobs");
    expect(reconcileTask.cron).toBe("*/5 * * * *");
    await expect(reconcileTask.run()).resolves.toEqual({ dispatched: 2 });
    expect(mocks.dispatchMediaJob).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchMediaJob).toHaveBeenNthCalledWith(1, {
      jobId: "job_1",
      userId: "user_1",
      modelId: "fal-ai/nano-banana-lite",
      kind: "image",
    });
    expect(mocks.dispatchMediaJob).toHaveBeenNthCalledWith(2, {
      jobId: "job_2",
      userId: "user_2",
      modelId: "fal-ai/veo3.1",
      kind: "video",
    });
  });
});
