import { describe, expect, it } from "vitest";
import { signMediaToken, verifyMediaToken } from "@/lib/media/tokens";

describe("media tokens", () => {
  it("round trips a valid upload token", async () => {
    const token = await signMediaToken({
      kind: "upload",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      assetId: "asset_1",
      contentType: "image/png",
      sizeBytes: 10,
      exp: 2_000,
    }, "secret");

    await expect(verifyMediaToken(token, "secret", 1_000)).resolves.toMatchObject({
      kind: "upload",
      sub: "user_1",
      assetId: "asset_1",
    });
  });

  it("rejects expired and tampered tokens", async () => {
    const token = await signMediaToken({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      exp: 1_000,
    }, "secret");

    await expect(verifyMediaToken(token, "secret", 1_001)).resolves.toBeNull();
    await expect(verifyMediaToken(`${token}x`, "secret", 999)).resolves.toBeNull();
  });

  it("rejects tokens signed with a different secret", async () => {
    const token = await signHostileToken({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      exp: 2_000,
    });

    await expect(verifyMediaToken(token, "wrong-secret", 1_000)).resolves.toBeNull();
  });

  it("rejects malformed tokens and bodies", async () => {
    await expect(verifyMediaToken("not-a-token", "secret", 1_000)).resolves.toBeNull();
    await expect(verifyMediaToken("body.signature.extra", "secret", 1_000)).resolves.toBeNull();
    await expect(verifyMediaToken("!!!!.signature", "secret", 1_000)).resolves.toBeNull();
  });

  it("rejects tokens with missing or non-numeric expiration", async () => {
    await expect(verifyHostilePayload({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
    })).resolves.toBeNull();

    await expect(verifyHostilePayload({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      exp: "2000",
    })).resolves.toBeNull();
  });

  it("rejects tokens with invalid kind", async () => {
    await expect(verifyHostilePayload({
      kind: "preview",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      exp: 2_000,
    })).resolves.toBeNull();
  });

  it("rejects tokens with missing or blank subject and key", async () => {
    await expect(verifyHostilePayload({
      kind: "download",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      exp: 2_000,
    })).resolves.toBeNull();

    await expect(verifyHostilePayload({
      kind: "download",
      sub: "   ",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      exp: 2_000,
    })).resolves.toBeNull();

    await expect(verifyHostilePayload({
      kind: "download",
      sub: "user_1",
      exp: 2_000,
    })).resolves.toBeNull();

    await expect(verifyHostilePayload({
      kind: "download",
      sub: "user_1",
      key: " ",
      exp: 2_000,
    })).resolves.toBeNull();
  });

  it("rejects tokens with invalid size bytes", async () => {
    await expect(verifyHostilePayload({
      kind: "upload",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 0,
      exp: 2_000,
    })).resolves.toBeNull();

    await expect(verifyHostilePayload({
      kind: "upload",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 1.5,
      exp: 2_000,
    })).resolves.toBeNull();
  });

  it("rejects tokens with invalid optional string claims", async () => {
    await expect(verifyHostilePayload({
      kind: "upload",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      assetId: 123,
      exp: 2_000,
    })).resolves.toBeNull();

    await expect(verifyHostilePayload({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      jobId: 123,
      exp: 2_000,
    })).resolves.toBeNull();

    await expect(verifyHostilePayload({
      kind: "upload",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      contentType: 123,
      exp: 2_000,
    })).resolves.toBeNull();
  });
});

async function verifyHostilePayload(payload: unknown): Promise<unknown> {
  const token = await signHostileToken(payload);
  return verifyMediaToken(token, "secret", 1_000);
}

function signHostileToken(payload: unknown): Promise<string> {
  return signMediaToken(payload as never, "secret");
}
