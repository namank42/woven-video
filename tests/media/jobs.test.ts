import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaModel } from "@/lib/media/types";
import { createReservedMediaJob } from "@/lib/media/jobs";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));
const originalEnv = process.env;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

type SupabaseError = { message: string };
type SupabaseResult<T> = { data: T | null; error: SupabaseError | null };
type QueryRoot = {
  select?: ReturnType<typeof vi.fn>;
  insert?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
};
type QueryStep = {
  root: QueryRoot;
  table?: string;
  inserted?: unknown;
  updated?: unknown;
  selected?: string;
  filters: Array<[string, unknown]>;
};

const model = {
  id: "fal:frontier-video",
  provider: "fal",
  providerModel: "fal-ai/frontier-video",
  providerEndpoint: "fal-ai/frontier-video",
  operation: "video_generation",
  kind: "video",
  displayName: "Frontier Video",
  supportsUploadedInputs: true,
  supportedInputTypes: ["image"],
  outputTypes: ["video"],
  defaultParameters: {},
  parameterSchema: { type: "object" },
  pricing: {
    unit: "job",
    minimumUsdMicros: 100_000,
    reserveUsdMicros: 500_000,
    markupBps: 2_000,
  },
  metadata: {},
  rule: {},
} as MediaModel;

describe("createReservedMediaJob", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    process.env = {
      ...originalEnv,
      MEDIA_TOKEN_SECRET: "x".repeat(32),
      MEDIA_WORKER_SHARED_SECRET: "y".repeat(32),
    } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  it("validates uploaded input assets, reserves credits, attaches assets, and returns the queued job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));
    const assetsStep = selectAssetsQuery({
      data: [{ id: "asset_1", status: "uploaded", content_type: "image/png" }],
      error: null,
    });
    const insertStep = insertJobQuery({
      data: {
        id: "job_1",
        status: "creating",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 0,
        created_at: "2026-07-01T12:00:00.000Z",
        expires_at: "2026-07-02T13:00:00.000Z",
      },
      error: null,
    });
    const attachStep = attachAssetsQuery({
      data: [{ id: "asset_1" }],
      error: null,
    });
    const queueStep = updateJobQuery({
      data: {
        id: "job_1",
        status: "queued",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 500_000,
        created_at: "2026-07-01T12:00:00.000Z",
        expires_at: "2026-07-02T13:00:00.000Z",
      },
      error: null,
    });
    const admin = mockAdminWith(assetsStep, insertStep, attachStep, queueStep);

    await expect(createReservedMediaJob({
      userId: "user_1",
      model,
      parameters: { prompt: "a mountain" },
      inputAssetIds: ["asset_1"],
    })).resolves.toEqual({
      id: "job_1",
      status: "queued",
      model: "fal:frontier-video",
      estimatedCostUsdMicros: 500_000,
      reservedCreditsUsdMicros: 500_000,
      createdAt: "2026-07-01T12:00:00.000Z",
      expiresAt: "2026-07-02T13:00:00.000Z",
    });

    expect(admin.tables).toEqual([
      "media_assets",
      "generation_jobs",
      "media_assets",
      "generation_jobs",
    ]);
    expect(admin.inserts[0]).toMatchObject({
      user_id: "user_1",
      type: "media_job",
      provider: "fal",
      model: "fal-ai/frontier-video",
      status: "creating",
      estimated_cost_usd_micros: 500_000,
      expires_at: "2026-07-02T13:00:00.000Z",
      input: {
        media_model_id: "fal:frontier-video",
        operation: "video_generation",
        parameters: { prompt: "a mountain" },
        input_asset_ids: ["asset_1"],
      },
      progress: { stage: "creating", percent: null },
    });
    expect(admin.updates[0]).toMatchObject({
      status: "queued",
      progress: { stage: "queued", percent: 0 },
    });
    expect(admin.rpc).toHaveBeenCalledWith("reserve_balance", {
      p_user_id: "user_1",
      p_job_id: "job_1",
      p_amount_usd_micros: 500_000,
      p_metadata: {
        provider: "fal",
        model: "fal-ai/frontier-video",
        operation: "video_generation",
        media_model_id: "fal:frontier-video",
      },
    });
    expect(attachStep.updated).toEqual({ job_id: "job_1", status: "attached" });
    expect(attachStep.filters).toEqual([
      ["id", ["asset_1"]],
      ["user_id", "user_1"],
      ["status", "uploaded"],
    ]);
    expect(queueStep.filters).toEqual([
      ["id", "job_1"],
      ["status", "creating"],
    ]);
  });

  it("computes the job deadline without requiring token or worker secrets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));
    process.env = {
      ...originalEnv,
      MEDIA_JOB_TIMEOUT_SECONDS: "7200",
    } as NodeJS.ProcessEnv;
    const assetsStep = selectAssetsQuery({
      data: [{ id: "asset_1", status: "uploaded", content_type: "image/png" }],
      error: null,
    });
    const insertStep = insertJobQuery({
      data: {
        id: "job_1",
        status: "creating",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 0,
        created_at: "2026-07-01T12:00:00.000Z",
        expires_at: "2026-07-02T14:00:00.000Z",
      },
      error: null,
    });
    const attachStep = attachAssetsQuery({
      data: [{ id: "asset_1" }],
      error: null,
    });
    const queueStep = updateJobQuery({
      data: {
        id: "job_1",
        status: "queued",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 500_000,
        created_at: "2026-07-01T12:00:00.000Z",
        expires_at: "2026-07-02T14:00:00.000Z",
      },
      error: null,
    });
    const admin = mockAdminWith(assetsStep, insertStep, attachStep, queueStep);

    await expect(createReservedMediaJob({
      userId: "user_1",
      model,
      parameters: { prompt: "a mountain" },
      inputAssetIds: ["asset_1"],
    })).resolves.toMatchObject({
      id: "job_1",
      status: "queued",
    });

    expect(admin.inserts[0]).toMatchObject({
      expires_at: "2026-07-02T14:00:00.000Z",
    });
  });

  it("releases the reservation and fails the job when asset attachment fails after reservation", async () => {
    const assetsStep = selectAssetsQuery({
      data: [{ id: "asset_1", status: "uploaded", content_type: "image/png" }],
      error: null,
    });
    const insertStep = insertJobQuery({
      data: {
        id: "job_1",
        status: "creating",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 0,
        created_at: "2026-07-01T12:00:00.000Z",
      },
      error: null,
    });
    const attachStep = attachAssetsQuery({
      data: null,
      error: { message: "asset attach failed" },
    });
    const detachStep = attachAssetsQuery({
      data: [{ id: "asset_1" }],
      error: null,
    });
    const admin = mockAdminWith(assetsStep, insertStep, attachStep, detachStep);

    await expect(createReservedMediaJob({
      userId: "user_1",
      model,
      parameters: { prompt: "a mountain" },
      inputAssetIds: ["asset_1"],
    })).rejects.toThrow("asset attach failed");

    expect(admin.rpc).toHaveBeenNthCalledWith(1, "reserve_balance", expect.any(Object));
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_balance_reservation", {
      p_job_id: "job_1",
      p_status: "failed",
      p_error: "asset attach failed",
      p_metadata: { reason: "media_asset_attach_failed" },
    });
    expect(detachStep.updated).toEqual({ job_id: null, status: "uploaded" });
    expect(detachStep.filters).toEqual([
      ["job_id", "job_1"],
      ["user_id", "user_1"],
      ["id", ["asset_1"]],
    ]);
    expect(admin.updates).not.toContainEqual(expect.objectContaining({ status: "queued" }));
  });

  it("does not swallow reservation release failures after asset attachment fails", async () => {
    const assetsStep = selectAssetsQuery({
      data: [{ id: "asset_1", status: "uploaded", content_type: "image/png" }],
      error: null,
    });
    const insertStep = insertJobQuery({
      data: {
        id: "job_1",
        status: "creating",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 0,
        created_at: "2026-07-01T12:00:00.000Z",
      },
      error: null,
    });
    const attachStep = attachAssetsQuery({
      data: null,
      error: { message: "asset attach failed" },
    });
    const detachStep = attachAssetsQuery({
      data: [{ id: "asset_1" }],
      error: null,
    });
    const admin = mockAdminWith(assetsStep, insertStep, attachStep, detachStep);
    admin.rpc.mockImplementation(async (name: string) => {
      if (name === "reserve_balance") return { data: { id: "tx_1" }, error: null };
      if (name === "release_balance_reservation") {
        return { data: null, error: { message: "reservation release failed" } };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await expect(createReservedMediaJob({
      userId: "user_1",
      model,
      parameters: { prompt: "a mountain" },
      inputAssetIds: ["asset_1"],
    })).rejects.toThrow("reservation release failed");
  });

  it("restores partial asset attachments when the attach result count is short", async () => {
    const assetsStep = selectAssetsQuery({
      data: [
        { id: "asset_1", status: "uploaded", content_type: "image/png" },
        { id: "asset_2", status: "uploaded", content_type: "image/png" },
      ],
      error: null,
    });
    const insertStep = insertJobQuery({
      data: {
        id: "job_1",
        status: "creating",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 0,
        created_at: "2026-07-01T12:00:00.000Z",
      },
      error: null,
    });
    const attachStep = attachAssetsQuery({
      data: [{ id: "asset_1" }],
      error: null,
    });
    const detachStep = attachAssetsQuery({
      data: [{ id: "asset_1" }],
      error: null,
    });
    const admin = mockAdminWith(assetsStep, insertStep, attachStep, detachStep);

    await expect(createReservedMediaJob({
      userId: "user_1",
      model,
      parameters: { prompt: "a mountain" },
      inputAssetIds: ["asset_1", "asset_2"],
    })).rejects.toThrow("media_asset_attach_failed");

    expect(admin.tables).toEqual([
      "media_assets",
      "generation_jobs",
      "media_assets",
      "media_assets",
    ]);
    expect(detachStep.updated).toEqual({ job_id: null, status: "uploaded" });
    expect(detachStep.filters).toEqual([
      ["job_id", "job_1"],
      ["user_id", "user_1"],
      ["id", ["asset_1", "asset_2"]],
    ]);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_balance_reservation", {
      p_job_id: "job_1",
      p_status: "failed",
      p_error: "media_asset_attach_failed",
      p_metadata: { reason: "media_asset_attach_failed" },
    });
  });

  it("still releases the reservation when queue publish fails and input detach fails", async () => {
    const assetsStep = selectAssetsQuery({
      data: [{ id: "asset_1", status: "uploaded", content_type: "image/png" }],
      error: null,
    });
    const insertStep = insertJobQuery({
      data: {
        id: "job_1",
        status: "creating",
        estimated_cost_usd_micros: 500_000,
        reserved_amount_usd_micros: 0,
        created_at: "2026-07-01T12:00:00.000Z",
      },
      error: null,
    });
    const attachStep = attachAssetsQuery({
      data: [{ id: "asset_1" }],
      error: null,
    });
    const queueStep = updateJobQuery({
      data: null,
      error: { message: "queue publish failed" },
    });
    const detachStep = attachAssetsQuery({
      data: null,
      error: { message: "asset detach failed" },
    });
    const admin = mockAdminWith(assetsStep, insertStep, attachStep, queueStep, detachStep);

    await expect(createReservedMediaJob({
      userId: "user_1",
      model,
      parameters: { prompt: "a mountain" },
      inputAssetIds: ["asset_1"],
    })).rejects.toThrow("asset detach failed");

    expect(admin.rpc).toHaveBeenNthCalledWith(1, "reserve_balance", expect.any(Object));
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_balance_reservation", {
      p_job_id: "job_1",
      p_status: "failed",
      p_error: "queue publish failed",
      p_metadata: { reason: "media_job_queue_failed" },
    });
    expect(detachStep.updated).toEqual({ job_id: null, status: "uploaded" });
    expect(detachStep.filters).toEqual([
      ["job_id", "job_1"],
      ["user_id", "user_1"],
      ["id", ["asset_1"]],
    ]);
  });
});

