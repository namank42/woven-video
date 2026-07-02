import { afterEach, describe, expect, it } from "vitest";
import { getMediaEnv } from "@/lib/media/env";

const originalEnv = process.env;
const validSecret = "x".repeat(32);
const validWorkerSecret = "y".repeat(32);

function setMediaEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env = {
    ...originalEnv,
    MEDIA_TOKEN_SECRET: validSecret,
    MEDIA_WORKER_SHARED_SECRET: validWorkerSecret,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("media env", () => {
  afterEach(() => {
    process.env = originalEnv;
  });

  it("rejects missing secrets", () => {
    setMediaEnv({
      MEDIA_TOKEN_SECRET: undefined,
    });

    expect(() => getMediaEnv()).toThrow("Missing MEDIA_TOKEN_SECRET.");

    setMediaEnv({
      MEDIA_WORKER_SHARED_SECRET: undefined,
    });

    expect(() => getMediaEnv()).toThrow("Missing MEDIA_WORKER_SHARED_SECRET.");
  });

  it("rejects weak secrets", () => {
    setMediaEnv({
      MEDIA_TOKEN_SECRET: "short",
    });

    expect(() => getMediaEnv()).toThrow("MEDIA_TOKEN_SECRET must be at least 32 characters.");

    setMediaEnv({
      MEDIA_WORKER_SHARED_SECRET: "short",
    });

    expect(() => getMediaEnv()).toThrow("MEDIA_WORKER_SHARED_SECRET must be at least 32 characters.");
  });

  it("rejects placeholder secrets", () => {
    setMediaEnv({
      MEDIA_TOKEN_SECRET: "replace_with_32_plus_random_bytes",
    });

    expect(() => getMediaEnv()).toThrow("MEDIA_TOKEN_SECRET must not use the placeholder value.");

    setMediaEnv({
      MEDIA_WORKER_SHARED_SECRET: "replace_with_32_plus_random_bytes",
    });

    expect(() => getMediaEnv()).toThrow("MEDIA_WORKER_SHARED_SECRET must not use the placeholder value.");
  });

  it("trims a trailing slash from the media base URL", () => {
    setMediaEnv({
      MEDIA_BASE_URL: "https://media.example.test/",
    });

    expect(getMediaEnv().baseUrl).toBe("https://media.example.test");
  });

  it("parses positive integer settings", () => {
    setMediaEnv({
      MEDIA_MAX_UPLOAD_BYTES: "123",
      MEDIA_UPLOAD_URL_TTL_SECONDS: "456",
      MEDIA_DOWNLOAD_URL_TTL_SECONDS: "789",
    });

    expect(getMediaEnv()).toMatchObject({
      maxUploadBytes: 123,
      uploadUrlTtlSeconds: 456,
      downloadUrlTtlSeconds: 789,
    });
  });

  it("rejects non-positive and non-integer settings", () => {
    setMediaEnv({
      MEDIA_MAX_UPLOAD_BYTES: "0",
    });

    expect(() => getMediaEnv()).toThrow("MEDIA_MAX_UPLOAD_BYTES must be a positive integer.");

    setMediaEnv({
      MEDIA_UPLOAD_URL_TTL_SECONDS: "1.5",
    });

    expect(() => getMediaEnv()).toThrow("MEDIA_UPLOAD_URL_TTL_SECONDS must be a positive integer.");
  });
});
