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
});
