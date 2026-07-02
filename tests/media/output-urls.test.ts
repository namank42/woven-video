import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaEnv } from "@/lib/media/env";
import { presentJobOutputs } from "@/lib/media/output-urls";
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
};
const nowSeconds = Math.floor(Date.parse("2026-07-01T12:00:00.000Z") / 1000);

function mockAdminWith(rows: unknown[], error: { message: string } | null = null) {
  const chain = {
    eq: vi.fn(() => chain),
    in: vi.fn(async () => ({ data: rows, error })),
  };
  const select = vi.fn(() => chain);
  const from = vi.fn(() => ({ select }));
  mocks.createSupabaseAdminClient.mockReturnValue({ from });
  return { from, select, chain };
}

describe("presentJobOutputs", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    mocks.getMediaEnv.mockReset();
    mocks.getMediaEnv.mockReturnValue(mediaEnv);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("mints a fresh scoped download URL for ready assets", async () => {
    const { from, chain } = mockAdminWith([{
      id: "out_1",
      storage_key: "users/user_1/media/outputs/job_1/out_1/attempts/attempt_1/output.mp4",
      status: "ready",
      download_expires_at: "2026-07-31T12:00:00.000Z",
    }]);

    const outputs = await presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ id: "out_1", type: "video", content_type: "video/mp4" }],
    });

    expect(from).toHaveBeenCalledWith("media_assets");
    expect(chain.eq.mock.calls).toEqual([
      ["user_id", "user_1"],
      ["job_id", "job_1"],
      ["kind", "output"],
    ]);
    expect(chain.in).toHaveBeenCalledWith("id", ["out_1"]);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      id: "out_1",
      type: "video",
      content_type: "video/mp4",
      expires_at: "2026-07-01T12:02:00.000Z",
    });
    const url = new URL(outputs[0].url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://media.example.test/objects/out_1");
    await expect(verifyMediaToken(url.searchParams.get("token") ?? "", mediaEnv.tokenSecret, nowSeconds))
      .resolves.toMatchObject({
        kind: "download",
        sub: "user_1",
        key: "users/user_1/media/outputs/job_1/out_1/attempts/attempt_1/output.mp4",
        assetId: "out_1",
        jobId: "job_1",
        exp: nowSeconds + mediaEnv.downloadUrlTtlSeconds,
      });
  });

  it("caps the URL expiry at the retention deadline", async () => {
    mockAdminWith([{
      id: "out_1",
      storage_key: "users/user_1/media/outputs/job_1/out_1/attempts/attempt_1/output.mp4",
      status: "ready",
      download_expires_at: "2026-07-01T12:01:00.000Z",
    }]);

    const outputs = await presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ id: "out_1", type: "video", content_type: "video/mp4" }],
    });

    expect(outputs[0].expires_at).toBe("2026-07-01T12:01:00.000Z");
    const token = new URL(outputs[0].url ?? "").searchParams.get("token") ?? "";
    await expect(verifyMediaToken(token, mediaEnv.tokenSecret, nowSeconds)).resolves.toMatchObject({
      exp: nowSeconds + 60,
    });
  });

  it("returns null urls for missing, deleted, and retention-expired assets", async () => {
    mockAdminWith([
      {
        id: "out_deleted",
        storage_key: "users/user_1/media/outputs/job_1/out_deleted/attempts/attempt_1/output.mp4",
        status: "deleted",
        download_expires_at: "2026-07-31T12:00:00.000Z",
      },
      {
        id: "out_expired",
        storage_key: "users/user_1/media/outputs/job_1/out_expired/attempts/attempt_1/output.mp4",
        status: "ready",
        download_expires_at: "2026-07-01T11:59:59.000Z",
      },
    ]);

    const outputs = await presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [
        { id: "out_deleted", type: "video", content_type: "video/mp4" },
        { id: "out_expired", type: "video", content_type: "video/mp4" },
        { id: "out_missing", type: "video", content_type: "video/mp4" },
      ],
    });

    expect(outputs).toEqual([
      { id: "out_deleted", type: "video", content_type: "video/mp4", url: null, expires_at: null },
      { id: "out_expired", type: "video", content_type: "video/mp4", url: null, expires_at: null },
      { id: "out_missing", type: "video", content_type: "video/mp4", url: null, expires_at: null },
    ]);
  });

  it("skips the query entirely when no stored outputs have usable ids", async () => {
    const { from } = mockAdminWith([]);

    await expect(presentJobOutputs({ userId: "user_1", jobId: "job_1", outputs: [] }))
      .resolves.toEqual([]);
    await expect(presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ type: "video" }, "not-an-object", null],
    })).resolves.toEqual([]);

    expect(from).not.toHaveBeenCalled();
  });

  it("throws when the asset lookup fails", async () => {
    mockAdminWith([], { message: "boom" });

    await expect(presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ id: "out_1", type: "video", content_type: "video/mp4" }],
    })).rejects.toThrow("boom");
  });
});
