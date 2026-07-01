const SAFE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
};

export function mediaInputKey({
  userId,
  assetId,
  filename,
  contentType,
}: {
  userId: string;
  assetId: string;
  filename: string;
  contentType: string;
}): string {
  const safeUserId = safeSegment("userId", userId);
  const safeAssetId = safeSegment("assetId", assetId);
  const extension = extensionFor(filename, contentType);
  return `users/${safeUserId}/media/tmp/${safeAssetId}/input${extension}`;
}

export function mediaOutputKey({
  userId,
  jobId,
  outputId,
  contentType,
}: {
  userId: string;
  jobId: string;
  outputId: string;
  contentType: string;
}): string {
  const safeUserId = safeSegment("userId", userId);
  const safeJobId = safeSegment("jobId", jobId);
  const safeOutputId = safeSegment("outputId", outputId);
  return `users/${safeUserId}/media/outputs/${safeJobId}/${safeOutputId}${extensionFor("", contentType)}`;
}

export function extensionFor(_filename: string, contentType: string): string {
  const safeExtension = SAFE_EXTENSIONS[contentType];
  if (safeExtension) return safeExtension;

  return ".bin";
}

function safeSegment(name: string, value: string): string {
  if (!value || value.includes("/")) {
    throw new Error(`${name} must be a safe path segment.`);
  }
  return value;
}
