import {
  createHash,
  createPublicKey,
  type JsonWebKey,
  verify as verifySignature,
} from "node:crypto";

import { getMediaEnv } from "@/lib/media/env";

export type FalWebhookHeaders = {
  requestId: string;
  userId: string;
  timestamp: string;
  signature: string;
};

export type FalWebhookJwks = {
  keys: JsonWebKey[];
};

export type FalWebhookVerificationErrorKind = "invalid" | "infrastructure";

export class FalWebhookVerificationError extends Error {
  kind: FalWebhookVerificationErrorKind;
  code: string;

  constructor({
    kind,
    code,
    message,
    cause,
  }: {
    kind: FalWebhookVerificationErrorKind;
    code: string;
    message: string;
    cause?: unknown;
  }) {
    super(message);
    this.name = "FalWebhookVerificationError";
    this.kind = kind;
    this.code = code;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 10_000;
const ED25519_SIGNATURE_HEX_PATTERN = /^[0-9a-f]{128}$/i;

let cachedJwks: { jwks: FalWebhookJwks; expiresAtMs: number } | null = null;
let jwksFetchPromise: Promise<FalWebhookJwks> | null = null;

export function falWebhookHeaders(request: Request): FalWebhookHeaders {
  const headers = {
    requestId: headerValue(request, "x-fal-webhook-request-id"),
    userId: headerValue(request, "x-fal-webhook-user-id"),
    timestamp: headerValue(request, "x-fal-webhook-timestamp"),
    signature: headerValue(request, "x-fal-webhook-signature"),
  };

  if (!headers.requestId || !headers.userId || !headers.timestamp || !headers.signature) {
    throw falWebhookError("invalid", "missing_headers", "Missing Fal webhook signature headers.");
  }

  return headers;
}

export async function verifyFalWebhookSignature({
  headers,
  rawBody,
  jwks,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  headers: FalWebhookHeaders;
  rawBody: ArrayBuffer | Buffer | Uint8Array;
  jwks?: FalWebhookJwks;
  nowSeconds?: number;
}): Promise<true> {
  const timestampSeconds = Number(headers.timestamp);
  if (!Number.isInteger(timestampSeconds)) {
    throw falWebhookError("invalid", "invalid_timestamp", "Invalid Fal webhook timestamp.");
  }
  if (Math.abs(nowSeconds - timestampSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
    throw falWebhookError(
      "invalid",
      "stale_timestamp",
      "Fal webhook timestamp is outside the tolerance window.",
    );
  }
  if (!ED25519_SIGNATURE_HEX_PATTERN.test(headers.signature)) {
    throw falWebhookError("invalid", "malformed_signature", "Invalid Fal webhook signature.");
  }

  const resolvedJwks = jwks ?? await fetchFalWebhookJwks();
  const keys = falWebhookJwksKeys(resolvedJwks);
  const rawBodyBuffer = bodyBuffer(rawBody);
  const bodyDigest = createHash("sha256").update(rawBodyBuffer).digest("hex");
  const message = Buffer.from([
    headers.requestId,
    headers.userId,
    headers.timestamp,
    bodyDigest,
  ].join("\n"));
  const signature = Buffer.from(headers.signature, "hex");

  for (const key of keys) {
    if (key.kty !== "OKP" || key.crv !== "Ed25519") {
      continue;
    }

    try {
      const publicKey = createPublicKey({ key, format: "jwk" });
      if (verifySignature(null, message, publicKey, signature)) {
        return true;
      }
    } catch {
      continue;
    }
  }

  throw falWebhookError("invalid", "signature_mismatch", "Invalid Fal webhook signature.");
}

export function isFalWebhookVerificationError(
  error: unknown,
): error is FalWebhookVerificationError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "FalWebhookVerificationError" &&
    ((error as { kind?: unknown }).kind === "invalid" ||
      (error as { kind?: unknown }).kind === "infrastructure") &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function headerValue(request: Request, name: string): string {
  return request.headers.get(name)?.trim() ?? "";
}

function bodyBuffer(rawBody: ArrayBuffer | Buffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(rawBody)) {
    return rawBody;
  }
  if (rawBody instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(rawBody));
  }
  return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
}

async function fetchFalWebhookJwks(): Promise<FalWebhookJwks> {
  const nowMs = Date.now();
  if (cachedJwks && cachedJwks.expiresAtMs > nowMs) {
    return cachedJwks.jwks;
  }

  if (jwksFetchPromise) {
    return jwksFetchPromise;
  }

  jwksFetchPromise = fetchFreshFalWebhookJwks().finally(() => {
    jwksFetchPromise = null;
  });

  return jwksFetchPromise;
}

async function fetchFreshFalWebhookJwks(): Promise<FalWebhookJwks> {
  const jwksUrl = falWebhookJwksUrl();
  const timeout = AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(jwksUrl, { cache: "no-store", signal: timeout });
  } catch (error) {
    throw falWebhookError(
      "infrastructure",
      "jwks_fetch_failed",
      "Unable to fetch Fal webhook JWKS.",
      error,
    );
  }

  if (!response.ok) {
    throw falWebhookError(
      "infrastructure",
      "jwks_fetch_failed",
      "Unable to fetch Fal webhook JWKS.",
    );
  }

  let jwks: FalWebhookJwks;
  try {
    jwks = await response.json() as FalWebhookJwks;
    falWebhookJwksKeys(jwks);
  } catch (error) {
    throw falWebhookError(
      "infrastructure",
      "jwks_malformed",
      "Invalid Fal webhook JWKS.",
      error,
    );
  }

  cachedJwks = {
    jwks,
    expiresAtMs: Date.now() + JWKS_CACHE_TTL_MS,
  };
  return jwks;
}

function falWebhookJwksUrl(): string {
  try {
    const jwksUrl = getMediaEnv().falWebhookJwksUrl;
    if (!jwksUrl) {
      throw new Error("Missing FAL_WEBHOOK_JWKS_URL.");
    }
    return jwksUrl;
  } catch (error) {
    throw falWebhookError(
      "infrastructure",
      "jwks_config_invalid",
      "Invalid Fal webhook JWKS configuration.",
      error,
    );
  }
}

function falWebhookError(
  kind: FalWebhookVerificationErrorKind,
  code: string,
  message: string,
  cause?: unknown,
): FalWebhookVerificationError {
  return new FalWebhookVerificationError({ kind, code, message, cause });
}

function falWebhookJwksKeys(jwks: FalWebhookJwks): JsonWebKey[] {
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new Error("Invalid Fal webhook JWKS.");
  }

  return jwks.keys;
}
