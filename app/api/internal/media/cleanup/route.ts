import { apiError } from "@/lib/api/responses";
import {
  claimExpiredMediaForDeletion,
  completeMediaAssetDeletions,
  releaseMediaAssetDeletionClaims,
} from "@/lib/media/cleanup";
import { getMediaEnv } from "@/lib/media/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return apiError("Unauthorized.", 401, "unauthorized");
  }

  return runMediaCleanup();
}

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

  return runMediaCleanup();
}

async function runMediaCleanup() {
  try {
    const env = getMediaEnv();
    const candidates = await claimExpiredMediaForDeletion();
    const assetIds = candidates.map((asset) => asset.id);
    const keys = candidates.map((asset) => asset.storage_key);

    if (keys.length > 0) {
      try {
        const deleteResponse = await fetch(`${env.baseUrl}/internal/delete`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-woven-media-worker-secret": env.workerSharedSecret,
          },
          body: JSON.stringify({ keys }),
        });

        if (!deleteResponse.ok) {
          throw new Error(`Media Worker delete failed with status ${deleteResponse.status}`);
        }
      } catch (error) {
        await releaseMediaAssetDeletionClaims(assetIds);
        throw error;
      }
    }

    await completeMediaAssetDeletions(assetIds);

    return Response.json(
      { deleted_count: assetIds.length, object_delete_count: keys.length },
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
