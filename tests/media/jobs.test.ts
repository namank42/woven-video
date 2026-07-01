import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaModel } from "@/lib/media/types";
import { createReservedMediaJob } from "@/lib/media/jobs";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

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
  });

  it("validates uploaded input assets, reserves credits, attaches assets, and returns the queued job", async () => {
    const assetsStep = selectAssetsQuery({
      data: [{ id: "asset_1", status: "uploaded", content_type: "image/png" }],
      error: null,
    });
    const insertStep = insertJobQuery({
      data: {
        id: "job_1",
        status: "queued",
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
    const admin = mockAdminWith(assetsStep, insertStep, attachStep);

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
    });

    expect(admin.tables).toEqual(["media_assets", "generation_jobs", "media_assets"]);
    expect(insertStep.inserted).toMatchObject({
      user_id: "user_1",
      type: "media_job",
      provider: "fal",
      model: "fal-ai/frontier-video",
      status: "queued",
      estimated_cost_usd_micros: 500_000,
      input: {
        media_model_id: "fal:frontier-video",
        operation: "video_generation",
        parameters: { prompt: "a mountain" },
        input_asset_ids: ["asset_1"],
      },
      progress: { stage: "queued", percent: null },
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
  });

  it("releases the reservation and fails the job when asset attachment fails after reservation", async () => {
    const assetsStep = selectAssetsQuery({
      data: [{ id: "asset_1", status: "uploaded", content_type: "image/png" }],
      error: null,
    });
    const insertStep = insertJobQuery({
      data: {
        id: "job_1",
        status: "queued",
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
    const admin = mockAdminWith(assetsStep, insertStep, attachStep);

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

function mockAdminWith(...steps: QueryStep[]) {
  const queue = [...steps];
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const step = queue.shift();
    if (!step) throw new Error(`Unexpected Supabase table: ${table}`);
    return step.root;
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "reserve_balance") return { data: { id: "tx_1" }, error: null };
    if (name === "release_balance_reservation") return { data: { id: "job_1" }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  mocks.createSupabaseAdminClient.mockReturnValue({ from, rpc });
  return { from, rpc, tables };
}
