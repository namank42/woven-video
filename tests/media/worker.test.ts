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

const claimToken = "00000000-0000-4000-8000-000000000001";

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
    const admin = mockAdminWith({ claimedJobs: [jobRow()] });

    await expect(drainOneMediaJob({ adapters: {} })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "failed",
    });

    expect(mocks.getMediaModel).toHaveBeenCalledWith("fal:frontier-video");
    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_claimed_media_job", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_status: "failed",
      p_error: "model_not_enabled",
      p_metadata: { reason: "model_not_enabled" },
    });
  });

  it("releases the reservation when the provider adapter is not configured", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJobs: [jobRow()] });

    await expect(drainOneMediaJob({ adapters: {} })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "failed",
    });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_claimed_media_job", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_status: "failed",
      p_error: "provider_not_configured",
      p_metadata: { reason: "provider_not_configured" },
    });
  });

  it("updates waiting provider state with provider id and claim token fencing", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJobs: [jobRow({ provider_job_id: "provider_old" })] });
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
    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "mark_media_job_waiting_provider", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_provider_job_id: "provider_new",
      p_progress: {
        stage: "provider_wait",
        percent: null,
        message: "Waiting on provider",
      },
    });
  });

  it("returns stale claim when waiting-provider update rejects the claim", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({
      claimedJobs: [jobRow()],
      rpcResults: {
        mark_media_job_waiting_provider: {
          data: null,
          error: { message: "media_job_stale_claim" },
        },
      },
    });
    const adapter = {
      run: vi.fn(async () => ({
        status: "waiting_provider" as const,
        providerJobId: "provider_new",
      })),
    } satisfies MediaProviderAdapter;

    await expect(drainOneMediaJob({ adapters: { fal: adapter } })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "stale_claim",
    });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });

  it("inserts a usage event and settles the reservation when the provider succeeds", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJobs: [jobRow()] });
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
          status: "complete",
          endpoint: "fal-ai/frontier-video",
          fal_status: "Authorization: Bearer secret-token",
          notes: ["Authorization: Bearer secret-token"],
          nested: { request_id: "nested", value: "Bearer secret" },
        },
      })),
    } satisfies MediaProviderAdapter;

    await expect(drainOneMediaJob({ adapters: { fal: adapter } })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "succeeded",
    });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "record_and_settle_claimed_media_job", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
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
        provider_metadata: {
          endpoint: "fal-ai/frontier-video",
          request_id: "provider_1",
          status: "complete",
        },
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
        provider_metadata: {
          endpoint: "fal-ai/frontier-video",
          request_id: "provider_1",
          status: "complete",
        },
        charged_amount_usd_micros: 300_000,
      },
      p_usage_event: {
        user_id: "user_1",
        job_id: "job_1",
        provider: "fal",
        model: "fal-ai/frontier-video",
        operation: "video_generation",
        raw_provider_cost: 0.25,
        charged_amount_usd_micros: 300_000,
        markup_amount_usd_micros: 50_000,
        metadata: {
          endpoint: "fal-ai/frontier-video",
          request_id: "provider_1",
          status: "complete",
        },
      },
    });
  });

  it("catches adapter errors, releases the reservation, and returns failed", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJobs: [jobRow()] });
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

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_claimed_media_job", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_status: "failed",
      p_error: "provider_failed",
      p_metadata: { reason: "provider_failed" },
    });
  });

  it("propagates adapter AbortError and does not release the reservation", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJobs: [jobRow()] });
    const abortError = new DOMException("Worker stopped", "AbortError");
    const adapter = {
      run: vi.fn(async () => {
        throw abortError;
      }),
    } satisfies MediaProviderAdapter;

    await expect(drainOneMediaJob({ adapters: { fal: adapter } })).rejects.toBe(abortError);

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("propagates an already-aborted signal before running the adapter", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJobs: [jobRow()] });
    const abortController = new AbortController();
    const abortError = new DOMException("Worker stopped", "AbortError");
    abortController.abort(abortError);
    const adapter = {
      run: vi.fn(async () => ({
        status: "waiting_provider" as const,
        providerJobId: "provider_new",
      })),
    } satisfies MediaProviderAdapter;

    await expect(drainOneMediaJob({
      adapters: { fal: adapter },
      signal: abortController.signal,
    })).rejects.toBe(abortError);

    expect(adapter.run).not.toHaveBeenCalled();
    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns stale claim and does not insert usage when claim-aware settlement rejects the claim", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({
      claimedJobs: [jobRow()],
      rpcResults: {
        record_and_settle_claimed_media_job: {
          data: null,
          error: { message: "media_job_stale_claim" },
        },
      },
    });
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
      })),
    } satisfies MediaProviderAdapter;

    await expect(drainOneMediaJob({ adapters: { fal: adapter } })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "stale_claim",
    });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });

  it("returns stale claim when claim-aware release rejects the claim", async () => {
    mocks.getMediaModel.mockResolvedValue(null);
    const admin = mockAdminWith({
      claimedJobs: [jobRow()],
      rpcResults: {
        release_claimed_media_job: {
          data: null,
          error: { message: "media_job_stale_claim" },
        },
      },
    });

    await expect(drainOneMediaJob({ adapters: {} })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "stale_claim",
    });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });

  it("does not finalize a claimed job without a claim token", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJobs: [jobRow({ claim_token: null })] });
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
      })),
    } satisfies MediaProviderAdapter;

    await expect(drainOneMediaJob({ adapters: { fal: adapter } })).resolves.toEqual({
      claimed: true,
      jobId: "job_1",
      status: "stale_claim",
    });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
});

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    user_id: "user_1",
    provider_job_id: null,
    claim_token: claimToken,
    input: {
      media_model_id: "fal:frontier-video",
      parameters: { prompt: "a mountain" },
    },
    ...overrides,
  };
}

function mockAdminWith({
  claimedJobs,
  rpcResults = {},
}: {
  claimedJobs: unknown[];
  rpcResults?: Record<string, SupabaseResult<unknown>>;
}) {
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    throw new Error(`Unexpected Supabase table: ${table}`);
  });
  const rpc: ReturnType<typeof vi.fn> = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_media_jobs") return { data: claimedJobs, error: null };
    if (name in rpcResults) return rpcResults[name];
    if (name === "mark_media_job_waiting_provider") return { data: { id: args.p_job_id }, error: null };
    if (name === "release_claimed_media_job") return { data: { id: args.p_job_id }, error: null };
    if (name === "record_and_settle_claimed_media_job") return { data: { id: args.p_job_id }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  mocks.createSupabaseAdminClient.mockReturnValue({ from, rpc });
  return { from, rpc, tables };
}
