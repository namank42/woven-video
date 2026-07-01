import { apiError } from "@/lib/api/responses";
import { markInputAssetUploaded } from "@/lib/media/assets";
import { getMediaEnv } from "@/lib/media/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-woven-media-worker-secret");
  if (secret !== getMediaEnv().workerSharedSecret) {
    return apiError("Unauthorized.", 401, "unauthorized");
  }

  const payload = await request.json().catch(() => null);
  if (!isObject(payload)) {
    return apiError("Request body must be a JSON object.");
  }

  const assetId = typeof payload.asset_id === "string" ? payload.asset_id : "";
  const storageKey = typeof payload.storage_key === "string" ? payload.storage_key : "";
  if (
    !assetId ||
    !storageKey ||
    typeof payload.size_bytes !== "number" ||
    !Number.isInteger(payload.size_bytes) ||
    payload.size_bytes < 0
  ) {
    return apiError("Invalid upload completion payload.", 400, "invalid_media_input");
  }

  try {
    await markInputAssetUploaded({ assetId, storageKey, sizeBytes: payload.size_bytes });
  } catch (error) {
    console.error("Failed to mark media upload complete", error);
    return apiError(
      "Unable to mark media upload complete.",
      500,
      "media_upload_complete_failed",
    );
  }

  return Response.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
