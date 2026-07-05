import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { completeInputAssetUploadForUser } from "@/lib/media/assets";
import { getMediaEnv } from "@/lib/media/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UploadCompleteRouteContext = {
  params: Promise<{ assetId: string }>;
};

export async function POST(
  request: Request,
  context: UploadCompleteRouteContext,
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  if (getMediaEnv().uploadCompletionMode !== "manual") {
    return apiError("Not found.", 404, "not_found");
  }

  const { assetId } = await context.params;
  if (!assetId) {
    return apiError("asset_id is required.", 400, "invalid_media_input");
  }

  try {
    await completeInputAssetUploadForUser({
      userId: authResult.auth.user.id,
      assetId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "media_upload_complete_failed";
    if (message === "media_asset_not_found") {
      return apiError("Upload asset was not found.", 404, "media_asset_not_found");
    }
    console.error("Failed to manually complete media upload", error);
    return apiError(
      "Unable to mark media upload complete.",
      500,
      "media_upload_complete_failed",
    );
  }

  return Response.json(
    { ok: true, asset_id: assetId },
    { headers: { "cache-control": "no-store" } },
  );
}
