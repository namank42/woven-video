import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaProviderAdapter } from "@/lib/media/provider";
import { drainOneMediaJob } from "@/lib/media/worker";
import type { MediaModel } from "@/lib/media/types";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  getMediaModel: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

vi.mock("@/lib/media/model-registry", () => ({
  getMediaModel: mocks.getMediaModel,
}));

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

const model = {
  id: "fal:frontier-video",
  provider: "fal",
  providerModel: "fal-ai/frontier-video",
  providerEndpoint: "fal-ai/frontier-video",
  operation: "video_generation",
  kind: "video",
  displayName: "Frontier Video",
  supportsUploadedInputs: false,
  supportedInputTypes: [],
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
} as unknown as MediaModel;

describe("drainOneMediaJob", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    mocks.getMediaModel.mockReset();
  });

  it("returns unclaimed when the claim RPC returns no jobs", async () => {
    const admin = mockAdminWith({ claimedJobs: [] });

    await expect(drainOneMediaJob({ adapters: {} })).resolves.toEqual({ claimed: false });

    expect(admin.rpc).toHaveBeenCalledWith("claim_media_jobs", {
      p_limit: 1,
      p_lease_seconds: 300,
    });
    expect(mocks.getMediaModel).not.toHaveBeenCalled();
  });

  it("releases the reservation when the media model is missing", async () => {
    mocks.getMediaModel.mockResolvedValue(null);
    const touchStep = updateRowsQuery({ data: [{ id: "job_1" }], error: null });
    const admin = mockAdminWith({ claimedJobs: [jobRow()], fromSteps: [touchStep] });

    await expect(drainOneMediaJob({ adapters: {} })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "failed",
    });

    expect(mocks.getMediaModel).toHaveBeenCalledWith("fal:frontier-video");
    expectClaimTouch(touchStep);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_balance_reservation", {
      p_job_id: "job_1",
      p_status: "failed",
      p_error: "model_not_enabled",
      p_metadata: { reason: "model_not_enabled" },
    });
  });

  it("releases the reservation when the provider adapter is not configured", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const touchStep = updateRowsQuery({ data: [{ id: "job_1" }], error: null });
    const admin = mockAdminWith({ claimedJobs: [jobRow()], fromSteps: [touchStep] });

    await expect(drainOneMediaJob({ adapters: {} })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "failed",
    });

    expectClaimTouch(touchStep);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_balance_reservation", {
      p_job_id: "job_1",
      p_status: "failed",
      p_error: "provider_not_configured",
      p_metadata: { reason: "provider_not_configured" },
    });
  });

  it("updates waiting provider state with provider id and claim token fencing", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const updateStep = updateRowsQuery({ data: [{ id: "job_1" }], error: null });
    const admin = mockAdminWith({ claimedJobs: [jobRow({ provider_job_id: "provider_old" })], fromSteps: [updateStep] });
    const adapter = {
      run: vi.fn(async () => ({
        status: "waiting_provider" as const,
        providerJobId: "provider_new",
        metadata: { request_id: "provider_new" },
      })),
    } satisfies MediaProviderAdapter;

    await expect(drainOneMediaJob({ adapters: { fal: adapter } })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "waiting_provider",
    });

    expect(adapter.run).toHaveBeenCalledWith({
      model,
      parameters: { prompt: "a mountain" },
      inputUrls: [],
      providerJobId: "provider_old",
      signal: undefined,
    });
    expect(admin.tables).toEqual(["generation_jobs"]);
    expect(updateStep.updated).toEqual({
      status: "waiting_provider",
      provider_job_id: "provider_new",
      progress: {
        stage: "provider_wait",
        percent: null,
        message: "Waiting on provider",
      },
    });
    expect(updateStep.filters).toEqual([
      ["id", "job_1"],
      ["claim_token", "claim_1"],
    ]);
  });

  it("inserts a usage event and settles the reservation when the provider succeeds", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const touchStep = updateRowsQuery({ data: [{ id: "job_1" }], error: null });
    const usageStep = insertRowsQuery({ data: [{ id: "usage_1" }], error: null });
    const admin = mockAdminWith({ claimedJobs: [jobRow()], fromSteps: [touchStep, usageStep] });
    const adapter = {
      run: vi.fn(async () => ({
        status: "succeeded" as const,
        rawCostUsd: "0.25",
        outputs: [
          {
            url: "https://provider.example/output.mp4",
            contentType: "video/mp4",
            type: "video" as const,
          },
        ],
        metadata: {
          request_id: "provider_1",
          api_key: "should-not-be-stored",
        },
      })),
    } satisfies MediaProviderAdapter;

    await expect(drainOneMediaJob({ adapters: { fal: adapter } })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "succeeded",
    });

    expect(admin.tables).toEqual(["generation_jobs", "usage_events"]);
    expectClaimTouch(touchStep);
    expect(usageStep.inserted).toMatchObject({
      user_id: "user_1",
      job_id: "job_1",
      provider: "fal",
      model: "fal-ai/frontier-video",
      operation: "video_generation",
      raw_provider_cost: 0.25,
      charged_amount_usd_micros: 300_000,
      markup_amount_usd_micros: 50_000,
      metadata: { request_id: "provider_1" },
    });
    expect(usageStep.inserted).not.toHaveProperty("metadata.api_key");
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "settle_balance_reservation", {
      p_job_id: "job_1",
      p_final_cost_usd_micros: 300_000,
      p_output: {
        media_model_id: "fal:frontier-video",
        outputs: [
          {
            id: "out_1",
            type: "video",
            content_type: "video/mp4",
            source_url: "https://provider.example/output.mp4",
            user_id: "user_1",
            job_id: "job_1",
          },
        ],
        provider_metadata: { request_id: "provider_1" },
        charged_amount_usd_micros: 300_000,
      },
      p_metadata: {
        media_model_id: "fal:frontier-video",
        outputs: [
          {
            id: "out_1",
            type: "video",
            content_type: "video/mp4",
            source_url: "https://provider.example/output.mp4",
            user_id: "user_1",
            job_id: "job_1",
          },
        ],
        provider_metadata: { request_id: "provider_1" },
        charged_amount_usd_micros: 300_000,
      },
    });
  });

  it("catches adapter errors, releases the reservation, and returns failed", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const touchStep = updateRowsQuery({ data: [{ id: "job_1" }], error: null });
    const admin = mockAdminWith({ claimedJobs: [jobRow()], fromSteps: [touchStep] });
    const adapter = {
      run: vi.fn(async () => {
        throw new Error("provider exploded with token secret");
      }),
    } satisfies MediaProviderAdapter;

    await expect(drainOneMediaJob({ adapters: { fal: adapter } })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "failed",
    });

    expectClaimTouch(touchStep);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_balance_reservation", {
      p_job_id: "job_1",
      p_status: "failed",
      p_error: "provider_failed",
      p_metadata: { reason: "provider_failed" },
    });
  });
});

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    user_id: "user_1",
    provider_job_id: null,
    claim_token: "claim_1",
    input: {
      media_model_id: "fal:frontier-video",
      parameters: { prompt: "a mountain" },
    },
    ...overrides,
  };
}

