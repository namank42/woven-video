import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaEnv } from "@/lib/media/env";
import {
  createOutputAssetRows,
  deterministicOutputAttemptId,
  deterministicOutputAssetId,
  failOutputAssetRowsForAttempt,
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
  outputRetentionSeconds: 2_592_000,
  jobTimeoutSeconds: 3600,
  uploadCompletionMode: "callback",
  falWebhookBaseUrl: null,
  falWebhookJwksUrl: null,
};
const claimToken = "00000000-0000-4000-8000-000000000001";
const outputUrlAllowlist = ["fal.media", "*.fal.media"];
const originalFetch = globalThis.fetch;
const nowSeconds = Math.floor(Date.parse("2026-07-01T12:00:00.000Z") / 1000);

type SupabaseError = { message: string };
type SupabaseResult<T> = { data: T | null; error: SupabaseError | null };
type QueryRoot = {
  select?: ReturnType<typeof vi.fn>;
};
type QueryStep = {
  root: QueryRoot;
  selected?: string;
  filters: Array<[string, unknown]>;
};
type RpcStep = {
  name: string;
  result: SupabaseResult<unknown>;
};

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

  it("uses inline bytes without fetching the provider URL, claim-fences mutations, and returns output descriptors", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const outputId = deterministicOutputAssetId("job_1", 0);
    const outputAttemptId = deterministicOutputAttemptId("job_1", 0, claimToken);
    const storageKey = outputAttemptStorageKey({
      userId: "user_1",
      jobId: "job_1",
      outputId,
      outputAttemptId,
      extension: "mp3",
    });
    const existingStep = selectQuery({ data: null, error: null });
    const admin = mockAdminWith({
      selectSteps: [existingStep],
      rpcSteps: [
        rpcStep("prepare_claimed_media_output_asset"),
        rpcStep("mark_claimed_media_output_asset_ready"),
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        url: "https://v3b.fal.media/audio.mp3",
        data: Uint8Array.from([1, 2, 3, 4]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    });

    expect(existingStep.filters).toEqual([
      ["id", outputId],
      ["user_id", "user_1"],
      ["job_id", "job_1"],
      ["kind", "output"],
    ]);
    expect(admin.rpc).toHaveBeenNthCalledWith(1, "prepare_claimed_media_output_asset", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_asset_id: outputId,
      p_user_id: "user_1",
      p_content_type: "audio/mpeg",
      p_size_bytes: 4,
      p_storage_key: storageKey,
      p_metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        output_attempt_id: outputAttemptId,
      },
    });
    expect(JSON.stringify(admin.rpc.mock.calls[0]![1]!.p_metadata)).not.toContain("v3b.fal.media");
    expect(JSON.stringify(admin.rpc.mock.calls[0]![1]!.p_metadata)).not.toContain(claimToken);

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

    expect(admin.rpc).toHaveBeenNthCalledWith(2, "mark_claimed_media_output_asset_ready", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_asset_id: outputId,
      p_user_id: "user_1",
      p_download_expires_at: "2026-07-31T12:00:00.000Z",
      p_metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        output_attempt_id: outputAttemptId,
        copied_to_r2_at: "2026-07-01T12:00:00.000Z",
      },
    });

    expect(result.attemptAssets).toEqual([{
      id: outputId,
      outputAttemptId,
      storageKey,
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        output_attempt_id: outputAttemptId,
      },
    }]);
    expect(result.outputs).toEqual([{
      id: outputId,
      type: "audio",
      content_type: "audio/mpeg",
    }]);
  });

  it("fetches HTTP provider outputs before uploading them to the Woven media URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const outputId = deterministicOutputAssetId("job_1", 0);
    const outputAttemptId = deterministicOutputAttemptId("job_1", 0, claimToken);
    const existingStep = selectQuery({ data: null, error: null });
    const admin = mockAdminWith({
      selectSteps: [existingStep],
      rpcSteps: [
        rpcStep("prepare_claimed_media_output_asset"),
        rpcStep("mark_claimed_media_output_asset_ready"),
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url === "https://v3b.fal.media/audio.mp3") {
        return new Response(Uint8Array.from([5, 6, 7]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }
      return new Response(null, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        url: "https://v3b.fal.media/audio.mp3",
        contentType: "audio/mpeg",
        type: "audio",
      }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://v3b.fal.media/audio.mp3");
    expect(String(fetchMock.mock.calls[1][0]).startsWith(`https://media.example.test/uploads/${outputId}?token=`)).toBe(true);
    await expect(bytesFromBody(fetchMock.mock.calls[1][1]?.body)).resolves.toEqual([5, 6, 7]);
    expect(admin.rpc).toHaveBeenNthCalledWith(1, "prepare_claimed_media_output_asset", expect.objectContaining({
      p_size_bytes: 3,
      p_metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "remote_url",
        output_attempt_id: outputAttemptId,
      },
    }));
    expect(JSON.stringify(admin.rpc.mock.calls[0]![1]!.p_metadata)).not.toContain("v3b.fal.media");
    expect(JSON.stringify(admin.rpc.mock.calls[0]![1]!.p_metadata)).not.toContain(claimToken);
    expect(result.outputs).toEqual([{
      id: outputId,
      type: "audio",
      content_type: "audio/mpeg",
    }]);
  });

  it("marks the media asset failed through the claim-aware RPC when upload to Woven media fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const outputId = deterministicOutputAssetId("job_1", 0);
    const outputAttemptId = deterministicOutputAttemptId("job_1", 0, claimToken);
    const existingStep = selectQuery({ data: null, error: null });
    const admin = mockAdminWith({
      selectSteps: [existingStep],
      rpcSteps: [
        rpcStep("prepare_claimed_media_output_asset"),
        rpcStep("fail_claimed_media_output_asset"),
      ],
    });
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;

    await expect(createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        url: "https://v3b.fal.media/audio.mp3",
        data: Uint8Array.from([1, 2, 3]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_output_upload_failed:503");

    expect(admin.rpc).toHaveBeenNthCalledWith(2, "fail_claimed_media_output_asset", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_asset_id: outputId,
      p_user_id: "user_1",
      p_metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        output_attempt_id: outputAttemptId,
        failure_reason: "media_output_upload_failed:503",
        failed_at: "2026-07-01T12:00:00.000Z",
      },
    });
    expect(JSON.stringify(admin.rpc.mock.calls[1]![1]!.p_metadata)).not.toContain("v3b.fal.media");
    expect(JSON.stringify(admin.rpc.mock.calls[1]![1]!.p_metadata)).not.toContain(claimToken);
  });

  it("marks the media asset failed and throws a safe error when upload fetch throws", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const outputAttemptId = deterministicOutputAttemptId("job_1", 0, claimToken);
    const existingStep = selectQuery({ data: null, error: null });
    const admin = mockAdminWith({
      selectSteps: [existingStep],
      rpcSteps: [
        rpcStep("prepare_claimed_media_output_asset"),
        rpcStep("fail_claimed_media_output_asset"),
      ],
    });
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connection reset with internal host details");
    }) as unknown as typeof fetch;

    await expect(createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        url: "https://v3b.fal.media/audio.mp3",
        data: Uint8Array.from([1, 2, 3]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_output_upload_failed:network");

    expect(admin.rpc).toHaveBeenNthCalledWith(2, "fail_claimed_media_output_asset", expect.objectContaining({
      p_claim_token: claimToken,
      p_metadata: expect.objectContaining({
        output_attempt_id: outputAttemptId,
        failure_reason: "media_output_upload_failed:network",
      }),
    }));
    expect(JSON.stringify(admin.rpc.mock.calls[1]![1]!.p_metadata)).not.toContain("v3b.fal.media");
    expect(JSON.stringify(admin.rpc.mock.calls[1]![1]!.p_metadata)).not.toContain("connection reset");
    expect(JSON.stringify(admin.rpc.mock.calls[1]![1]!.p_metadata)).not.toContain(claimToken);
  });

  it("rejects oversized inline outputs before preparing an asset row", async () => {
    const existingStep = selectQuery({ data: null, error: null });
    const admin = mockAdminWith({ selectSteps: [existingStep] });

    await expect(createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        data: Uint8Array.from({ length: mediaEnv.maxUploadBytes + 1 }, () => 1),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_output_too_large");

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects oversized remote outputs from Content-Length before preparing an asset row", async () => {
    const existingStep = selectQuery({ data: null, error: null });
    const admin = mockAdminWith({ selectSteps: [existingStep] });
    const fetchMock = vi.fn(async () => (
      new Response("too large", {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "content-length": String(mediaEnv.maxUploadBytes + 1),
        },
      })
    ));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        url: "https://v3b.fal.media/audio.mp3",
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_output_too_large");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("reuses an existing ready output asset by claiming it for the current attempt without upload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const existingId = deterministicOutputAssetId("job_1", 0);
    const outputAttemptId = deterministicOutputAttemptId("job_1", 0, claimToken);
    const previousAttemptId = deterministicOutputAttemptId(
      "job_1",
      0,
      "00000000-0000-4000-8000-000000000002",
    );
    const existing = {
      id: existingId,
      user_id: "user_1",
      job_id: "job_1",
      kind: "output",
      status: "ready",
      content_type: "audio/mpeg",
      size_bytes: 4,
      storage_key: outputAttemptStorageKey({
        userId: "user_1",
        jobId: "job_1",
        outputId: existingId,
        outputAttemptId: previousAttemptId,
        extension: "mp3",
      }),
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        output_attempt_id: previousAttemptId,
        copied_to_r2_at: "2026-07-01T11:00:00.000Z",
      },
    };
    const existingStep = selectQuery({ data: existing, error: null });
    const admin = mockAdminWith({
      selectSteps: [existingStep],
      rpcSteps: [
        rpcStep("reuse_claimed_media_output_asset"),
      ],
    });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        data: Uint8Array.from([1, 2, 3, 4]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("reuse_claimed_media_output_asset", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_asset_id: existingId,
      p_user_id: "user_1",
      p_content_type: "audio/mpeg",
      p_size_bytes: 4,
      p_storage_key: existing.storage_key,
      p_metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        output_attempt_id: outputAttemptId,
        reused_from_output_attempt_id: previousAttemptId,
        copied_to_r2_at: "2026-07-01T11:00:00.000Z",
      },
    });
    expect(JSON.stringify(admin.rpc.mock.calls[0]![1]!.p_metadata)).not.toContain(claimToken);
    expect(result.attemptAssets).toEqual([]);
    expect(result.outputs).toEqual([{
      id: existingId,
      type: "audio",
      content_type: "audio/mpeg",
    }]);
  });

  it("resets an existing failed output row and stores only safe data URL provenance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const existingId = deterministicOutputAssetId("job_1", 0);
    const previousAttemptId = deterministicOutputAttemptId(
      "job_1",
      0,
      "00000000-0000-4000-8000-000000000002",
    );
    const outputAttemptId = deterministicOutputAttemptId("job_1", 0, claimToken);
    const existing = {
      id: existingId,
      user_id: "user_1",
      job_id: "job_1",
      kind: "output",
      status: "failed",
      content_type: "audio/mpeg",
      size_bytes: 0,
      storage_key: outputAttemptStorageKey({
        userId: "user_1",
        jobId: "job_1",
        outputId: existingId,
        outputAttemptId: previousAttemptId,
        extension: "mp3",
      }),
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "data_url",
        output_attempt_id: previousAttemptId,
        failure_reason: "media_output_upload_failed:network",
      },
    };
    const existingStep = selectQuery({ data: existing, error: null });
    const admin = mockAdminWith({
      selectSteps: [existingStep],
      rpcSteps: [
        rpcStep("prepare_claimed_media_output_asset"),
        rpcStep("mark_claimed_media_output_asset_ready"),
      ],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        url: "data:audio/mpeg;base64,AQID",
        contentType: "audio/mpeg",
        type: "audio",
      }],
    });

    expect(admin.rpc).toHaveBeenNthCalledWith(1, "prepare_claimed_media_output_asset", expect.objectContaining({
      p_claim_token: claimToken,
      p_asset_id: existingId,
      p_metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "data_url",
        output_attempt_id: outputAttemptId,
      },
    }));
    expect(JSON.stringify(admin.rpc.mock.calls[0][1])).not.toContain("data:audio");
    expect(result.attemptAssets).toEqual([{
      id: existingId,
      outputAttemptId,
      storageKey: outputAttemptStorageKey({
        userId: "user_1",
        jobId: "job_1",
        outputId: existingId,
        outputAttemptId,
        extension: "mp3",
      }),
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "data_url",
        output_attempt_id: outputAttemptId,
      },
    }]);
  });

  it("marks outputs created in the same materialization attempt failed when a later output fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const firstId = deterministicOutputAssetId("job_1", 0);
    const secondId = deterministicOutputAssetId("job_1", 1);
    const firstAttemptId = deterministicOutputAttemptId("job_1", 0, claimToken);
    const secondAttemptId = deterministicOutputAttemptId("job_1", 1, claimToken);
    const admin = mockAdminWith({
      selectSteps: [
        selectQuery({ data: null, error: null }),
        selectQuery({ data: null, error: null }),
      ],
      rpcSteps: [
        rpcStep("prepare_claimed_media_output_asset"),
        rpcStep("mark_claimed_media_output_asset_ready"),
        rpcStep("prepare_claimed_media_output_asset"),
        rpcStep("fail_claimed_media_output_asset"),
        rpcStep("fail_claimed_media_output_asset"),
      ],
    });
    let uploadCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
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

    await expect(createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
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

    expect(admin.rpc).toHaveBeenNthCalledWith(4, "fail_claimed_media_output_asset", expect.objectContaining({
      p_asset_id: secondId,
      p_claim_token: claimToken,
      p_metadata: expect.objectContaining({
        output_index: 1,
        output_attempt_id: secondAttemptId,
        failure_reason: "media_output_upload_failed:503",
      }),
    }));
    expect(admin.rpc).toHaveBeenNthCalledWith(5, "fail_claimed_media_output_asset", expect.objectContaining({
      p_asset_id: firstId,
      p_claim_token: claimToken,
      p_metadata: expect.objectContaining({
        output_index: 0,
        output_attempt_id: firstAttemptId,
        failure_reason: "media_output_materialization_failed",
      }),
    }));
  });

  it("falls back to attempt cleanup when claim-fenced failure sees a stale claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const outputId = deterministicOutputAssetId("job_1", 0);
    const outputAttemptId = deterministicOutputAttemptId("job_1", 0, claimToken);
    const storageKey = outputAttemptStorageKey({
      userId: "user_1",
      jobId: "job_1",
      outputId,
      outputAttemptId,
      extension: "mp3",
    });
    const existingStep = selectQuery({ data: null, error: null });
    const admin = mockAdminWith({
      selectSteps: [existingStep],
      rpcSteps: [
        rpcStep("prepare_claimed_media_output_asset"),
        rpcStep("fail_claimed_media_output_asset", {
          data: null,
          error: { message: "media_job_stale_claim" },
        }),
        rpcStep("fail_media_output_asset_attempt"),
      ],
    });
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;

    await expect(createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        data: Uint8Array.from([1, 2, 3]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_output_upload_failed:503");

    expect(admin.rpc).toHaveBeenNthCalledWith(3, "fail_media_output_asset_attempt", {
      p_job_id: "job_1",
      p_asset_id: outputId,
      p_user_id: "user_1",
      p_output_attempt_id: outputAttemptId,
      p_storage_key: storageKey,
      p_metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        output_attempt_id: outputAttemptId,
        failure_reason: "media_output_upload_failed:503",
        failed_at: "2026-07-01T12:00:00.000Z",
      },
    });
  });

  it("surfaces stale claims from claim-aware output RPCs", async () => {
    const existingStep = selectQuery({ data: null, error: null });
    mockAdminWith({
      selectSteps: [existingStep],
      rpcSteps: [
        rpcStep("prepare_claimed_media_output_asset", {
          data: null,
          error: { message: "media_job_stale_claim" },
        }),
      ],
    });

    await expect(createRows({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [{
        data: Uint8Array.from([1, 2, 3]),
        contentType: "audio/mpeg",
        type: "audio",
      }],
    })).rejects.toThrow("media_job_stale_claim");
  });
});