function selectAssetsQuery<T>(result: SupabaseResult<T>): QueryStep {
  const step: QueryStep = { root: {}, filters: [] };
  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      step.filters.push([column, value]);
      return chain;
    }),
    in: vi.fn(async (column: string, value: unknown) => {
      step.filters.push([column, value]);
      return result;
    }),
  };

  step.root.select = vi.fn((columns: string) => {
    step.selected = columns;
    return chain;
  });

  return step;
}

function insertJobQuery<T>(result: SupabaseResult<T>): QueryStep {
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

function attachAssetsQuery<T>(result: SupabaseResult<T>): QueryStep {
  const step: QueryStep = { root: {}, filters: [] };
  const select = vi.fn(async (columns: string) => {
    step.selected = columns;
    return result;
  });
  const chain = {
    in: vi.fn((column: string, value: unknown) => {
      step.filters.push([column, value]);
      return chain;
    }),
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

function updateJobQuery<T>(result: SupabaseResult<T>): QueryStep {
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
    step.table = table;
    return step.root;
  });
  const rpc: ReturnType<typeof vi.fn> = vi.fn(async (name: string): Promise<SupabaseResult<{ id: string }>> => {
    if (name === "reserve_balance") return { data: { id: "tx_1" }, error: null };
    if (name === "release_balance_reservation") return { data: { id: "job_1" }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  mocks.createSupabaseAdminClient.mockReturnValue({ from, rpc });
  return {
    from,
    rpc,
    tables,
    get inserts() {
      return steps
        .filter((step) => step.table === "generation_jobs" && step.inserted !== undefined)
        .map((step) => step.inserted);
    },
    get updates() {
      return steps
        .filter((step) => step.table === "generation_jobs" && step.updated !== undefined)
        .map((step) => step.updated);
    },
  };
}
