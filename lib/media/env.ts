export type MediaEnv = {
  baseUrl: string;
  tokenSecret: string;
  workerSharedSecret: string;
  maxUploadBytes: number;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
};

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function getMediaEnv(): MediaEnv {
  const tokenSecret = process.env.MEDIA_TOKEN_SECRET;
  const workerSharedSecret = process.env.MEDIA_WORKER_SHARED_SECRET;
  if (!tokenSecret) throw new Error("Missing MEDIA_TOKEN_SECRET.");
  if (!workerSharedSecret) throw new Error("Missing MEDIA_WORKER_SHARED_SECRET.");

  return {
    baseUrl: (process.env.MEDIA_BASE_URL ?? "https://media.woven.video").replace(/\/$/, ""),
    tokenSecret,
    workerSharedSecret,
    maxUploadBytes: integerEnv("MEDIA_MAX_UPLOAD_BYTES", 100 * 1024 * 1024),
    uploadUrlTtlSeconds: integerEnv("MEDIA_UPLOAD_URL_TTL_SECONDS", 15 * 60),
    downloadUrlTtlSeconds: integerEnv("MEDIA_DOWNLOAD_URL_TTL_SECONDS", 15 * 60),
  };
}
