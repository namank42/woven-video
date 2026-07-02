import { apiError } from "@/lib/api/responses";
import {
  claimExpiredMediaForDeletion,
  completeMediaAssetDeletions,
  releaseMediaAssetDeletionClaims,
  type MediaDeletionCandidate,
} from "@/lib/media/cleanup";
import { getMediaEnv } from "@/lib/media/env";

const MAX_MEDIA_CLEANUP_KEY_LENGTH = 512;
const PENDING_PLACEHOLDER_STORAGE_KEY =
  /^pending\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_MEDIA_CLEANUP_KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

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
    const partitioned = partitionMediaDeletionCandidates(candidates);

    if (partitioned.invalidAssetIds.length > 0) {
      console.warn("Releasing invalid media cleanup keys", {
        asset_ids: partitioned.invalidAssetIds,
        storage_keys: partitioned.invalidStorageKeys,
      });
    }

    if (partitioned.objectKeys.length > 0) {
      try {
        const deleteResponse = await fetch(`${env.baseUrl}/internal/delete`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-woven-media-worker-secret": env.workerSharedSecret,
          },
          body: JSON.stringify({ keys: partitioned.objectKeys }),
        });

        if (!deleteResponse.ok) {
          throw new Error(`Media Worker delete failed with status ${deleteResponse.status}`);
        }
      } catch (error) {
        await releaseMediaAssetDeletionClaims(candidates.map((asset) => asset.id));
        throw error;
      }
    }

    await completeMediaAssetDeletions(partitioned.completableAssetIds);
    if (partitioned.invalidAssetIds.length > 0) {
      await releaseMediaAssetDeletionClaims(partitioned.invalidAssetIds);
    }

    return Response.json(
      {
        deleted_count: partitioned.completableAssetIds.length,
        object_delete_count: partitioned.objectKeys.length,
      },
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

function partitionMediaDeletionCandidates(candidates: MediaDeletionCandidate[]) {
  const objectKeys: string[] = [];
  const completableAssetIds: string[] = [];
  const invalidAssetIds: string[] = [];
  const invalidStorageKeys: string[] = [];

  for (const candidate of candidates) {
    if (isValidMediaCleanupObjectKey(candidate.storage_key)) {
      objectKeys.push(candidate.storage_key);
      completableAssetIds.push(candidate.id);
    } else if (PENDING_PLACEHOLDER_STORAGE_KEY.test(candidate.storage_key)) {
      completableAssetIds.push(candidate.id);
    } else {
      invalidAssetIds.push(candidate.id);
      invalidStorageKeys.push(candidate.storage_key);
    }
  }

  return {
    objectKeys,
    completableAssetIds,
    invalidAssetIds,
    invalidStorageKeys,
  };
}

function isValidMediaCleanupObjectKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_MEDIA_CLEANUP_KEY_LENGTH) {
    return false;
  }

  const segments = key.split("/");
  if (!segments.every(isSafeMediaCleanupKeySegment)) return false;

  return isValidTempMediaCleanupKey(segments) || isValidOutputMediaCleanupKey(segments);
}

function isValidTempMediaCleanupKey(segments: string[]): boolean {
  return (
    segments.length === 6 &&
    segments[0] === "users" &&
    segments[2] === "media" &&
    segments[3] === "tmp" &&
    /^input\.[A-Za-z0-9]+$/.test(segments[5])
  );
}

function isValidOutputMediaCleanupKey(segments: string[]): boolean {
  return (
    segments.length === 9 &&
    segments[0] === "users" &&
    segments[2] === "media" &&
    segments[3] === "outputs" &&
    segments[6] === "attempts" &&
    /^output\.[A-Za-z0-9]+$/.test(segments[8])
  );
}

function isSafeMediaCleanupKeySegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    SAFE_MEDIA_CLEANUP_KEY_SEGMENT.test(segment)
  );
}
