import { apiError } from "@/lib/api/responses";
import { markExpiredMediaForDeletion } from "@/lib/media/cleanup";
import { getMediaEnv } from "@/lib/media/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let workerSharedSecret: string;
  try {
    workerSharedSecret = getMediaEnv().workerSharedSecret;
  } catch (error) {
    console.error("Media cleanup route is not configured", error);
    return apiError("Unable to clean up media assets.", 500, "media_cleanup_failed");
  }

  if (request.headers.get("x-woven-media-worker-secret") !== workerSharedSecret) {
    return apiError("Unauthorized.", 401, "unauthorized");
  }

  try {
    const deleted = await markExpiredMediaForDeletion();

    return Response.json(
      { deleted_count: deleted.length },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Failed to clean up media assets", error);
    return apiError("Unable to clean up media assets.", 500, "media_cleanup_failed");
  }
}
