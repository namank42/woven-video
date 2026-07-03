import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF;

if (!project) {
  throw new Error("TRIGGER_PROJECT_REF is required for Trigger.dev media execution.");
}

export default defineConfig({
  project,
  dirs: ["./trigger"],
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  maxDuration: 3_600,
});
