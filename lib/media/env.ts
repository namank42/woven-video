export type MediaEnv = {
  baseUrl: string;
  tokenSecret: string;
  workerSharedSecret: string;
  maxUploadBytes: number;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
  outputRetentionSeconds: number;
};

const PLACEHOLDER_SECRET = "replace_with_32_plus_random_bytes";

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function secretEnv(name: string): string {
  const secret = process.env[name];
  if (!secret) throw new Error(`Missing ${name}.`);
  if (secret === PLACEHOLDER_SECRET) {
    throw new Error(`${name} must not use the placeholder value.`);
  }
  if (secret.length < 32) {
    throw new Error(`${name} must be at least 32 characters.`);
  }
  return secret;
}

export function getMediaEnv(): MediaEnv {
  const tokenSecret = secretEnv("MEDIA_TOKEN_SECRET");
  const workerSharedSecret = secretEnv("MEDIA_WORKER_SHARED_SECRET");

  return {
    baseUrl: (process.env.MEDIA_BASE_URL ?? "https://media.woven.video").replace(/\/$/, ""),
    tokenSecret,
    workerSharedSecret,
    maxUploadBytes: integerEnv("MEDIA_MAX_UPLOAD_BYTES", 100 * 1024 * 1024),
    uploadUrlTtlSeconds: integerEnv("MEDIA_UPLOAD_URL_TTL_SECONDS", 15 * 60),
    downloadUrlTtlSeconds: integerEnv("MEDIA_DOWNLOAD_URL_TTL_SECONDS", 15 * 60),
    outputRetentionSeconds: integerEnv("MEDIA_OUTPUT_RETENTION_SECONDS", 30 * 24 * 60 * 60),
  };
}
