import { afterEach, describe, expect, it } from "vitest";
import {
  getMediaEnv,
  getMediaJobTimeoutSeconds,
  isLoopbackMediaBaseUrl,
} from "@/lib/media/env";

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

  it("defaults upload completion mode to callback and parses manual mode", () => {
    setMediaEnv();
    expect(getMediaEnv().uploadCompletionMode).toBe("callback");

    setMediaEnv({
      MEDIA_UPLOAD_COMPLETION_MODE: "manual",
    });
    expect(getMediaEnv().uploadCompletionMode).toBe("manual");
  });

  it("rejects manual completion mode in production", () => {
    setMediaEnv({
      MEDIA_UPLOAD_COMPLETION_MODE: "manual",
      VERCEL_ENV: "production",
    });

    expect(() => getMediaEnv()).toThrow("MEDIA_UPLOAD_COMPLETION_MODE");
  });

  it("allows manual completion mode in preview/dev", () => {
    setMediaEnv({
      MEDIA_UPLOAD_COMPLETION_MODE: "manual",
      VERCEL_ENV: "preview",
    });

    expect(getMediaEnv().uploadCompletionMode).toBe("manual");
  });

  it("rejects unknown upload completion modes", () => {
    setMediaEnv({
      MEDIA_UPLOAD_COMPLETION_MODE: "client",
    });

    expect(() => getMediaEnv()).toThrow(
      "MEDIA_UPLOAD_COMPLETION_MODE must be callback or manual.",
    );
  });

  it("detects media base URLs that cloud providers cannot fetch", () => {
    expect(isLoopbackMediaBaseUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackMediaBaseUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackMediaBaseUrl("http://dev.localhost:8787")).toBe(true);
    expect(isLoopbackMediaBaseUrl("http://[::1]:8787")).toBe(true);

    expect(isLoopbackMediaBaseUrl("https://media-dev.woven.video")).toBe(false);
    expect(isLoopbackMediaBaseUrl("https://media.woven.video")).toBe(false);
    expect(isLoopbackMediaBaseUrl("not a url")).toBe(false);
  });

  it.each([
    ["http://10.0.0.5", true],
    ["http://192.168.1.1:8787", true],
    ["http://172.20.3.4", true],
    ["http://169.254.169.254", true],
    ["http://[fe80::1]", true],
    ["http://[fd00::1]", true],
    ["http://[::ffff:127.0.0.1]", true],
    ["https://media.woven.video", false],
    ["http://172.32.0.1", false],
  ])("isLoopbackMediaBaseUrl(%s) === %s", (url, expected) => {
    expect(isLoopbackMediaBaseUrl(url)).toBe(expected);
  });

  it("parses optional Fal webhook URLs and trims trailing slashes", () => {
    setMediaEnv({
      MEDIA_FAL_WEBHOOK_BASE_URL: "https://www.example.test/",
      FAL_WEBHOOK_JWKS_URL: "https://fal.example.test/.well-known/jwks/",
    });

    expect(getMediaEnv()).toMatchObject({
      falWebhookBaseUrl: "https://www.example.test",
      falWebhookJwksUrl: "https://fal.example.test/.well-known/jwks",
    });
  });

  it("uses the documented Fal JWKS URL by default", () => {
    setMediaEnv({
      MEDIA_FAL_WEBHOOK_BASE_URL: undefined,
      FAL_WEBHOOK_JWKS_URL: undefined,
    });

    expect(getMediaEnv()).toMatchObject({
      falWebhookBaseUrl: null,
      falWebhookJwksUrl: "https://rest.fal.ai/.well-known/jwks.json",
    });
  });

  it("rejects optional URL settings that are not HTTP URLs", () => {
    setMediaEnv({
      MEDIA_FAL_WEBHOOK_BASE_URL: "not a url",
    });

    expect(() => getMediaEnv()).toThrow("MEDIA_FAL_WEBHOOK_BASE_URL must be a valid http(s) URL.");

    setMediaEnv({
      FAL_WEBHOOK_JWKS_URL: "ftp://fal.example.test/jwks.json",
    });

    expect(() => getMediaEnv()).toThrow("FAL_WEBHOOK_JWKS_URL must be a valid http(s) URL.");
  });

  it("parses positive integer settings", () => {
    setMediaEnv({
      MEDIA_MAX_UPLOAD_BYTES: "123",
      MEDIA_UPLOAD_URL_TTL_SECONDS: "456",
      MEDIA_DOWNLOAD_URL_TTL_SECONDS: "789",
      MEDIA_OUTPUT_RETENTION_SECONDS: "3600",
      MEDIA_JOB_TIMEOUT_SECONDS: "7200",
    });

    expect(getMediaEnv()).toMatchObject({
      maxUploadBytes: 123,
      uploadUrlTtlSeconds: 456,
      downloadUrlTtlSeconds: 789,
      outputRetentionSeconds: 3600,
      jobTimeoutSeconds: 7200,
    });
  });

  it("defaults retention and timeout settings", () => {
    setMediaEnv();

    expect(getMediaEnv()).toMatchObject({
      outputRetentionSeconds: 2_592_000,
      jobTimeoutSeconds: 3600,
    });
  });

  it("reads job timeout without requiring unrelated secrets", () => {
    process.env = {
      ...originalEnv,
      MEDIA_JOB_TIMEOUT_SECONDS: "7200",
    } as NodeJS.ProcessEnv;

    expect(getMediaJobTimeoutSeconds()).toBe(7200);
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
