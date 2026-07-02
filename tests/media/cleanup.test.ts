import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

type SupabaseError = { message: string };
type SupabaseResult<T> = { data: T | null; error: SupabaseError | null };
type QueryFilter = {
  method: "eq" | "lt" | "neq" | "or";
  column?: string;
  value: unknown;
};
type UpdateStep = {
  updated?: unknown;
  filters: QueryFilter[];
  selected?: string;
};

describe("media cleanup", () => {
  afterEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    vi.doUnmock("@/lib/media/env");
    vi.doUnmock("@/lib/media/cleanup");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("marks stale pending uploads and expired ready downloads as deleted", async () => {
    const nowIso = "2026-07-01T12:00:00.000Z";
    const pendingUploadStep = updateQuery({
      data: [{ id: "asset_1", storage_key: "users/user_1/media/tmp/asset_1/input.mp4" }],
      error: null,
    });
    const readyDownloadStep = updateQuery({
      data: [{ id: "asset_2", storage_key: "users/user_1/media/asset_2/output.mp4" }],
      error: null,
    });
    mockAdminWith(pendingUploadStep, readyDownloadStep);
    const { markExpiredMediaForDeletion } = await import("@/lib/media/cleanup");

    const deleted = await markExpiredMediaForDeletion(nowIso);

    expect(deleted).toEqual([
      { id: "asset_1", storage_key: "users/user_1/media/tmp/asset_1/input.mp4" },
      { id: "asset_2", storage_key: "users/user_1/media/asset_2/output.mp4" },
    ]);
    expect(pendingUploadStep.updated).toEqual({
      status: "deleted",
      deleted_at: nowIso,
    });
    expect(pendingUploadStep.filters).toEqual([
      { method: "eq", column: "status", value: "pending" },
      { method: "lt", column: "upload_expires_at", value: nowIso },
    ]);
    expect(pendingUploadStep.selected).toBe("id, storage_key");

    expect(readyDownloadStep.updated).toEqual({
      status: "deleted",
      deleted_at: nowIso,
    });
    expect(readyDownloadStep.filters).toEqual([
      { method: "eq", column: "status", value: "ready" },
      { method: "lt", column: "download_expires_at", value: nowIso },
    ]);
    expect(readyDownloadStep.selected).toBe("id, storage_key");
  });

  it("does not use upload expiry to match uploaded or attached inputs", async () => {
    const nowIso = "2026-07-01T12:00:00.000Z";
    const pendingUploadStep = updateQuery({ data: [], error: null });
    const readyDownloadStep = updateQuery({ data: [], error: null });
    mockAdminWith(pendingUploadStep, readyDownloadStep);
    const { markExpiredMediaForDeletion } = await import("@/lib/media/cleanup");

    await markExpiredMediaForDeletion(nowIso);

    const uploadExpirySteps = [pendingUploadStep, readyDownloadStep].filter((step) =>
      step.filters.some((filter) =>
        filter.method === "lt" && filter.column === "upload_expires_at"
      )
    );

    expect(uploadExpirySteps).toHaveLength(1);
    expect(uploadExpirySteps[0].filters).toContainEqual({
      method: "eq",
      column: "status",
      value: "pending",
    });
    expect(uploadExpirySteps[0].filters).not.toContainEqual({
      method: "eq",
      column: "status",
      value: "uploaded",
    });
    expect(uploadExpirySteps[0].filters).not.toContainEqual({
      method: "eq",
      column: "status",
      value: "attached",
    });
    expect([pendingUploadStep, readyDownloadStep].flatMap((step) => step.filters))
      .not.toContainEqual(expect.objectContaining({ method: "or" }));
  });

  it("throws Supabase update errors", async () => {
    const pendingUploadStep = updateQuery({
      data: [],
      error: null,
    });
    const readyDownloadStep = updateQuery({
      data: null,
      error: { message: "database unavailable" },
    });
    mockAdminWith(pendingUploadStep, readyDownloadStep);
    const { markExpiredMediaForDeletion } = await import("@/lib/media/cleanup");

    await expect(markExpiredMediaForDeletion("2026-07-01T12:00:00.000Z"))
      .rejects.toThrow("database unavailable");
  });
});

describe("internal media cleanup route", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/media/env");
    vi.doUnmock("@/lib/media/cleanup");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects requests without the worker shared secret", async () => {
    const markExpiredMediaForDeletion = vi.fn();
    mockRouteDependencies({ markExpiredMediaForDeletion });
    const { POST, dynamic, runtime } = await import("@/app/api/internal/media/cleanup/route");

    const response = await POST(new Request("https://example.test/api/internal/media/cleanup", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "wrong" },
    }));

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
    expect(markExpiredMediaForDeletion).not.toHaveBeenCalled();
  });

  it("returns the deleted asset count when the secret is valid", async () => {
    const markExpiredMediaForDeletion = vi.fn(async () => [
      { id: "asset_1", storage_key: "key_1" },
      { id: "asset_2", storage_key: "key_2" },
    ]);
    mockRouteDependencies({ markExpiredMediaForDeletion });
    const { POST } = await import("@/app/api/internal/media/cleanup/route");

    const response = await POST(new Request("https://example.test/api/internal/media/cleanup", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "shared_secret" },
    }));

    expect(markExpiredMediaForDeletion).toHaveBeenCalledWith();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ deleted_count: 2 });
  });

  it("returns a safe 500 when cleanup throws unexpectedly", async () => {
    const markExpiredMediaForDeletion = vi.fn(async () => {
      throw new Error("database details");
    });
    mockRouteDependencies({ markExpiredMediaForDeletion });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/internal/media/cleanup/route");

    const response = await POST(new Request("https://example.test/api/internal/media/cleanup", {
      method: "POST",
      headers: { "x-woven-media-worker-secret": "shared_secret" },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "media_cleanup_failed",
        message: "Unable to clean up media assets.",
      },
    });
  });
});

function updateQuery<T>(result: SupabaseResult<T>): UpdateStep {
  const step: UpdateStep = { filters: [] };
  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      step.filters.push({ method: "eq", column, value });
      return chain;
    }),
    lt: vi.fn((column: string, value: unknown) => {
      step.filters.push({ method: "lt", column, value });
      return chain;
    }),
    or: vi.fn((filter: string) => {
      step.filters.push({ method: "or", value: filter });
      return chain;
    }),
    neq: vi.fn((column: string, value: unknown) => {
      step.filters.push({ method: "neq", column, value });
      return chain;
    }),
    select: vi.fn(async (columns: string) => {
      step.selected = columns;
      return result;
    }),
  };

  return Object.assign(step, {
    root: {
      update: vi.fn((values: unknown) => {
        step.updated = values;
        return chain;
      }),
    },
  });
}

function mockAdminWith(...steps: Array<UpdateStep & { root?: { update: ReturnType<typeof vi.fn> } }>) {
  const queue = [...steps];
  const from = vi.fn((table: string) => {
    if (table !== "media_assets") throw new Error(`Unexpected Supabase table: ${table}`);
    const step = queue.shift();
    if (!step) throw new Error(`Unexpected Supabase table: ${table}`);
    return step.root;
  });
  const admin = { from };
  mocks.createSupabaseAdminClient.mockReturnValue(admin);
  return admin;
}

function mockRouteDependencies({
  markExpiredMediaForDeletion,
}: {
  markExpiredMediaForDeletion: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("@/lib/media/env", () => ({
    getMediaEnv: () => ({
      workerSharedSecret: "shared_secret",
    }),
  }));
  vi.doMock("@/lib/media/cleanup", () => ({ markExpiredMediaForDeletion }));
}
