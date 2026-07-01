import { elevenLabsMediaAdapter } from "@/lib/media/providers/elevenlabs";
import { falMediaAdapter } from "@/lib/media/providers/fal";
import { drainOneMediaJob } from "@/lib/media/worker";

const DEFAULT_POLL_MS = 2_000;
const pollMs = parsePollMs(process.env.MEDIA_WORKER_POLL_MS);
const errorDelayMs = Math.max(pollMs, 1_000);
const abortController = new AbortController();

process.once("SIGINT", () => abortController.abort(new DOMException("SIGINT", "AbortError")));
process.once("SIGTERM", () => abortController.abort(new DOMException("SIGTERM", "AbortError")));

async function main() {
  console.log(`Media worker started; polling every ${pollMs}ms.`);

  while (!abortController.signal.aborted) {
    try {
      const result = await drainOneMediaJob({
        adapters: {
          fal: falMediaAdapter,
          elevenlabs: elevenLabsMediaAdapter,
        },
        signal: abortController.signal,
      });

      if (!result.claimed) {
        await sleep(pollMs, abortController.signal);
      }
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted) {
        break;
      }

      console.error("Media worker drain failed", error);
      await sleep(errorDelayMs, abortController.signal).catch(() => undefined);
    }
  }

  console.log("Media worker stopped.");
}

main().catch((error) => {
  console.error("Media worker startup failed", error);
  process.exit(1);
});

function parsePollMs(raw: string | undefined) {
  if (!raw) return DEFAULT_POLL_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("MEDIA_WORKER_POLL_MS must be a positive integer.");
  }
  return parsed;
}

function sleep(ms: number, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    }, { once: true });
  });
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}
