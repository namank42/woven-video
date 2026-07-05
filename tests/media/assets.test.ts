import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaEnv } from "@/lib/media/env";
import {
  createInputAssetUpload,
  isSupportedInputContentType,
  markInputAssetUploaded,
  type MediaAssetRow,
} from "@/lib/media/assets";
import { verifyMediaToken } from "@/lib/media/tokens";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  getMediaEnv: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

vi.mock("@/lib/media/env", () => ({
  getMediaEnv: mocks.getMediaEnv,
}));

const mediaEnv: MediaEnv = {
  baseUrl: "https://media.example.test",
  tokenSecret: "test-token-secret",
  workerSharedSecret: "test-worker-secret",
  maxUploadBytes: 1_000,
  uploadUrlTtlSeconds: 60,
  downloadUrlTtlSeconds: 60,
  outputRetentionSeconds: 2_592_000,
  jobTimeoutSeconds: 3600,
  uploadCompletionMode: "callback",
  falWebhookBaseUrl: null,
  falWebhookJwksUrl: null,
};

type SupabaseError = { message: string };
type SupabaseResult<T> = { data: T | null; error: SupabaseError | null };
type QueryRoot = {
  insert?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
};
type QueryStep = {
  root: QueryRoot;
  inserted?: unknown;
  updated?: unknown;
  selected?: string;
  filters: Array<[string, unknown]>;
};

describe("media assets", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    mocks.getMediaEnv.mockReset();
    mocks.getMediaEnv.mockReturnValue(mediaEnv);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts image, video, and audio input content types only", () => {
    expect(isSupportedInputContentType("image/png")).toBe(true);
    expect(isSupportedInputContentType("video/quicktime")).toBe(true);
    expect(isSupportedInputContentType("audio/mpeg")).toBe(true);

    expect(isSupportedInputContentType("application/pdf")).toBe(false);
    expect(isSupportedInputContentType("text/plain")).toBe(false);
    expect(isSupportedInputContentType("")).toBe(false);
  });

  it("rejects invalid input content types and oversized uploads", async () => {
    await expect(createInputAssetUpload({
      userId: "user_1",
      filename: "input.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
    })).rejects.toThrow("invalid_media_input");

    await expect(createInputAssetUpload({
      userId: "user_1",
      filename: "input.png",
      contentType: "image/png",
      sizeBytes: mediaEnv.maxUploadBytes + 1,
    })).rejects.toThrow("upload_too_large");

    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("inserts a pending asset, stores the final key, and returns a Woven upload URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const storageKey = "users/user_1/media/tmp/asset_1/input.mov";
    const assetRow: MediaAssetRow = {
      id: "asset_1",
      user_id: "user_1",
      job_id: null,
      kind: "input",
      status: "pending",
      content_type: "video/quicktime",
      size_bytes: 123,
      original_filename: "x".repeat(180),
      storage_key: storageKey,
      upload_expires_at: "2026-07-01T12:01:00.000Z",
      metadata: {},
    };
    const insertStep = insertQuery({ data: { id: "asset_1" }, error: null });
    const updateStep = updateQuery({ data: assetRow, error: null });
    const admin = mockAdminWith(insertStep, updateStep);

    const upload = await createInputAssetUpload({
      userId: "user_1",
      filename: `${"x".repeat(200)}.mov`,
      contentType: "video/quicktime",
      sizeBytes: 123,
    });

    expect(admin.from).toHaveBeenCalledTimes(2);
    expect(admin.tables).toEqual(["media_assets", "media_assets"]);
    expect(insertStep.inserted).toMatchObject({
      user_id: "user_1",
      kind: "input",
      status: "pending",
      content_type: "video/quicktime",
      size_bytes: 123,
      upload_expires_at: "2026-07-01T12:01:00.000Z",
    });
    expect((insertStep.inserted as { original_filename: string }).original_filename).toHaveLength(180);
    expect((insertStep.inserted as { storage_key: string }).storage_key).toMatch(/^pending\//);

    expect(updateStep.updated).toEqual({ storage_key: storageKey });
    expect(updateStep.filters).toEqual([["id", "asset_1"]]);
    expect(upload.asset).toEqual(assetRow);
    expect(upload.expiresAt).toBe("2026-07-01T12:01:00.000Z");

    const url = new URL(upload.uploadUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://media.example.test/uploads/asset_1");
    const token = url.searchParams.get("token");
    expect(token).toBeTruthy();

    await expect(verifyMediaToken(token ?? "", mediaEnv.tokenSecret, 1_000)).resolves.toMatchObject({
      kind: "upload",
      sub: "user_1",
      key: storageKey,
      assetId: "asset_1",
      contentType: "video/quicktime",
      sizeBytes: 123,
      exp: Math.floor(new Date(upload.expiresAt).getTime() / 1000),
    });
  });

  it("marks the inserted asset failed when final key setup fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:03:00.000Z"));

    const insertStep = insertQuery({ data: { id: "asset_1" }, error: null });
    const finalKeyStep = updateQuery({
      data: null,
      error: { message: "storage key conflict" },
    });
    const cleanupStep = updateQuery({ data: null, error: null });
    const admin = mockAdminWith(insertStep, finalKeyStep, cleanupStep);

    await expect(createInputAssetUpload({
      userId: "user_1",
      filename: "input.png",
      contentType: "image/png",
      sizeBytes: 123,
    })).rejects.toThrow("storage key conflict");

    expect(admin.tables).toEqual(["media_assets", "media_assets", "media_assets"]);
    expect(cleanupStep.updated).toEqual({
      status: "failed",
      metadata: {
        setup_error: "storage key conflict",
        failed_at: "2026-07-01T12:03:00.000Z",
      },
    });
    expect(cleanupStep.filters).toEqual([["id", "asset_1"]]);
  });

  it("marks only matching pending input assets as uploaded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:02:00.000Z"));

    const updateStep = updateQuery({ data: { id: "asset_1" }, error: null });
    mockAdminWith(updateStep);

    await expect(markInputAssetUploaded({
      assetId: "asset_1",
      storageKey: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 321,
    })).resolves.toBeUndefined();

    expect(updateStep.updated).toEqual({
      status: "uploaded",
      size_bytes: 321,
      metadata: { uploaded_at: "2026-07-01T12:02:00.000Z" },
    });
    expect(updateStep.filters).toEqual([
      ["id", "asset_1"],
      ["storage_key", "users/user_1/media/tmp/asset_1/input.png"],
      ["status", "pending"],
    ]);
  });

  it("propagates upload completion update failures", async () => {
    const updateStep = updateQuery({
      data: null,
      error: { message: "no matching pending asset" },
    });
    mockAdminWith(updateStep);

    await expect(markInputAssetUploaded({
      assetId: "asset_1",
      storageKey: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 321,
    })).rejects.toThrow("no matching pending asset");
  });
});

