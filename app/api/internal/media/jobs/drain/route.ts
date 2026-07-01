import { apiError } from "@/lib/api/responses";
import { getMediaEnv } from "@/lib/media/env";
import { elevenLabsMediaAdapter } from "@/lib/media/providers/elevenlabs";
import { falMediaAdapter } from "@/lib/media/providers/fal";
import { drainOneMediaJob } from "@/lib/media/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let workerSharedSecret: string;
  try {
    workerSharedSecret = getMediaEnv().workerSharedSecret;
  } catch (error) {
    console.error("Media drain route is not configured", error);
    return apiError("Unable to drain media job.", 500, "media_job_drain_failed");
  }

  if (request.headers.get("x-woven-media-worker-secret") !== workerSharedSecret) {
    return apiError("Unauthorized.", 401, "unauthorized");
  }

  try {
    const result = await drainOneMediaJob({
      adapters: {
        fal: falMediaAdapter,
        elevenlabs: elevenLabsMediaAdapter,
      },
    });

    return Response.json(result, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to drain media job", error);
    return apiError("Unable to drain media job.", 500, "media_job_drain_failed");
  }
}
