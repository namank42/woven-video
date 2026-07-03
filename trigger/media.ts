import { queue, schedules, task, wait } from "@trigger.dev/sdk";

import { processMediaJob } from "@/lib/media/executor";
import { findMediaJobsForTriggerReconciliation } from "@/lib/media/job-claims";
import { dispatchMediaJob, mediaQueueForKind } from "@/lib/media/trigger-dispatch";
import { elevenLabsMediaAdapter } from "@/lib/media/providers/elevenlabs";
import { falMediaAdapter } from "@/lib/media/providers/fal";

export const mediaImageQueue = queue(mediaQueueForKind("image"));
export const mediaVideoQueue = queue(mediaQueueForKind("video"));
export const mediaAudioQueue = queue(mediaQueueForKind("audio"));

export const processMediaJobTask = task({
  id: "process-media-job",
  queue: mediaImageQueue,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 30_000,
    factor: 2,
    randomize: true,
  },
  run: async ({ jobId }: { jobId: string }) => {
    return processMediaJob({
      jobId,
      adapters: {
        fal: falMediaAdapter,
        elevenlabs: elevenLabsMediaAdapter,
      },
      waitFor: async ({ seconds }) => wait.for({ seconds }),
    });
  },
});

export const reconcileMediaJobsTask = schedules.task({
  id: "reconcile-media-jobs",
  cron: "*/5 * * * *",
  run: async () => {
    const jobs = await findMediaJobsForTriggerReconciliation(25);

    for (const job of jobs) {
      await dispatchMediaJob({
        jobId: job.jobId,
        userId: job.userId,
        modelId: job.modelId,
        kind: job.kind,
      });
    }

    return { dispatched: jobs.length };
  },
});
