import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaProviderAdapter } from "@/lib/media/provider";
import { processMediaJob } from "@/lib/media/executor";
import type { MediaModel } from "@/lib/media/types";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  getMediaModel: vi.fn(),
  getMediaEnv: vi.fn(),
  signMediaToken: vi.fn(),
  createOutputAssetRows: vi.fn(),
  failOutputAssetRowsForAttempt: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/media/model-registry", () => ({ getMediaModel: mocks.getMediaModel }));
vi.mock("@/lib/media/env", () => ({ getMediaEnv: mocks.getMediaEnv }));
vi.mock("@/lib/media/tokens", () => ({ signMediaToken: mocks.signMediaToken }));
vi.mock("@/lib/media/output-assets", () => ({
  createOutputAssetRows: mocks.createOutputAssetRows,
  failOutputAssetRowsForAttempt: mocks.failOutputAssetRowsForAttempt,
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
  inputAssetSchema: { roles: [] },
  pricingFormula: { type: "static" },
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

describe("processMediaJob", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    mocks.getMediaModel.mockReset();
    mocks.getMediaEnv.mockReset();
    mocks.signMediaToken.mockReset();
    mocks.createOutputAssetRows.mockReset();
    mocks.failOutputAssetRowsForAttempt.mockReset();
    mocks.getMediaEnv.mockReturnValue({
      baseUrl: "https://media.example.test",
      tokenSecret: "token-secret",
      workerSharedSecret: "worker-secret",
      maxUploadBytes: 1000,
      uploadUrlTtlSeconds: 900,
      downloadUrlTtlSeconds: 900,
      outputRetentionSeconds: 2_592_000,
    });
    mocks.signMediaToken.mockImplementation(async (payload: { assetId?: string }) =>
      `token-for-${payload.assetId}`
    );
    mocks.createOutputAssetRows.mockResolvedValue(materializedOutputs());
    mocks.failOutputAssetRowsForAttempt.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("claims the exact job id before provider work", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJob: jobRow() });
    const adapter = {
      run: vi.fn(async () => ({ status: "provider_failed" as const, metadata: { request_id: "fal_req_1" } })),
    } satisfies MediaProviderAdapter;
    const waitFor = vi.fn(async () => undefined);

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor })).resolves.toEqual({
      jobId: "job_1",
      status: "failed",
    });

    expect(admin.rpc).toHaveBeenNthCalledWith(1, "claim_media_job_by_id", {
      p_job_id: "job_1",
      p_lease_seconds: 300,
    });
    expect(adapter.run).toHaveBeenCalledOnce();
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_claimed_media_job", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_status: "failed",
      p_error: "provider_failed",
      p_metadata: {
        reason: "provider_failed",
        request_id: "fal_req_1",
      },
    });
  });

  it("exits without provider work when exact claim returns null", async () => {
    const admin = mockAdminWith({ claimedJob: null });
    const adapter = { run: vi.fn() } satisfies MediaProviderAdapter;

    await expect(processMediaJob({
      jobId: "job_missing",
      adapters: { fal: adapter },
      waitFor: async () => undefined,
    })).resolves.toEqual({ jobId: "job_missing", status: "not_claimed" });

    expect(admin.rpc).toHaveBeenCalledWith("claim_media_job_by_id", {
      p_job_id: "job_missing",
      p_lease_seconds: 300,
    });
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it("waits durably after provider_wait and then reclaims the same job", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({
      claimedJobs: [
        jobRow({ provider_job_id: null }),
        jobRow({ provider_job_id: "fal_req_1" }),
      ],
    });
    const adapter = {
      run: vi.fn()
        .mockResolvedValueOnce({ status: "waiting_provider" as const, providerJobId: "fal_req_1" })
        .mockResolvedValueOnce({
          status: "succeeded" as const,
          outputs: [{ url: "https://fal.example/out.mp4", type: "video", contentType: "video/mp4" }],
          rawCostUsd: 1,
          metadata: { fal_request_id: "fal_req_1", fal_status: "COMPLETED" },
        }),
    } satisfies MediaProviderAdapter;
    const waitFor = vi.fn(async () => undefined);

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor })).resolves.toEqual({
      jobId: "job_1",
      status: "succeeded",
    });

    expect(waitFor).toHaveBeenCalledWith({ seconds: 5 });
    expect(admin.rpc).toHaveBeenNthCalledWith(1, "claim_media_job_by_id", expect.any(Object));
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "mark_media_job_waiting_provider", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_provider_job_id: "fal_req_1",
      p_progress: {
        stage: "provider_wait",
        percent: null,
        message: "Waiting on provider",
      },
    });
    expect(admin.rpc).toHaveBeenNthCalledWith(3, "claim_media_job_by_id", expect.any(Object));
    expect(adapter.run).toHaveBeenNthCalledWith(1, {
      model,
      parameters: { prompt: "a mountain" },
      inputUrls: [],
      inputAssets: [],
      providerJobId: null,
      signal: undefined,
    });
    expect(adapter.run).toHaveBeenNthCalledWith(2, {
      model,
      parameters: { prompt: "a mountain" },
      inputUrls: [],
      inputAssets: [],
      providerJobId: "fal_req_1",
      signal: undefined,
    });
  });

  it("stops safely when the reclaim after provider wait returns null", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({
      claimedJobs: [jobRow(), null],
    });
    const adapter = {
      run: vi.fn(async () => ({
        status: "waiting_provider" as const,
        providerJobId: "fal_req_1",
      })),
    } satisfies MediaProviderAdapter;
    const waitFor = vi.fn(async () => undefined);

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor })).resolves.toEqual({
      jobId: "job_1",
      status: "not_claimed",
    });

    expect(waitFor).toHaveBeenCalledWith({ seconds: 5 });
    expect(admin.rpc).toHaveBeenNthCalledWith(3, "claim_media_job_by_id", {
      p_job_id: "job_1",
      p_lease_seconds: 300,
    });
  });

  it("releases expired media jobs before calling the provider", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({
      claimedJob: jobRow({
        expires_at: "2026-07-02T11:59:00.000Z",
        claim_token: "11111111-1111-4111-8111-111111111111",
      }),
    });
    const adapter = { run: vi.fn() } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "failed",
      });

    expect(adapter.run).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith("release_claimed_media_job", expect.objectContaining({
      p_error: "media_job_timed_out",
    }));
  });

  it("releases the reservation when the media model is missing", async () => {
    mocks.getMediaModel.mockResolvedValue(null);
    const admin = mockAdminWith({ claimedJob: jobRow() });

    await expect(processMediaJob({ jobId: "job_1", adapters: {}, waitFor: async () => undefined })).resolves.toEqual({
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
    const admin = mockAdminWith({ claimedJob: jobRow() });

    await expect(processMediaJob({ jobId: "job_1", adapters: {}, waitFor: async () => undefined })).resolves.toEqual({
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

  it("passes signed uploaded input URLs to providers on initial submit", async () => {
    mocks.getMediaModel.mockResolvedValue({
      ...model,
      supportsUploadedInputs: true,
      supportedInputTypes: ["image"],
    });
    const inputAssetRows = [
      { id: "asset_1", storage_key: "users/user_1/media/tmp/asset_1/input.png", content_type: "image/png" },
      { id: "asset_2", storage_key: "users/user_1/media/tmp/asset_2/input.png", content_type: "image/png" },
    ];
    const admin = mockAdminWith({
      claimedJobs: [
        jobRow({
          input: {
            media_model_id: "fal:frontier-video",
            parameters: { prompt: "animate this" },
            input_assets: [
              { asset_id: "asset_2", role: "image" },
              { asset_id: "asset_1", role: "image" },
            ],
            input_asset_ids: ["asset_2", "asset_1"],
          },
        }),
        null,
      ],
      inputAssetRows,
    });
    const adapter = {
      run: vi.fn(async () => ({
        status: "waiting_provider" as const,
        providerJobId: "provider_new",
      })),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "not_claimed",
      });

    expect(admin.tables).toEqual(["media_assets"]);
    expect(mocks.signMediaToken).toHaveBeenNthCalledWith(1, {
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_2/input.png",
      assetId: "asset_2",
      jobId: "job_1",
      exp: expect.any(Number),
    }, "token-secret");
    expect(mocks.signMediaToken).toHaveBeenNthCalledWith(2, {
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      assetId: "asset_1",
      jobId: "job_1",
      exp: expect.any(Number),
    }, "token-secret");
    expect(adapter.run).toHaveBeenNthCalledWith(1, {
      model: expect.objectContaining({ id: "fal:frontier-video" }),
      parameters: { prompt: "animate this" },
      inputUrls: [
        "https://media.example.test/objects/asset_2?token=token-for-asset_2",
        "https://media.example.test/objects/asset_1?token=token-for-asset_1",
      ],
      inputAssets: [
        {
          assetId: "asset_2",
          role: "image",
          contentType: "image/png",
          url: "https://media.example.test/objects/asset_2?token=token-for-asset_2",
        },
        {
          assetId: "asset_1",
          role: "image",
          contentType: "image/png",
          url: "https://media.example.test/objects/asset_1?token=token-for-asset_1",
        },
      ],
      providerJobId: null,
      signal: undefined,
    });
  });

  it("infers the sole schema role for legacy single-input jobs", async () => {
    mocks.getMediaModel.mockResolvedValue({
      ...model,
      supportsUploadedInputs: true,
      supportedInputTypes: ["image"],
      inputAssetSchema: {
        roles: [
          {
            role: "first_frame",
            providerField: "first_frame_url",
            mediaKind: "image",
            required: true,
            min: 1,
            max: 1,
            contentTypePrefixes: ["image/"],
          },
        ],
      },
    });
    mockAdminWith({
      claimedJobs: [
        jobRow({
          input: {
            media_model_id: "fal:frontier-video",
            parameters: { prompt: "animate this" },
            input_asset_ids: ["asset_1"],
          },
        }),
        null,
      ],
      inputAssetRows: [
        { id: "asset_1", storage_key: "users/user_1/media/tmp/asset_1/input.png", content_type: "image/png" },
      ],
    });
    const adapter = {
      run: vi.fn(async () => ({
        status: "waiting_provider" as const,
        providerJobId: "provider_new",
      })),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "not_claimed",
      });

    expect(adapter.run).toHaveBeenNthCalledWith(1, {
      model: expect.objectContaining({ id: "fal:frontier-video" }),
      parameters: { prompt: "animate this" },
      inputUrls: [
        "https://media.example.test/objects/asset_1?token=token-for-asset_1",
      ],
      inputAssets: [
        {
          assetId: "asset_1",
          role: "first_frame",
          contentType: "image/png",
          url: "https://media.example.test/objects/asset_1?token=token-for-asset_1",
        },
      ],
      providerJobId: null,
      signal: undefined,
    });
  });

  it("preserves generic inputUrls for legacy jobs without role schema", async () => {
    mocks.getMediaModel.mockResolvedValue({
      ...model,
      supportsUploadedInputs: true,
      supportedInputTypes: ["image"],
    });
    mockAdminWith({
      claimedJobs: [
        jobRow({
          input: {
            media_model_id: "fal:frontier-video",
            parameters: { prompt: "animate this" },
            input_asset_ids: ["asset_1"],
          },
        }),
        null,
      ],
      inputAssetRows: [
        { id: "asset_1", storage_key: "users/user_1/media/tmp/asset_1/input.png", content_type: "image/png" },
      ],
    });
    const adapter = {
      run: vi.fn(async () => ({
        status: "waiting_provider" as const,
        providerJobId: "provider_new",
      })),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "not_claimed",
      });

    expect(adapter.run).toHaveBeenNthCalledWith(1, {
      model: expect.objectContaining({ id: "fal:frontier-video" }),
      parameters: { prompt: "animate this" },
      inputUrls: [
        "https://media.example.test/objects/asset_1?token=token-for-asset_1",
      ],
      inputAssets: [],
      providerJobId: null,
      signal: undefined,
    });
  });

  it("releases the job when attached input assets are unavailable", async () => {
    mocks.getMediaModel.mockResolvedValue({
      ...model,
      supportsUploadedInputs: true,
      supportedInputTypes: ["image"],
    });
    const admin = mockAdminWith({
      claimedJob: jobRow({
        input: {
          media_model_id: "fal:frontier-video",
          parameters: { prompt: "animate this" },
          input_asset_ids: ["asset_1"],
        },
      }),
      inputAssetRows: [],
    });
    const adapter = {
      run: vi.fn(),
    } as unknown as MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "failed",
      });

    expect(adapter.run).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_claimed_media_job", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_status: "failed",
      p_error: "media_input_unavailable",
      p_metadata: { reason: "media_input_unavailable" },
    });
  });

  it("returns stale claim when waiting-provider update rejects the claim", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({
      claimedJob: jobRow(),
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

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "stale_claim",
      });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });

  it("inserts a usage event and settles the reservation when the provider succeeds", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJob: jobRow() });
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

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
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
        outputs: [wovenOutput()],
        provider_metadata: {
          endpoint: "fal-ai/frontier-video",
          request_id: "provider_1",
          status: "complete",
        },
        charged_amount_usd_micros: 300_000,
      },
      p_metadata: {
        media_model_id: "fal:frontier-video",
        outputs: [wovenOutput()],
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
    expect(mocks.createOutputAssetRows).toHaveBeenCalledWith({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [
        {
          url: "https://provider.example/output.mp4",
          contentType: "video/mp4",
          type: "video",
        },
      ],
    });
  });

  it("settles from stored pricing quote when provider returns no raw cost", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({
      claimedJob: jobRow({
        input: {
          media_model_id: "fal:frontier-video",
          parameters: { prompt: "a mountain" },
          input_asset_ids: [],
          input_assets: [],
          pricing_quote: {
            estimate_kind: "parameter_quote",
            provider_cost_usd_micros: 3_200_000,
            charged_amount_usd_micros: 3_840_000,
            reserved_amount_usd_micros: 3_840_000,
            markup_amount_usd_micros: 640_000,
            formula: "veo_seconds",
            inputs: { duration_seconds: 8 },
          },
        },
      }),
    });
    const adapter = {
      run: vi.fn(async () => ({
        status: "succeeded" as const,
        outputs: [{ url: "https://provider.example/output.mp4", type: "video" as const, contentType: "video/mp4" }],
        rawCostUsd: 0,
        metadata: { request_id: "provider_1" },
      })),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toMatchObject({
        jobId: "job_1",
        status: "succeeded",
      });

    expect(admin.rpc).toHaveBeenCalledWith("record_and_settle_claimed_media_job", expect.objectContaining({
      p_final_cost_usd_micros: 3_840_000,
      p_usage_event: expect.objectContaining({
        raw_provider_cost: 0,
        charged_amount_usd_micros: 3_840_000,
        markup_amount_usd_micros: 640_000,
      }),
    }));
  });

  it("settles inline provider outputs after copying them to Woven media assets", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJob: jobRow() });
    const adapter = {
      run: vi.fn(async () => ({
        status: "succeeded" as const,
        rawCostUsd: "0.25",
        outputs: [
          {
            data: Buffer.from([1, 2, 3, 4]),
            contentType: "audio/mpeg",
            type: "audio" as const,
          },
        ],
      })),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "succeeded",
      });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.createOutputAssetRows).toHaveBeenCalledWith({
      userId: "user_1",
      jobId: "job_1",
      claimToken,
      outputs: [
        {
          data: Buffer.from([1, 2, 3, 4]),
          contentType: "audio/mpeg",
          type: "audio",
        },
      ],
    });
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "record_and_settle_claimed_media_job", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_final_cost_usd_micros: 300_000,
      p_output: {
        media_model_id: "fal:frontier-video",
        outputs: [wovenOutput()],
        provider_metadata: {},
        charged_amount_usd_micros: 300_000,
      },
      p_metadata: {
        media_model_id: "fal:frontier-video",
        outputs: [wovenOutput()],
        provider_metadata: {},
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
        metadata: {},
      },
    });
    expect(JSON.stringify(admin.rpc.mock.calls[1]?.[1]?.p_output?.outputs)).not.toContain("source");
    expect(JSON.stringify(admin.rpc.mock.calls[1]?.[1]?.p_output?.outputs)).not.toContain("base64");
  });

  it("releases the claimed job with a safe reason when output materialization fails", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    mocks.createOutputAssetRows.mockRejectedValueOnce(
      new Error("media_output_upload_failed:network https://provider.example/output.mp4"),
    );
    const admin = mockAdminWith({ claimedJob: jobRow() });
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

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "failed",
      });

    expect(admin.rpc).toHaveBeenCalledTimes(2);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_claimed_media_job", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_status: "failed",
      p_error: "media_output_materialization_failed",
      p_metadata: { reason: "media_output_materialization_failed" },
    });
    expect(JSON.stringify(admin.rpc.mock.calls[1]?.[1])).not.toContain("provider.example");
  });

  it("returns stale claim when output materialization sees a stale claim", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    mocks.createOutputAssetRows.mockRejectedValueOnce(new Error("media_job_stale_claim"));
    const admin = mockAdminWith({ claimedJob: jobRow() });
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

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "stale_claim",
      });

    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.failOutputAssetRowsForAttempt).not.toHaveBeenCalled();
  });

  it("catches adapter errors, releases the reservation, and returns failed", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJob: jobRow() });
    const adapter = {
      run: vi.fn(async () => {
        throw new Error("provider exploded with token secret");
      }),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "failed",
      });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, "release_claimed_media_job", {
      p_job_id: "job_1",
      p_claim_token: claimToken,
      p_status: "failed",
      p_error: "provider_failed",
      p_metadata: {
        reason: "provider_failed",
        provider_error_name: "Error",
      },
    });
  });

  it("stores sanitized provider failure diagnostics", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const secretMessage = "Provider failed with api_key=secret and request id req_123";
    const admin = mockAdminWith({ claimedJob: jobRow() });
    const adapter = {
      run: vi.fn(async () => {
        const error = new Error(secretMessage);
        Object.assign(error, { requestId: "req_123", status: 429 });
        throw error;
      }),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "failed",
      });

    expect(admin.rpc).toHaveBeenCalledWith("release_claimed_media_job", expect.objectContaining({
      p_error: "provider_failed",
      p_metadata: expect.objectContaining({
        reason: "provider_failed",
        provider_error_name: "Error",
        provider_request_id: "req_123",
        provider_status: 429,
      }),
    }));
    expect(JSON.stringify(admin.rpc.mock.calls)).not.toContain("api_key=secret");
  });

  it("propagates provider_not_configured adapter errors without releasing the reservation", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJob: jobRow() });
    const adapter = {
      run: vi.fn(async () => {
        throw new Error("provider_not_configured");
      }),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .rejects.toThrow("provider_not_configured");

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("propagates adapter AbortError and does not release the reservation", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJob: jobRow() });
    const abortError = new DOMException("Worker stopped", "AbortError");
    const adapter = {
      run: vi.fn(async () => {
        throw abortError;
      }),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .rejects.toBe(abortError);

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("propagates an already-aborted signal before running the adapter", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJob: jobRow() });
    const abortController = new AbortController();
    const abortError = new DOMException("Worker stopped", "AbortError");
    abortController.abort(abortError);
    const adapter = {
      run: vi.fn(async () => ({
        status: "waiting_provider" as const,
        providerJobId: "provider_new",
      })),
    } satisfies MediaProviderAdapter;

    await expect(processMediaJob({
      jobId: "job_1",
      adapters: { fal: adapter },
      waitFor: async () => undefined,
      signal: abortController.signal,
    })).rejects.toBe(abortError);

    expect(adapter.run).not.toHaveBeenCalled();
    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns stale claim and does not insert usage when claim-aware settlement rejects the claim", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const attemptAssets = [{
      id: "attempt_output_1",
      outputAttemptId: "attempt_id_1",
      storageKey: "users/user_1/media/outputs/job_1/attempt_output_1/attempts/attempt_id_1/output.mp4",
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "remote_url",
        output_attempt_id: "attempt_id_1",
      },
    }];
    mocks.createOutputAssetRows.mockResolvedValueOnce({
      outputs: [wovenOutput()],
      attemptAssets,
    });
    const admin = mockAdminWith({
      claimedJob: jobRow(),
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

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "stale_claim",
      });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.failOutputAssetRowsForAttempt).toHaveBeenCalledWith({
      userId: "user_1",
      jobId: "job_1",
      attemptAssets,
      reason: "media_output_materialization_failed",
    });
  });

  it("returns stale claim when claim-aware release rejects the claim", async () => {
    mocks.getMediaModel.mockResolvedValue(null);
    const admin = mockAdminWith({
      claimedJob: jobRow(),
      rpcResults: {
        release_claimed_media_job: {
          data: null,
          error: { message: "media_job_stale_claim" },
        },
      },
    });

    await expect(processMediaJob({ jobId: "job_1", adapters: {}, waitFor: async () => undefined })).resolves.toEqual({
      jobId: "job_1",
      status: "stale_claim",
    });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });

  it("does not finalize a claimed job without a claim token", async () => {
    mocks.getMediaModel.mockResolvedValue(model);
    const admin = mockAdminWith({ claimedJob: jobRow({ claim_token: null }) });
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

    await expect(processMediaJob({ jobId: "job_1", adapters: { fal: adapter }, waitFor: async () => undefined }))
      .resolves.toEqual({
        jobId: "job_1",
        status: "stale_claim",
      });

    expect(admin.tables).toEqual([]);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("claim-aware media finalization migration", () => {
  it("compares every inserted usage event field on idempotent retry", () => {
    const sql = readFileSync(
      "supabase/migrations/20260701122000_claim_aware_media_job_finalization.sql",
      "utf8",
    );

    expect(sql).toContain("v_input_units bigint;");
    expect(sql).toContain("v_existing_usage.user_id is distinct from v_job.user_id");
    expect(sql).toContain("v_existing_usage.input_units is distinct from v_input_units");
    expect(sql).toContain("v_existing_usage.output_units is distinct from v_output_units");
    expect(sql).toContain("v_existing_usage.reasoning_units is distinct from v_reasoning_units");
    expect(sql).toContain("v_existing_usage.cached_units is distinct from v_cached_units");
    expect(sql).toContain("v_existing_usage.metadata is distinct from v_usage_metadata");
    expect(sql).toContain("v_existing_usage.gateway_generation_id is not null");
  });
});

describe("claim-aware media output asset migration", () => {
  it("adds stale cleanup scoped by output attempt metadata", () => {
    const sql = readFileSync(
      "supabase/migrations/20260701124000_fail_media_output_asset_attempt.sql",
      "utf8",
    );

    expect(sql).toContain("create or replace function public.fail_media_output_asset_attempt");
    expect(sql).toContain("metadata->>'output_attempt_id' = p_output_attempt_id");
    expect(sql).toContain("raise exception 'media_output_asset_attempt_not_found'");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("claim_token =");
  });

  it("adds claim-aware reuse and storage-key-fenced stale cleanup", () => {
    const sql = readFileSync(
      "supabase/migrations/20260701125000_reuse_claimed_media_output_asset.sql",
      "utf8",
    );

    expect(sql).toContain("create or replace function public.reuse_claimed_media_output_asset");
    expect(sql).toContain("claim_token = p_claim_token");
    expect(sql).toContain("and status = 'ready'");
    expect(sql).toContain("and content_type = p_content_type");
    expect(sql).toContain("and size_bytes = p_size_bytes");
    expect(sql).toContain("and storage_key = p_storage_key");
    expect(sql).toContain("create or replace function public.fail_media_output_asset_attempt");
    expect(sql).toContain("and metadata->>'output_attempt_id' = p_output_attempt_id");
    expect(sql).toContain("revoke all on function public.fail_media_output_asset_attempt(uuid, uuid, uuid, text, text, jsonb)");
  });
});

describe("media job readiness migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260702160000_media_job_readiness_deadlines_cleanup.sql"),
    "utf8",
  );

  it("adds a non-claimable creating status", () => {
    expect(migration).toContain("'creating'");
    expect(migration).toContain("add constraint generation_jobs_status_check_replacement");
    expect(migration).toContain("not valid");
    expect(migration).toContain("validate constraint generation_jobs_status_check_replacement");
    expect(migration).toContain("rename constraint generation_jobs_status_check_replacement to generation_jobs_status_check");
    expect(migration).toContain("status in ('queued', 'running', 'waiting_provider')");
    expect(migration).not.toContain("status in ('creating', 'queued', 'running', 'waiting_provider')");
  });

  it("replaces media asset status check with a validated replacement constraint", () => {
    expect(migration).toContain("add constraint media_assets_status_check_replacement");
    expect(migration).toContain("validate constraint media_assets_status_check_replacement");
    expect(migration).toContain("rename constraint media_assets_status_check_replacement to media_assets_status_check");
    expect(migration).toContain("'deleting'");
  });

  it("requires queued media jobs to have a reservation before claim", () => {
    expect(migration).toContain("coalesce(jobs.reserved_amount_usd_micros, 0) > 0");
  });

  it("requires queued input_asset_ids to be attached to the job before claim", () => {
    expect(migration).toContain("jsonb_array_elements_text");
    expect(migration).toContain("assets.job_id = jobs.id");
    expect(migration).toContain("assets.kind = 'input'");
    expect(migration).toContain("assets.status = 'attached'");
  });

  it("recovers stale media asset deletion claims", () => {
    expect(migration).toContain("delete_claimed_at");
    expect(migration).toContain("assets.status = 'deleting'");
    expect(migration).toContain("(assets.metadata->>'delete_claimed_at')::timestamptz < p_now - interval '1 hour'");
    expect(migration).toContain("when assets.status = 'deleting' then nullif(assets.metadata->>'delete_previous_status', '')");
    expect(migration).toContain("else assets.status");
    expect(migration).toContain("when candidates.previous_status is null then '{}'::jsonb");
    expect(migration).toContain("- 'delete_previous_status' - 'delete_claimed_at'");
  });
});

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    user_id: "user_1",
    provider_job_id: null,
    claim_token: claimToken,
    expires_at: "2027-07-03T13:00:00.000Z",
    input: {
      media_model_id: "fal:frontier-video",
      parameters: { prompt: "a mountain" },
      input_asset_ids: [],
      input_assets: [],
      pricing_quote: null,
    },
    ...overrides,
  };
}

