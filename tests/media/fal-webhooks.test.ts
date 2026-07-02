import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type FalWebhookHeaders,
  verifyFalWebhookSignature,
} from "@/lib/media/providers/fal-webhooks";

describe("Fal webhook signature verification", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("accepts a valid generated Ed25519 signature", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const rawBody = Buffer.from(JSON.stringify({ request_id: "fal_req_123" }));
    const headers: FalWebhookHeaders = {
      requestId: "webhook_req_1",
      userId: "fal_user_1",
      timestamp: "1700000000",
      signature: signFalWebhook({
        privateKey,
        rawBody,
        requestId: "webhook_req_1",
        userId: "fal_user_1",
        timestamp: "1700000000",
      }),
    };

    await expect(verifyFalWebhookSignature({
      headers,
      rawBody,
      jwks: { keys: [publicKey.export({ format: "jwk" })] },
      nowSeconds: 1_700_000_010,
    })).resolves.toBe(true);
  });

  it("rejects stale timestamps before accepting a signature", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const rawBody = Buffer.from(JSON.stringify({ request_id: "fal_req_123" }));
    const headers: FalWebhookHeaders = {
      requestId: "webhook_req_1",
      userId: "fal_user_1",
      timestamp: "1700000000",
      signature: signFalWebhook({
        privateKey,
        rawBody,
        requestId: "webhook_req_1",
        userId: "fal_user_1",
        timestamp: "1700000000",
      }),
    };

    await expect(verifyFalWebhookSignature({
      headers,
      rawBody,
      jwks: { keys: [publicKey.export({ format: "jwk" })] },
      nowSeconds: 1_700_000_301,
    })).rejects.toThrow("Fal webhook timestamp is outside the tolerance window.");
  });

  it("caches fetched JWKS for repeated verifications", async () => {
    process.env = {
      ...originalEnv,
      MEDIA_TOKEN_SECRET: "x".repeat(32),
      MEDIA_WORKER_SHARED_SECRET: "y".repeat(32),
    } as NodeJS.ProcessEnv;
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const rawBody = Buffer.from(JSON.stringify({ request_id: "fal_req_123" }));
    const headers: FalWebhookHeaders = {
      requestId: "webhook_req_1",
      userId: "fal_user_1",
      timestamp: "1700000000",
      signature: signFalWebhook({
        privateKey,
        rawBody,
        requestId: "webhook_req_1",
        userId: "fal_user_1",
        timestamp: "1700000000",
      }),
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      keys: [publicKey.export({ format: "jwk" })],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const module = await import("@/lib/media/providers/fal-webhooks");
    await expect(module.verifyFalWebhookSignature({
      headers,
      rawBody,
      nowSeconds: 1_700_000_010,
    })).resolves.toBe(true);
    await expect(module.verifyFalWebhookSignature({
      headers,
      rawBody,
      nowSeconds: 1_700_000_020,
    })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("https://rest.fal.ai/.well-known/jwks.json", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it("classifies JWKS fetch failures as infrastructure errors", async () => {
    process.env = {
      ...originalEnv,
      MEDIA_TOKEN_SECRET: "x".repeat(32),
      MEDIA_WORKER_SHARED_SECRET: "y".repeat(32),
    } as NodeJS.ProcessEnv;
    const rawBody = Buffer.from(JSON.stringify({ request_id: "fal_req_123" }));
    const headers: FalWebhookHeaders = {
      requestId: "webhook_req_1",
      userId: "fal_user_1",
      timestamp: "1700000000",
      signature: "a".repeat(128),
    };
    globalThis.fetch = vi.fn(async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;

    const module = await import("@/lib/media/providers/fal-webhooks");
    await expect(module.verifyFalWebhookSignature({
      headers,
      rawBody,
      nowSeconds: 1_700_000_010,
    })).rejects.toMatchObject({
      name: "FalWebhookVerificationError",
      kind: "infrastructure",
      code: "jwks_fetch_failed",
    });
  });

  it("classifies fetched JWKS with no usable Ed25519 keys as malformed and does not cache it", async () => {
    process.env = {
      ...originalEnv,
      MEDIA_TOKEN_SECRET: "x".repeat(32),
      MEDIA_WORKER_SHARED_SECRET: "y".repeat(32),
    } as NodeJS.ProcessEnv;
    const rawBody = Buffer.from(JSON.stringify({ request_id: "fal_req_123" }));
    const headers: FalWebhookHeaders = {
      requestId: "webhook_req_1",
      userId: "fal_user_1",
      timestamp: "1700000000",
      signature: "a".repeat(128),
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      keys: [
        { kty: "OKP", crv: "X25519", x: "not-ed25519" },
        { kty: "RSA", n: "bad", e: "AQAB" },
        { kty: "OKP", crv: "Ed25519", x: "not-valid-base64url" },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const module = await import("@/lib/media/providers/fal-webhooks");
    await expect(module.verifyFalWebhookSignature({
      headers,
      rawBody,
      nowSeconds: 1_700_000_010,
    })).rejects.toMatchObject({
      name: "FalWebhookVerificationError",
      kind: "infrastructure",
      code: "jwks_malformed",
    });
    await expect(module.verifyFalWebhookSignature({
      headers,
      rawBody,
      nowSeconds: 1_700_000_020,
    })).rejects.toMatchObject({
      code: "jwks_malformed",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent JWKS fetches while verification is in flight", async () => {
    process.env = {
      ...originalEnv,
      MEDIA_TOKEN_SECRET: "x".repeat(32),
      MEDIA_WORKER_SHARED_SECRET: "y".repeat(32),
    } as NodeJS.ProcessEnv;
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const rawBody = Buffer.from(JSON.stringify({ request_id: "fal_req_123" }));
    const headers: FalWebhookHeaders = {
      requestId: "webhook_req_1",
      userId: "fal_user_1",
      timestamp: "1700000000",
      signature: signFalWebhook({
        privateKey,
        rawBody,
        requestId: "webhook_req_1",
        userId: "fal_user_1",
        timestamp: "1700000000",
      }),
    };
    const fetchState: { resolve?: (response: Response) => void } = {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      fetchState.resolve = resolve;
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const module = await import("@/lib/media/providers/fal-webhooks");
    const firstVerification = module.verifyFalWebhookSignature({
      headers,
      rawBody,
      nowSeconds: 1_700_000_010,
    });
    const secondVerification = module.verifyFalWebhookSignature({
      headers,
      rawBody,
      nowSeconds: 1_700_000_010,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const resolveJwksFetch = fetchState.resolve;
    if (!resolveJwksFetch) {
      throw new Error("Expected JWKS fetch to be in flight.");
    }
    resolveJwksFetch(new Response(JSON.stringify({
      keys: [publicKey.export({ format: "jwk" })],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(Promise.all([firstVerification, secondVerification])).resolves.toEqual([true, true]);
  });
});

function signFalWebhook({
  privateKey,
  rawBody,
  requestId,
  userId,
  timestamp,
}: {
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  rawBody: Buffer;
  requestId: string;
  userId: string;
  timestamp: string;
}) {
  const bodyDigest = createHash("sha256").update(rawBody).digest("hex");
  const message = `${requestId}\n${userId}\n${timestamp}\n${bodyDigest}`;
  return sign(null, Buffer.from(message), privateKey).toString("hex");
}
