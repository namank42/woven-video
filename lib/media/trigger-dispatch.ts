import { tasks } from "@trigger.dev/sdk";

import {
  recordMediaJobTriggerDispatch,
  type MediaDispatchSource,
} from "@/lib/media/job-claims";
import type { processMediaJobTask } from "@/trigger/media";

export type DispatchMediaJobPayload = {
  jobId: string;
  userId: string;
  modelId: string;
  kind: "image" | "video" | "audio";
  source: MediaDispatchSource;
};

export type TriggerMediaKind = DispatchMediaJobPayload["kind"];

export type DispatchMediaJobResult = {
  runId: string;
};

export function isTriggerMediaKind(kind: string): kind is TriggerMediaKind {
  return kind === "image" || kind === "video" || kind === "audio";
}

export function mediaQueueForKind(kind: TriggerMediaKind) {
  switch (kind) {
    case "image":
      return { name: "media-image", concurrencyLimit: 10 };
    case "video":
      return { name: "media-video", concurrencyLimit: 2 };
    case "audio":
      return { name: "media-audio", concurrencyLimit: 3 };
  }
}

export function mediaConcurrencyKey(userId: string) {
  return `media-user:${userId}`;
}

export async function dispatchMediaJob({
  jobId,
  userId,
  modelId,
  kind,
  source,
}: DispatchMediaJobPayload): Promise<DispatchMediaJobResult> {
  const queue = mediaQueueForKind(kind);
  const handle = await tasks.trigger<typeof processMediaJobTask>(
    "process-media-job",
    { jobId },
    {
      idempotencyKey: jobId,
      concurrencyKey: mediaConcurrencyKey(userId),
      queue: queue.name,
      tags: [
        "media",
        `media-job:${jobId}`,
        `media-kind:${kind}`,
        `media-queue:${queue.name}`,
        `media-model:${modelId}`,
        `media-dispatch-source:${source}`,
        mediaConcurrencyKey(userId),
      ],
    },
  );

  try {
    await recordMediaJobTriggerDispatch({
      jobId,
      runId: handle.id,
      source,
      idempotencyKey: jobId,
    });
  } catch (error) {
    console.error("Failed to record media Trigger dispatch metadata", error);
  }

  return { runId: handle.id };
}
