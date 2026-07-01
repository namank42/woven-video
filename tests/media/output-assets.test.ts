import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaEnv } from "@/lib/media/env";
import {
  createOutputAssetRows,
  deterministicOutputAssetId,
} from "@/lib/media/output-assets";
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
  downloadUrlTtlSeconds: 120,
};

type SupabaseError = { message: string };
type SupabaseResult<T> = { data: T | null; error: SupabaseError | null };
type QueryRoot = {
  select?: ReturnType<typeof vi.fn>;
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

const originalFetch = globalThis.fetch;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nowSeconds = Math.floor(Date.parse("2026-07-01T12:00:00.000Z") / 1000);

describe("createOutputAssetRows", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    mocks.getMediaEnv.mockReset();
    mocks.getMediaEnv.mockReturnValue(mediaEnv);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses inline bytes without fetching the provider URL and returns a Woven download URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const existingStep = selectQuery({ data: null, error: null });
    const insertStep = insertQuery({ data: { id: "inserted" }, error: null });
    const readyStep = updateQuery({ data: { id: "ready" }, error: null });
    const admin = mockAdminWith(existingStep, insertStep, readyStep);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outputs = await createOutputAssetRows({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{
        url: "https://provider.example/audio.mp3",
        data: Uint8Array.from([1, 2, 3, 4]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    });

    const inserted = insertStep.inserted as Record<string, unknown>;
    const outputId = String(inserted.id);
    const storageKey = String(inserted.storage_key);

    expect(outputId).toMatch(uuidPattern);
    expect(storageKey).toBe(`users/user_1/media/outputs/job_1/${outputId}.mp3`);
    expect(admin.tables).toEqual(["media_assets", "media_assets", "media_assets"]);
    expect(existingStep.filters).toEqual([
      ["id", outputId],
      ["user_id", "user_1"],
      ["job_id", "job_1"],
      ["kind", "output"],
    ]);
    expect(insertStep.inserted).toEqual({
      id: outputId,
      user_id: "user_1",
      job_id: "job_1",
      kind: "output",
      status: "pending",
      content_type: "audio/mpeg",
      size_bytes: 4,
      storage_key: storageKey,
      download_expires_at: null,
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
      },
    });
    expect(JSON.stringify(insertStep.inserted)).not.toContain("provider.example");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[0];
    expect(String(uploadUrl).startsWith(`https://media.example.test/uploads/${outputId}?token=`)).toBe(true);
    expect(uploadInit?.method).toBe("PUT");
    expect(uploadInit?.headers).toEqual({
      "content-type": "audio/mpeg",
      "content-length": "4",
    });
    await expect(bytesFromBody(uploadInit?.body)).resolves.toEqual([1, 2, 3, 4]);

    const uploadToken = new URL(String(uploadUrl)).searchParams.get("token") ?? "";
    await expect(verifyMediaToken(uploadToken, mediaEnv.tokenSecret, nowSeconds)).resolves.toMatchObject({
      kind: "upload",
      sub: "user_1",
      key: storageKey,
      assetId: outputId,
      jobId: "job_1",
      contentType: "audio/mpeg",
      sizeBytes: 4,
      exp: nowSeconds + mediaEnv.uploadUrlTtlSeconds,
    });

    expect(readyStep.updated).toEqual({
      status: "ready",
      download_expires_at: "2026-07-01T12:02:00.000Z",
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        copied_to_r2_at: "2026-07-01T12:00:00.000Z",
      },
    });
    expect(readyStep.filters).toEqual([["id", outputId]]);
    expect(JSON.stringify(readyStep.updated)).not.toContain("provider.example");

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      id: outputId,
      type: "audio",
      content_type: "audio/mpeg",
      expires_at: "2026-07-01T12:02:00.000Z",
    });
    const downloadUrl = new URL(outputs[0].url);
    expect(`${downloadUrl.origin}${downloadUrl.pathname}`).toBe(`https://media.example.test/objects/${outputId}`);
    const downloadToken = downloadUrl.searchParams.get("token") ?? "";
    await expect(verifyMediaToken(downloadToken, mediaEnv.tokenSecret, nowSeconds)).resolves.toMatchObject({
      kind: "download",
      sub: "user_1",
      key: storageKey,
      assetId: outputId,
      jobId: "job_1",
      exp: nowSeconds + mediaEnv.downloadUrlTtlSeconds,
    });
  });

  it("fetches HTTP provider outputs before uploading them to the Woven media URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const existingStep = selectQuery({ data: null, error: null });
    const insertStep = insertQuery({ data: { id: "inserted" }, error: null });
    const readyStep = updateQuery({ data: { id: "ready" }, error: null });
    mockAdminWith(existingStep, insertStep, readyStep);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url === "https://provider.example/audio.mp3") {
        return new Response(Uint8Array.from([5, 6, 7]), { status: 200 });
      }
      return new Response(null, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outputs = await createOutputAssetRows({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{
        url: "https://provider.example/audio.mp3",
        contentType: "audio/mpeg",
        type: "audio",
      }],
    });

    const inserted = insertStep.inserted as Record<string, unknown>;
    const outputId = String(inserted.id);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://provider.example/audio.mp3");
    expect(String(fetchMock.mock.calls[1][0]).startsWith(`https://media.example.test/uploads/${outputId}?token=`)).toBe(true);
    await expect(bytesFromBody(fetchMock.mock.calls[1][1]?.body)).resolves.toEqual([5, 6, 7]);
    expect(insertStep.inserted).toMatchObject({
      size_bytes: 3,
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "remote_url",
      },
    });
    expect(JSON.stringify(insertStep.inserted)).not.toContain("provider.example");
    expect(outputs[0].url).toContain(`https://media.example.test/objects/${outputId}?token=`);
    expect(outputs[0].url).not.toContain("provider.example");
  });

  it("marks the media asset failed and throws when upload to Woven media fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const existingStep = selectQuery({ data: null, error: null });
    const insertStep = insertQuery({ data: { id: "inserted" }, error: null });
    const failedStep = updateQuery({ data: { id: "failed" }, error: null });
    mockAdminWith(existingStep, insertStep, failedStep);
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;

    await expect(createOutputAssetRows({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{
        url: "https://provider.example/audio.mp3",
        data: Uint8Array.from([1, 2, 3]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_output_upload_failed:503");

    expect(failedStep.updated).toEqual({
      status: "failed",
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        failure_reason: "media_output_upload_failed:503",
        failed_at: "2026-07-01T12:00:00.000Z",
      },
    });
    expect(JSON.stringify(failedStep.updated)).not.toContain("provider.example");
    expect(failedStep.filters).toEqual([["id", (insertStep.inserted as { id: string }).id]]);
  });

  it("marks the media asset failed and throws a safe error when upload fetch throws", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const existingStep = selectQuery({ data: null, error: null });
    const insertStep = insertQuery({ data: { id: "inserted" }, error: null });
    const failedStep = updateQuery({ data: { id: "failed" }, error: null });
    mockAdminWith(existingStep, insertStep, failedStep);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connection reset with internal host details");
    }) as unknown as typeof fetch;

    await expect(createOutputAssetRows({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{
        url: "https://provider.example/audio.mp3",
        data: Uint8Array.from([1, 2, 3]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_output_upload_failed:network");

    expect(failedStep.updated).toEqual({
      status: "failed",
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        failure_reason: "media_output_upload_failed:network",
        failed_at: "2026-07-01T12:00:00.000Z",
      },
    });
    expect(JSON.stringify(failedStep.updated)).not.toContain("provider.example");
    expect(failedStep.filters).toEqual([["id", (insertStep.inserted as { id: string }).id]]);
  });

  it("rejects oversized inline outputs before creating an asset row", async () => {
    const existingStep = selectQuery({ data: null, error: null });
    const admin = mockAdminWith(existingStep);

    await expect(createOutputAssetRows({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{
        data: Uint8Array.from({ length: mediaEnv.maxUploadBytes + 1 }, () => 1),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_output_too_large");

    expect(admin.tables).toEqual(["media_assets"]);
  });

  it("rejects oversized remote outputs from Content-Length before creating an asset row", async () => {
    const existingStep = selectQuery({ data: null, error: null });
    const admin = mockAdminWith(existingStep);
    const fetchMock = vi.fn(async () => (
      new Response("too large", {
        status: 200,
        headers: { "content-length": String(mediaEnv.maxUploadBytes + 1) },
      })
    ));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(createOutputAssetRows({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{
        url: "https://provider.example/audio.mp3",
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_output_too_large");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(admin.tables).toEqual(["media_assets"]);
  });

  it("reuses an existing ready output asset and returns a fresh Woven URL without inserting or uploading", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const existingId = deterministicOutputAssetId("job_1", 0);
    const existing = {
      id: existingId,
      user_id: "user_1",
      job_id: "job_1",
      kind: "output",
      status: "ready",
      content_type: "audio/mpeg",
      size_bytes: 4,
      storage_key: `users/user_1/media/outputs/job_1/${existingId}.mp3`,
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        copied_to_r2_at: "2026-07-01T11:00:00.000Z",
      },
    };
    const existingStep = selectQuery({ data: existing, error: null });
    const admin = mockAdminWith(existingStep);
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outputs = await createOutputAssetRows({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{
        data: Uint8Array.from([1, 2, 3, 4]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    });

    expect(admin.tables).toEqual(["media_assets"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      id: existing.id,
      type: "audio",
      content_type: "audio/mpeg",
      expires_at: "2026-07-01T12:02:00.000Z",
    });
    expect(outputs[0].url).toContain(`https://media.example.test/objects/${existing.id}?token=`);
  });

  it("resets an existing failed output row and stores only safe data URL provenance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const existingId = deterministicOutputAssetId("job_1", 0);
    const existing = {
      id: existingId,
      user_id: "user_1",
      job_id: "job_1",
      kind: "output",
      status: "failed",
      content_type: "audio/mpeg",
      size_bytes: 0,
      storage_key: `users/user_1/media/outputs/job_1/${existingId}.mp3`,
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "data_url",
        failure_reason: "media_output_upload_failed:network",
      },
    };
    const existingStep = selectQuery({ data: existing, error: null });
    const resetStep = updateQuery({ data: { id: existingId }, error: null });
    const readyStep = updateQuery({ data: { id: existingId }, error: null });
    const admin = mockAdminWith(existingStep, resetStep, readyStep);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outputs = await createOutputAssetRows({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{
        url: "data:audio/mpeg;base64,AQID",
        contentType: "audio/mpeg",
        type: "audio",
      }],
    });

    expect(admin.tables).toEqual(["media_assets", "media_assets", "media_assets"]);
    expect(resetStep.updated).toEqual({
      status: "pending",
      content_type: "audio/mpeg",
      size_bytes: 3,
      storage_key: `users/user_1/media/outputs/job_1/${existingId}.mp3`,
      download_expires_at: null,
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "data_url",
      },
    });
    expect(JSON.stringify(resetStep.updated)).not.toContain("data:audio");
    expect(readyStep.updated).toMatchObject({
      status: "ready",
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "data_url",
        copied_to_r2_at: "2026-07-01T12:00:00.000Z",
      },
    });
    expect(outputs[0].id).toBe(existingId);
    expect(outputs[0].url).toContain(`https://media.example.test/objects/${existingId}?token=`);
  });

  it("marks outputs created in the same materialization attempt failed when a later output fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const firstExistingStep = selectQuery({ data: null, error: null });
    const firstInsertStep = insertQuery({ data: { id: "first" }, error: null });
    const firstReadyStep = updateQuery({ data: { id: "first" }, error: null });
    const secondExistingStep = selectQuery({ data: null, error: null });
    const secondInsertStep = insertQuery({ data: { id: "second" }, error: null });
    const secondFailedStep = updateQuery({ data: { id: "second" }, error: null });
    const firstCleanupStep = updateQuery({ data: { id: "first" }, error: null });
    mockAdminWith(
      firstExistingStep,
      firstInsertStep,
      firstReadyStep,
      secondExistingStep,
      secondInsertStep,
      secondFailedStep,
      firstCleanupStep,
    );
    let uploadCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/uploads/")) {
        uploadCalls += 1;
        if (uploadCalls === 2) {
          return new Response("nope", { status: 503 });
        }
      }
      return new Response(null, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(createOutputAssetRows({
      userId: "user_1",
      jobId: "job_1",
      outputs: [
        {
          data: Uint8Array.from([1, 2, 3]),
          contentType: "audio/mpeg",
          type: "audio",
        },
        {
          data: Uint8Array.from([4, 5, 6]),
          contentType: "audio/mpeg",
          type: "audio",
        },
      ],
    })).rejects.toThrow("media_output_upload_failed:503");

    expect(firstReadyStep.updated).toMatchObject({ status: "ready" });
    expect(secondFailedStep.updated).toMatchObject({
      status: "failed",
      metadata: expect.objectContaining({
        output_index: 1,
        failure_reason: "media_output_upload_failed:503",
      }),
    });
    expect(firstCleanupStep.updated).toMatchObject({
      status: "failed",
      metadata: expect.objectContaining({
        output_index: 0,
        failure_reason: "media_output_materialization_failed",
      }),
    });
  });
});

function selectQuery<T>(result: SupabaseResult<T>): QueryStep {
  const step: QueryStep = { root: {}, filters: [] };
  const maybeSingle = vi.fn(async () => result);
  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      step.filters.push([column, value]);
      return chain;
    }),
    maybeSingle,
  };

  step.root.select = vi.fn((columns: string) => {
    step.selected = columns;
    return chain;
  });

  return step;
}

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

async function bytesFromBody(body: BodyInit | null | undefined): Promise<number[]> {
  if (!body) return [];
  const arrayBuffer = await new Response(body).arrayBuffer();
  return Array.from(new Uint8Array(arrayBuffer));
}
