import { describe, expect, it } from "vitest";
import { mediaInputKey, mediaOutputKey } from "@/lib/media/storage-keys";

describe("media storage keys", () => {
  it("builds asset-scoped temp input keys", () => {
    expect(mediaInputKey({
      userId: "user_1",
      assetId: "asset_1",
      filename: "Clip.MOV",
      contentType: "video/quicktime",
    })).toBe("users/user_1/media/tmp/asset_1/input.mov");
  });

  it("builds job-scoped output keys", () => {
    expect(mediaOutputKey({
      userId: "user_1",
      jobId: "job_1",
      outputId: "out_1",
      contentType: "video/mp4",
    })).toBe("users/user_1/media/outputs/job_1/out_1.mp4");
  });
});
