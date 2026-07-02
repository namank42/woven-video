export type MediaEnv = {
  baseUrl: string;
  tokenSecret: string;
  workerSharedSecret: string;
  maxUploadBytes: number;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
  outputRetentionSeconds: number;
  jobTimeoutSeconds: number;
  workerPollMs: number;
  falWebhookBaseUrl: string | null;
  falWebhookJwksUrl: string | null;
};

const PLACEHOLDER_SECRET = "replace_with_32_plus_random_bytes";
const DEFAULT_FAL_WEBHOOK_JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";

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

function optionalUrlEnv(name: string, fallback: string | null = null): string | null {
  const raw = process.env[name]?.trim() || fallback;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }
  return raw.replace(/\/+$/, "");
}

export function getMediaEnv(): MediaEnv {
  const tokenSecret = secretEnv("MEDIA_TOKEN_SECRET");
  const workerSharedSecret = secretEnv("MEDIA_WORKER_SHARED_SECRET");

  return {
    baseUrl: (process.env.MEDIA_BASE_URL ?? "https://media.woven.video").replace(/\/+$/, ""),
    tokenSecret,
    workerSharedSecret,
    maxUploadBytes: integerEnv("MEDIA_MAX_UPLOAD_BYTES", 100 * 1024 * 1024),
    uploadUrlTtlSeconds: integerEnv("MEDIA_UPLOAD_URL_TTL_SECONDS", 15 * 60),
    downloadUrlTtlSeconds: integerEnv("MEDIA_DOWNLOAD_URL_TTL_SECONDS", 15 * 60),
    outputRetentionSeconds: integerEnv("MEDIA_OUTPUT_RETENTION_SECONDS", 30 * 24 * 60 * 60),
    jobTimeoutSeconds: integerEnv("MEDIA_JOB_TIMEOUT_SECONDS", 3600),
    workerPollMs: integerEnv("MEDIA_WORKER_POLL_MS", 5000),
    falWebhookBaseUrl: optionalUrlEnv("MEDIA_FAL_WEBHOOK_BASE_URL"),
    falWebhookJwksUrl: optionalUrlEnv("FAL_WEBHOOK_JWKS_URL", DEFAULT_FAL_WEBHOOK_JWKS_URL),
  };
}

export function getMediaJobTimeoutSeconds(): number {
  return integerEnv("MEDIA_JOB_TIMEOUT_SECONDS", 3600);
}