describe("failOutputAssetRowsForAttempt", () => {
  it("uses attempt-scoped cleanup and skips reused assets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const outputAttemptId = deterministicOutputAttemptId("job_1", 0, claimToken);
    const storageKey = outputAttemptStorageKey({
      userId: "user_1",
      jobId: "job_1",
      outputId: "asset_created_this_attempt",
      outputAttemptId,
      extension: "mp3",
    });
    const admin = mockAdminWith({
      rpcSteps: [
        rpcStep("fail_media_output_asset_attempt"),
      ],
    });

    await expect(failOutputAssetRowsForAttempt({
      userId: "user_1",
      jobId: "job_1",
      attemptAssets: [{
        id: "asset_created_this_attempt",
        outputAttemptId,
        storageKey,
        metadata: {
          source: "provider_output",
          output_index: 0,
          provider_source_type: "inline_data",
          output_attempt_id: outputAttemptId,
        },
      }],
      reason: "media_output_materialization_failed",
    })).resolves.toBeUndefined();

    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("fail_media_output_asset_attempt", {
      p_job_id: "job_1",
      p_asset_id: "asset_created_this_attempt",
      p_user_id: "user_1",
      p_output_attempt_id: outputAttemptId,
      p_storage_key: storageKey,
      p_metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "inline_data",
        output_attempt_id: outputAttemptId,
        failure_reason: "media_output_materialization_failed",
        failed_at: "2026-07-01T12:00:00.000Z",
      },
    });
  });
});