describe("media upload routes", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/api/license");
    vi.doUnmock("@/lib/media/assets");
    vi.resetModules();
  });

  it("rejects non-number size_bytes values in public upload requests", async () => {
    const createInputAssetUpload = vi.fn(async () => ({
      asset: { id: "asset_1" },
      uploadUrl: "https://media.example.test/uploads/asset_1?token=token",
      expiresAt: "2026-07-01T12:01:00.000Z",
    }));

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: {
          user: { id: "user_1" },
        },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/media/assets", () => ({
      createInputAssetUpload,
    }));

    const { POST } = await import("@/app/api/v1/media/uploads/route");

    for (const sizeBytes of ["12", true, null]) {
      const response = await POST(jsonRequest("/api/v1/media/uploads", {
        purpose: "media_input",
        filename: "input.png",
        content_type: "image/png",
        size_bytes: sizeBytes,
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_media_input" },
      });
    }

    expect(createInputAssetUpload).not.toHaveBeenCalled();
  });

  it("returns a safe JSON error when public upload setup fails", async () => {
    const createInputAssetUpload = vi.fn(async () => {
      throw new Error("database details");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: {
          user: { id: "user_1" },
        },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/media/assets", () => ({
      createInputAssetUpload,
    }));

    const { POST } = await import("@/app/api/v1/media/uploads/route");
    const response = await POST(jsonRequest("/api/v1/media/uploads", {
      purpose: "media_input",
      filename: "input.png",
      content_type: "image/png",
      size_bytes: 12,
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "media_upload_failed",
        message: "Unable to create media upload.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to create media upload slot",
      expect.any(Error),
    );
  });

  it("rejects non-number size_bytes values in internal completion requests", async () => {
    const markInputAssetUploaded = vi.fn(async () => undefined);
    mocks.getMediaEnv.mockReturnValue(mediaEnv);

    vi.doMock("@/lib/media/assets", () => ({
      markInputAssetUploaded,
    }));

    const { POST } = await import("@/app/api/internal/media/uploads/complete/route");

    for (const sizeBytes of ["0", true, null]) {
      const response = await POST(jsonRequest(
        "/api/internal/media/uploads/complete",
        {
          asset_id: "asset_1",
          storage_key: "users/user_1/media/tmp/asset_1/input.png",
          size_bytes: sizeBytes,
        },
        { "x-woven-media-worker-secret": mediaEnv.workerSharedSecret },
      ));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_media_input" },
      });
    }

    expect(markInputAssetUploaded).not.toHaveBeenCalled();
  });

  it("returns a safe JSON error when internal completion update fails", async () => {
    const markInputAssetUploaded = vi.fn(async () => {
      throw new Error("database details");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getMediaEnv.mockReturnValue(mediaEnv);

    vi.doMock("@/lib/media/assets", () => ({
      markInputAssetUploaded,
    }));

    const { POST } = await import("@/app/api/internal/media/uploads/complete/route");

    const response = await POST(jsonRequest(
      "/api/internal/media/uploads/complete",
      {
        asset_id: "asset_1",
        storage_key: "users/user_1/media/tmp/asset_1/input.png",
        size_bytes: 123,
      },
      { "x-woven-media-worker-secret": mediaEnv.workerSharedSecret },
    ));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "media_upload_complete_failed",
        message: "Unable to mark media upload complete.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to mark media upload complete",
      expect.any(Error),
    );
  });
});

function insertQuery<T>(result: SupabaseResult<T>): QueryStep {
  const step: QueryStep = { root: {}, filters: [] };
  const single = vi.fn(async () => result);
  const select = vi.fn((columns: string) => {
    step.selected = columns;
    return { single };
  });

  step.root.insert = vi.fn((values: unknown) => {
    step.inserted = values;
    return { select };
  });

  return step;
}

function updateQuery<T>(result: SupabaseResult<T>): QueryStep {
  const step: QueryStep = { root: {}, filters: [] };
  const single = vi.fn(async () => result);
  const select = vi.fn((columns: string) => {
    step.selected = columns;
    return { single };
  });
  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      step.filters.push([column, value]);
      return chain;
    }),
    select,
  };

  step.root.update = vi.fn((values: unknown) => {
    step.updated = values;
    return chain;
  });

  return step;
}

function mockAdminWith(...steps: QueryStep[]) {
  const queue = [...steps];
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const step = queue.shift();
    if (!step) throw new Error(`Unexpected Supabase table: ${table}`);
    return step.root;
  });

  mocks.createSupabaseAdminClient.mockReturnValue({ from });
  return { from, tables };
}

function jsonRequest(
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://example.test${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
