import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  type FalWebhookHeaders,
  verifyFalWebhookSignature,
} from "@/lib/media/providers/fal-webhooks";

describe("Fal webhook signature verification", () => {
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
