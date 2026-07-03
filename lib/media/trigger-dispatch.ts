import { tasks } from "@trigger.dev/sdk";

import type { processMediaJobTask } from "@/trigger/media";

export type DispatchMediaJobPayload = {
  jobId: string;
  userId: string;
  modelId: string;
  kind: "image" | "video" | "audio";
};

export type DispatchMediaJobResult = {
  runId: string;
};

export function mediaQueueForKind(kind: DispatchMediaJobPayload["kind"]) {
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
}: DispatchMediaJobPayload): Promise<DispatchMediaJobResult> {
  const handle = await tasks.trigger<typeof processMediaJobTask>(
    "process-media-job",
    { jobId },
    {
      idempotencyKey: jobId,
      concurrencyKey: mediaConcurrencyKey(userId),
      queue: mediaQueueForKind(kind),
      tags: [
        "media",
        `media-kind:${kind}`,
        `media-model:${modelId}`,
        mediaConcurrencyKey(userId),
      ],
    },
  );

  return { runId: handle.id };
}
