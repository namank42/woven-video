import { describe, expect, it } from "vitest";
import { extensionFor, mediaInputKey, mediaOutputKey } from "@/lib/media/storage-keys";

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

  it("prefers safe content-type extensions over filename extensions", () => {
    expect(mediaInputKey({
      userId: "user_1",
      assetId: "asset_1",
      filename: "photo.html",
      contentType: "image/png",
    })).toBe("users/user_1/media/tmp/asset_1/input.png");
  });

  it("uses bin for unknown content types regardless of filename", () => {
    expect(extensionFor("payload.html", "image/svg+xml")).toBe(".bin");
  });

  it("rejects unsafe input key path segments", () => {
    expect(() => mediaInputKey({
      userId: "user/1",
      assetId: "asset_1",
      filename: "clip.mp4",
      contentType: "video/mp4",
    })).toThrow("userId must be a safe path segment.");

    expect(() => mediaInputKey({
      userId: "user_1",
      assetId: "asset/1",
      filename: "clip.mp4",
      contentType: "video/mp4",
    })).toThrow("assetId must be a safe path segment.");
  });

  it("rejects unsafe output key path segments", () => {
    expect(() => mediaOutputKey({
      userId: "",
      jobId: "job_1",
      outputId: "out_1",
      contentType: "video/mp4",
    })).toThrow("userId must be a safe path segment.");

    expect(() => mediaOutputKey({
      userId: "user_1",
      jobId: "job/1",
      outputId: "out_1",
      contentType: "video/mp4",
    })).toThrow("jobId must be a safe path segment.");

    expect(() => mediaOutputKey({
      userId: "user_1",
      jobId: "job_1",
      outputId: "out/1",
      contentType: "video/mp4",
    })).toThrow("outputId must be a safe path segment.");
  });
});