function wovenOutput() {
  return {
    id: "output_asset_1",
    type: "video",
    content_type: "video/mp4",
  };
}

function materializedOutputs() {
  return {
    outputs: [wovenOutput()],
    attemptAssets: [{
      id: "output_asset_1",
      outputAttemptId: "attempt_id_1",
      storageKey: "users/user_1/media/outputs/job_1/output_asset_1/attempts/attempt_id_1/output.mp4",
      metadata: {
        source: "provider_output",
        output_index: 0,
        provider_source_type: "remote_url",
        output_attempt_id: "attempt_id_1",
      },
    }],
  };
}

function mockAdminWith({
  claimedJob,
  claimedJobs,
  inputAssetRows = [],
  rpcResults = {},
  rpcRejects = {},
}: {
  claimedJob?: unknown | null;
  claimedJobs?: Array<unknown>;
  inputAssetRows?: Array<{ id: string; storage_key: string; content_type?: string }>;
  rpcResults?: Record<string, SupabaseResult<unknown>>;
  rpcRejects?: Record<string, Error>;
}) {
  const queue = claimedJobs ? [...claimedJobs] : [claimedJob];
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    if (table === "media_assets") {
      const chain = {
        eq: vi.fn(() => chain),
        in: vi.fn(() => Promise.resolve({ data: inputAssetRows, error: null })),
        select: vi.fn(() => chain),
      };
      return {
        select: vi.fn(() => chain),
      };
    }
    throw new Error(`Unexpected Supabase table: ${table}`);
  });
  const rpc: ReturnType<typeof vi.fn> = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_media_job_by_id") return { data: queue.shift() ?? null, error: null };
    if (name in rpcRejects) throw rpcRejects[name];
    if (name in rpcResults) return rpcResults[name];
    if (name === "mark_media_job_waiting_provider") return { data: { id: args.p_job_id }, error: null };
    if (name === "release_claimed_media_job") return { data: { id: args.p_job_id }, error: null };
    if (name === "record_and_settle_claimed_media_job") return { data: { id: args.p_job_id }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });

  mocks.createSupabaseAdminClient.mockReturnValue({ from, rpc });
  return { from, rpc, tables };
}
