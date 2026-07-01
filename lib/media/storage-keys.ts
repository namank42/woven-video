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
  const extension = extensionFor(filename, contentType);
  return `users/${userId}/media/tmp/${assetId}/input${extension}`;
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
  return `users/${userId}/media/outputs/${jobId}/${outputId}${extensionFor("", contentType)}`;
}

export function extensionFor(filename: string, contentType: string): string {
  const safeExtension = SAFE_EXTENSIONS[contentType];
  if (safeExtension) return safeExtension;

  const lower = filename.toLowerCase();
  const match = lower.match(/\.[a-z0-9]{1,8}$/);
  if (match) return match[0];
  return ".bin";
}
