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
  const sizeBytes = Number(payload.size_bytes);
  if (!assetId || !storageKey || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    return apiError("Invalid upload completion payload.", 400, "invalid_media_input");
  }

  await markInputAssetUploaded({ assetId, storageKey, sizeBytes });

  return Response.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
