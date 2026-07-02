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

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const ED25519_SIGNATURE_HEX_PATTERN = /^[0-9a-f]{128}$/i;

export function falWebhookHeaders(request: Request): FalWebhookHeaders {
  const headers = {
    requestId: headerValue(request, "x-fal-webhook-request-id"),
    userId: headerValue(request, "x-fal-webhook-user-id"),
    timestamp: headerValue(request, "x-fal-webhook-timestamp"),
    signature: headerValue(request, "x-fal-webhook-signature"),
  };

  if (!headers.requestId || !headers.userId || !headers.timestamp || !headers.signature) {
    throw new Error("Missing Fal webhook signature headers.");
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
    throw new Error("Invalid Fal webhook timestamp.");
  }
  if (Math.abs(nowSeconds - timestampSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
    throw new Error("Fal webhook timestamp is outside the tolerance window.");
  }
  if (!ED25519_SIGNATURE_HEX_PATTERN.test(headers.signature)) {
    throw new Error("Invalid Fal webhook signature.");
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

  throw new Error("Invalid Fal webhook signature.");
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
  const jwksUrl = getMediaEnv().falWebhookJwksUrl;
  if (!jwksUrl) {
    throw new Error("Missing FAL_WEBHOOK_JWKS_URL.");
  }

  const response = await fetch(jwksUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to fetch Fal webhook JWKS.");
  }

  return await response.json() as FalWebhookJwks;
}

function falWebhookJwksKeys(jwks: FalWebhookJwks): JsonWebKey[] {
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new Error("Invalid Fal webhook JWKS.");
  }

  return jwks.keys;
}