function updateRowsQuery<T>(result: SupabaseResult<T>): QueryStep {
  const step: QueryStep = { root: {}, filters: [] };
  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      step.filters.push([column, value]);
      return chain;
    }),
    select: vi.fn(async (columns: string) => {
      step.selected = columns;
      return result;
    }),
  };

  step.root.update = vi.fn((values: unknown) => {
    step.updated = values;
    return chain;
  });

  return step;
}

function insertRowsQuery<T>(result: SupabaseResult<T>): QueryStep {
  const step: QueryStep = { root: {}, filters: [] };

  step.root.insert = vi.fn(async (values: unknown) => {
    step.inserted = values;
    return result;
  });

  return step;
}

function expectClaimTouch(step: QueryStep) {
  expect(step.updated).toEqual({ claim_expires_at: expect.any(String) });
  expect(step.filters).toEqual([
    ["id", "job_1"],
    ["claim_token", "claim_1"],
  ]);
}

function mockAdminWith({
  claimedJobs,
  fromSteps = [],
}: {
  claimedJobs: unknown[];
  fromSteps?: QueryStep[];
}) {
  const queryQueue = [...fromSteps];
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const step = queryQueue.shift();
    if (!step) throw new Error(`Unexpected Supabase table: ${table}`);
    return step.root;
  });
  const rpc: ReturnType<typeof vi.fn> = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_media_jobs") return { data: claimedJobs, error: null };
    if (name === "release_balance_reservation") return { data: { id: args.p_job_id }, error: null };
    if (name === "settle_balance_reservation") return { data: { id: args.p_job_id }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  mocks.createSupabaseAdminClient.mockReturnValue({ from, rpc });
  return { from, rpc, tables };
}
