import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaEnv } from "@/lib/media/env";
import { createOutputAssetRows } from "@/lib/media/output-assets";
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
const outputId = "00000000-0000-4000-8000-000000000011";
const storageKey = `users/user_1/media/outputs/job_1/${outputId}.mp3`;
const nowSeconds = Math.floor(Date.parse("2026-07-01T12:00:00.000Z") / 1000);

describe("createOutputAssetRows", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    mocks.getMediaEnv.mockReset();
    mocks.getMediaEnv.mockReturnValue(mediaEnv);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(outputId);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses inline bytes without fetching the provider URL and returns a Woven download URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const insertStep = insertQuery({ data: { id: outputId, storage_key: storageKey }, error: null });
    const readyStep = updateQuery({ data: { id: outputId }, error: null });
    const admin = mockAdminWith(insertStep, readyStep);
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

    expect(admin.tables).toEqual(["media_assets", "media_assets"]);
    expect(insertStep.inserted).toEqual({
      id: outputId,
      user_id: "user_1",
      job_id: "job_1",
      kind: "output",
      status: "pending",
      content_type: "audio/mpeg",
      size_bytes: 4,
      storage_key: storageKey,
      metadata: { provider_source_url: "https://provider.example/audio.mp3" },
    });
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
        provider_source_url: "https://provider.example/audio.mp3",
        copied_to_r2_at: "2026-07-01T12:00:00.000Z",
      },
    });
    expect(readyStep.filters).toEqual([["id", outputId]]);

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

    const insertStep = insertQuery({ data: { id: outputId, storage_key: storageKey }, error: null });
    const readyStep = updateQuery({ data: { id: outputId }, error: null });
    mockAdminWith(insertStep, readyStep);
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://provider.example/audio.mp3");
    expect(String(fetchMock.mock.calls[1][0]).startsWith(`https://media.example.test/uploads/${outputId}?token=`)).toBe(true);
    await expect(bytesFromBody(fetchMock.mock.calls[1][1]?.body)).resolves.toEqual([5, 6, 7]);
    expect(insertStep.inserted).toMatchObject({
      size_bytes: 3,
      metadata: { provider_source_url: "https://provider.example/audio.mp3" },
    });
    expect(outputs[0].url).toContain(`https://media.example.test/objects/${outputId}?token=`);
    expect(outputs[0].url).not.toContain("provider.example");
  });

  it("marks the media asset failed and throws when upload to Woven media fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const insertStep = insertQuery({ data: { id: outputId, storage_key: storageKey }, error: null });
    const failedStep = updateQuery({ data: { id: outputId }, error: null });
    mockAdminWith(insertStep, failedStep);
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
        provider_source_url: "https://provider.example/audio.mp3",
        upload_error: "media_output_upload_failed:503",
        failed_at: "2026-07-01T12:00:00.000Z",
      },
    });
    expect(failedStep.filters).toEqual([["id", outputId]]);
  });

  it("marks the media asset failed and throws a safe error when upload fetch throws", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const insertStep = insertQuery({ data: { id: outputId, storage_key: storageKey }, error: null });
    const failedStep = updateQuery({ data: { id: outputId }, error: null });
    mockAdminWith(insertStep, failedStep);
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
        provider_source_url: "https://provider.example/audio.mp3",
        upload_error: "media_output_upload_failed:network",
        failed_at: "2026-07-01T12:00:00.000Z",
      },
    });
    expect(failedStep.filters).toEqual([["id", outputId]]);
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

async function bytesFromBody(body: BodyInit | null | undefined): Promise<number[]> {
  if (!body) return [];
  const arrayBuffer = await new Response(body).arrayBuffer();
  return Array.from(new Uint8Array(arrayBuffer));
}
