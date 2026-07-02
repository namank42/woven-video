import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

const inputStorageKey = "users/u1/media/tmp/asset_1/input.mp4";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

type SupabaseError = { message: string };

describe("media cleanup", () => {
  afterEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    vi.resetModules();
    vi.useRealTimers();
  });

  it("claims expired media assets for deletion", async () => {
    const nowIso = "2026-07-02T12:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowIso));
    const admin = createCleanupAdmin({
      claimRows: [{ id: "asset_1", storage_key: inputStorageKey }],
    });
    const { claimExpiredMediaForDeletion } = await import("@/lib/media/cleanup");

    await expect(claimExpiredMediaForDeletion({ limit: 100 })).resolves.toEqual([
      { id: "asset_1", storage_key: inputStorageKey },
    ]);

    expect(admin.rpc).toHaveBeenCalledWith("claim_expired_media_assets_for_deletion", {
      p_now: nowIso,
      p_limit: 100,
    });
  });

  it("completes media asset deletions", async () => {
    const nowIso = "2026-07-02T12:00:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowIso));
    const admin = createCleanupAdmin();
    const { completeMediaAssetDeletions } = await import("@/lib/media/cleanup");

    await completeMediaAssetDeletions(["asset_1"]);

    expect(admin.rpc).toHaveBeenCalledWith("complete_media_asset_deletions", {
      p_asset_ids: ["asset_1"],
      p_now: nowIso,
    });
  });

  it("does not complete media asset deletions for an empty list", async () => {
    const admin = createCleanupAdmin();
    const { completeMediaAssetDeletions } = await import("@/lib/media/cleanup");

    await completeMediaAssetDeletions([]);

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("releases media asset deletion claims", async () => {
    const admin = createCleanupAdmin();
    const { releaseMediaAssetDeletionClaims } = await import("@/lib/media/cleanup");

    await releaseMediaAssetDeletionClaims(["asset_1"]);

    expect(admin.rpc).toHaveBeenCalledWith("release_media_asset_deletion_claims", {
      p_asset_ids: ["asset_1"],
    });
  });

  it("does not release media asset deletion claims for an empty list", async () => {
    const admin = createCleanupAdmin();
    const { releaseMediaAssetDeletionClaims } = await import("@/lib/media/cleanup");

    await releaseMediaAssetDeletionClaims([]);

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("throws Supabase RPC errors", async () => {
    createCleanupAdmin({ error: { message: "database unavailable" } });
    const { claimExpiredMediaForDeletion } = await import("@/lib/media/cleanup");

    await expect(claimExpiredMediaForDeletion())
      .rejects.toThrow("database unavailable");
  });
});

function createCleanupAdmin({
  claimRows = [],
  error = null,
}: {
  claimRows?: Array<{ id: string; storage_key: string }>;
  error?: SupabaseError | null;
} = {}) {
  const admin = {
    rpc: vi.fn(async (functionName: string) => ({
      data: functionName === "claim_expired_media_assets_for_deletion" ? claimRows : null,
      error,
    })),
  };
  mocks.createSupabaseAdminClient.mockReturnValue(admin);
  return admin;
}
