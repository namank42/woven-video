import { task } from "@trigger.dev/sdk";

export const processMediaJobTask = task({
  id: "process-media-job",
  run: async ({ jobId }: { jobId: string }) => {
    throw new Error(`process-media-job is not implemented yet for job ${jobId}.`);
  },
});