function createRows(
  input: Omit<Parameters<typeof createOutputAssetRows>[0], "outputUrlAllowlist">,
) {
  return createOutputAssetRows({
    ...input,
    outputUrlAllowlist,
  });
}

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

function rpcStep(name: string, result: SupabaseResult<unknown> = { data: { id: "asset" }, error: null }): RpcStep {
  return { name, result };
}

function mockAdminWith({
  selectSteps = [],
  rpcSteps = [],
}: {
  selectSteps?: QueryStep[];
  rpcSteps?: RpcStep[];
} = {}) {
  const selectQueue = [...selectSteps];
  const rpcQueue = [...rpcSteps];
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const step = selectQueue.shift();
    if (!step) throw new Error(`Unexpected Supabase table: ${table}`);
    return step.root;
  });
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    void args;
    const step = rpcQueue.shift();
    if (!step) throw new Error(`Unexpected RPC: ${name}`);
    if (step.name !== name) {
      throw new Error(`Expected RPC ${step.name}, received ${name}`);
    }
    return step.result;
  });

  mocks.createSupabaseAdminClient.mockReturnValue({ from, rpc });
  return { from, rpc, tables };
}

async function bytesFromBody(body: BodyInit | null | undefined): Promise<number[]> {
  if (!body) return [];
  const arrayBuffer = await new Response(body).arrayBuffer();
  return Array.from(new Uint8Array(arrayBuffer));
}

function outputAttemptStorageKey({
  userId,
  jobId,
  outputId,
  outputAttemptId,
  extension,
}: {
  userId: string;
  jobId: string;
  outputId: string;
  outputAttemptId: string;
  extension: string;
}): string {
  return `users/${userId}/media/outputs/${jobId}/${outputId}/attempts/${outputAttemptId}/output.${extension}`;
}
