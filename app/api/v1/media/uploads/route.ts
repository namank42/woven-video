import { requireApiAuth } from "@/lib/api/auth";
import { licenseGateResponse } from "@/lib/api/license";
import { apiError } from "@/lib/api/responses";
import { createInputAssetUpload } from "@/lib/media/assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UploadBody = {
  purpose?: unknown;
  filename?: unknown;
  content_type?: unknown;
  size_bytes?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const licenseError = await licenseGateResponse(authResult.auth);
  if (licenseError) return licenseError;

  const payload = await request.json().catch(() => null);
  if (!isObject(payload)) {
    return apiError("Request body must be a JSON object.");
  }

  const body = payload as UploadBody;
  if (body.purpose !== "media_input") {
    return apiError("purpose must be media_input.", 400, "invalid_media_input");
  }
  if (typeof body.filename !== "string" || !body.filename.trim()) {
    return apiError("filename is required.", 400, "invalid_media_input");
  }
  if (typeof body.content_type !== "string" || !body.content_type.trim()) {
    return apiError("content_type is required.", 400, "invalid_media_input");
  }

  if (
    typeof body.size_bytes !== "number" ||
    !Number.isInteger(body.size_bytes) ||
    body.size_bytes <= 0
  ) {
    return apiError("size_bytes must be a positive integer.", 400, "invalid_media_input");
  }

  try {
    const upload = await createInputAssetUpload({
      userId: authResult.auth.user.id,
      filename: body.filename,
      contentType: body.content_type,
      sizeBytes: body.size_bytes,
    });

    return Response.json(
      {
        upload_id: upload.asset.id,
        asset_id: upload.asset.id,
        method: "PUT",
        upload_url: upload.uploadUrl,
        expires_at: upload.expiresAt,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create upload.";
    if (message === "invalid_media_input") {
      return apiError("Invalid media input.", 400, "invalid_media_input");
    }
    if (message === "upload_too_large") {
      return apiError("Upload is too large.", 413, "upload_too_large");
    }

    return apiError(message, 500, "media_upload_failed");
  }
}
