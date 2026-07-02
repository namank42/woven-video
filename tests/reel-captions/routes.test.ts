import { afterEach, describe, expect, it, vi } from "vitest";

const pricingRule = {
  id: "rule_1",
  provider: "elevenlabs",
  model: "scribe_v2",
  operation: "reel_captions",
  display_name: "Auto captions",
  markup_bps: 0,
  minimum_charge_usd_micros: 100_000,
  reserve_amount_usd_micros: 100_000,
  enabled: true,
  metadata: {},
};

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

describe("reel captions routes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/api/license");
    vi.doUnmock("@/lib/media/assets");
    vi.doUnmock("@/lib/media/env");
    vi.doUnmock("@/lib/media/tokens");
    vi.doUnmock("@/lib/reel-captions/elevenlabs");
    vi.doUnmock("@/lib/reel-captions/pricing");
    vi.doUnmock("@/lib/supabase/admin");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects invalid caption upload sizes before creating an asset", async () => {
    const createInputAssetUpload = vi.fn();
    const admin = mockCreateJobAdmin();

    mockCaptionRouteDependencies({ admin, createInputAssetUpload });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/route");
    const response = await POST(jsonRequest("/api/v1/reel-captions/jobs", {
      durationSeconds: 12,
      filename: "voice.wav",
      contentType: "audio/wav",
      sizeBytes: "not-a-number",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_media_input" },
    });
    expect(createInputAssetUpload).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("rejects missing caption upload sizes before creating a job or asset", async () => {
    const createInputAssetUpload = vi.fn();
    const admin = mockCreateJobAdmin();

    mockCaptionRouteDependencies({ admin, createInputAssetUpload });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/route");
    const response = await POST(jsonRequest("/api/v1/reel-captions/jobs", {
      durationSeconds: 12,
      filename: "voice.wav",
      contentType: "audio/wav",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_media_input" },
    });
    expect(createInputAssetUpload).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("creates caption jobs with Woven media upload URLs", async () => {
    const createInputAssetUpload = vi.fn(async () => ({
      asset: { id: ASSET_ID },
      uploadUrl: `https://media.example.test/uploads/${ASSET_ID}?token=upload-token`,
      expiresAt: "2026-07-01T12:15:00.000Z",
    }));
    const admin = mockCreateJobAdmin();

    mockCaptionRouteDependencies({ admin, createInputAssetUpload });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/route");
    const response = await POST(jsonRequest("/api/v1/reel-captions/jobs", {
      durationSeconds: 90,
      filename: "voice.m4a",
      contentType: "audio/mp4",
      sizeBytes: 123_456,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      id: JOB_ID,
      status: "queued",
      upload: {
        assetId: ASSET_ID,
        method: "PUT",
        url: `https://media.example.test/uploads/${ASSET_ID}?token=upload-token`,
        expiresAt: "2026-07-01T12:15:00.000Z",
        contentType: "audio/mp4",
      },
      estimatedCostUsdMicros: 150_000,
      pricing: {
        publicRateUsdPerMinute: 0.1,
        minimumUsdMicros: 100_000,
      },
    });

    expect(createInputAssetUpload).toHaveBeenCalledWith({
      userId: USER_ID,
      filename: "voice.m4a",
      contentType: "audio/mp4",
      sizeBytes: 123_456,
    });
    expect(admin.insertedJob).toMatchObject({
      input: {
        duration_seconds: 90,
        filename: "voice.m4a",
        content_type: "audio/mp4",
      },
    });
    expect(admin.updatedJobInput).toMatchObject({
      input: {
        duration_seconds: 90,
        filename: "voice.m4a",
        content_type: "audio/mp4",
        media_asset_id: ASSET_ID,
      },
    });
    expect(admin.storage.from).not.toHaveBeenCalled();
  });

  it("makes caption upload cleanup-claimable when attaching it to the job fails", async () => {
    const createInputAssetUpload = vi.fn(async () => ({
      asset: { id: ASSET_ID },
      uploadUrl: `https://media.example.test/uploads/${ASSET_ID}?token=upload-token`,
      expiresAt: "2026-07-01T12:15:00.000Z",
    }));
    const admin = mockCreateJobAdmin({
      jobUpdateError: { message: "job update failed" },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockCaptionRouteDependencies({ admin, createInputAssetUpload });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/route");
    const response = await POST(jsonRequest("/api/v1/reel-captions/jobs", {
      durationSeconds: 90,
      filename: "voice.m4a",
      contentType: "audio/mp4",
      sizeBytes: 123_456,
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "caption_job_update_failed" },
    });
    expect(admin.rpc).toHaveBeenCalledWith("release_balance_reservation", {
      p_job_id: JOB_ID,
      p_status: "failed",
      p_error: "caption_job_update_failed",
      p_metadata: { reason: "caption_job_update_failed" },
    });
    expect(admin.cleanupAssetUpdate).toMatchObject({
      status: "attached",
      job_id: JOB_ID,
      metadata: {
        deletion_reason: "caption_job_update_failed",
        caption_job_id: JOB_ID,
      },
    });
    expect(admin.cleanupAssetFilters).toEqual([["id", ASSET_ID]]);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to attach caption media asset to job",
      { message: "job update failed" },
    );
  });

  it("returns upload-not-ready when the caption media asset is not uploaded", async () => {
    const admin = mockProcessAdmin({
      asset: {
        id: ASSET_ID,
        user_id: USER_ID,
        kind: "input",
        status: "pending",
        content_type: "audio/wav",
        storage_key: `users/${USER_ID}/media/tmp/${ASSET_ID}/input.wav`,
      },
    });

    mockCaptionRouteDependencies({ admin });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "caption_upload_not_ready" },
    });
    expect(admin.claimUpdate).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("releases the reservation and skips media asset lookup for malformed caption media asset ids", async () => {
    const admin = mockProcessAdmin({
      asset: null,
      mediaAssetId: "not-a-uuid",
    });

    mockCaptionRouteDependencies({ admin });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "caption_job_invalid" },
    });
    expect(admin.rpc).toHaveBeenCalledWith("release_balance_reservation", {
      p_job_id: JOB_ID,
      p_status: "failed",
      p_error: "Caption job is missing upload metadata.",
      p_metadata: { reason: "Caption job is missing upload metadata." },
    });
    expect(admin.from).not.toHaveBeenCalledWith("media_assets");
  });

  it("rejects malformed caption job route ids before querying the database", async () => {
    const admin = mockProcessAdmin({ asset: null });

    mockCaptionRouteDependencies({ admin });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request("https://example.test/api/v1/reel-captions/jobs/not-a-uuid/process", {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_media_input" },
    });
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("logs caption process job lookup errors and returns a safe public error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = mockProcessAdmin({
      asset: null,
      jobLookupError: { message: "database failure with private details" },
    });

    mockCaptionRouteDependencies({ admin });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "caption_job_lookup_failed",
        message: "Unable to load caption job.",
      },
    });
    expect(admin.claimUpdate).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to load caption job for processing",
      expect.any(Error),
    );
  });

  it("logs caption input asset lookup errors and returns a safe public error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = mockProcessAdmin({
      asset: null,
      assetLookupError: { message: "asset query failed with private details" },
    });

    mockCaptionRouteDependencies({ admin });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "caption_asset_lookup_failed",
        message: "Unable to load caption upload.",
      },
    });
    expect(admin.claimUpdate).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to load caption input asset",
      expect.any(Error),
    );
  });

  it("returns a running conflict without transcription or usage insertion for already-running caption jobs", async () => {
    const transcribeWithElevenLabs = vi.fn(async () => ({
      text: "Hello",
      languageCode: "en",
      languageProbability: 0.98,
      captions: [{
        text: "Hello",
        startMs: 0,
        endMs: 400,
        timestampMs: 0,
        confidence: 0.99,
      }],
      raw: {},
    }));
    const admin = mockProcessAdmin({
      jobStatus: "running",
      asset: {
        id: ASSET_ID,
        user_id: USER_ID,
        kind: "input",
        status: "uploaded",
        content_type: "audio/wav",
        storage_key: `users/${USER_ID}/media/tmp/${ASSET_ID}/input.wav`,
      },
    });

    mockCaptionRouteDependencies({ admin, transcribeWithElevenLabs });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "caption_job_running" },
    });
    expect(transcribeWithElevenLabs).not.toHaveBeenCalled();
    expect(admin.usageInsert).not.toHaveBeenCalled();
  });

  it("does not continue processing when the queued-to-running claim updates no rows", async () => {
    const transcribeWithElevenLabs = vi.fn(async () => ({
      text: "Hello",
      languageCode: "en",
      languageProbability: 0.98,
      captions: [{
        text: "Hello",
        startMs: 0,
        endMs: 400,
        timestampMs: 0,
        confidence: 0.99,
      }],
      raw: {},
    }));
    const admin = mockProcessAdmin({
      claimResult: null,
      asset: {
        id: ASSET_ID,
        user_id: USER_ID,
        kind: "input",
        status: "uploaded",
        content_type: "audio/wav",
        storage_key: `users/${USER_ID}/media/tmp/${ASSET_ID}/input.wav`,
      },
    });

    mockCaptionRouteDependencies({ admin, transcribeWithElevenLabs });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "caption_job_running" },
    });
    expect(transcribeWithElevenLabs).not.toHaveBeenCalled();
    expect(admin.usageInsert).not.toHaveBeenCalled();
  });

  it("logs caption claim errors and returns a safe public error", async () => {
    const transcribeWithElevenLabs = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = mockProcessAdmin({
      claimError: { message: "claim failed with private details" },
      asset: {
        id: ASSET_ID,
        user_id: USER_ID,
        kind: "input",
        status: "uploaded",
        content_type: "audio/wav",
        storage_key: `users/${USER_ID}/media/tmp/${ASSET_ID}/input.wav`,
      },
    });

    mockCaptionRouteDependencies({ admin, transcribeWithElevenLabs });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "caption_job_claim_failed",
        message: "Unable to claim caption job.",
      },
    });
    expect(transcribeWithElevenLabs).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to claim caption job",
      expect.any(Error),
    );
  });

  it("transcribes caption jobs through a signed Woven media URL and leaves the input asset cleanup-claimable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const transcribeWithElevenLabs = vi.fn(async () => ({
      text: "Hello",
      languageCode: "en",
      languageProbability: 0.98,
      captions: [{
        text: "Hello",
        startMs: 0,
        endMs: 400,
        timestampMs: 0,
        confidence: 0.99,
      }],
      raw: {},
    }));
    const signMediaToken = vi.fn(async () => "download.token");
    const admin = mockProcessAdmin({
      asset: {
        id: ASSET_ID,
        user_id: USER_ID,
        kind: "input",
        status: "uploaded",
        content_type: "audio/wav",
        storage_key: `users/${USER_ID}/media/tmp/${ASSET_ID}/input.wav`,
      },
    });

    mockCaptionRouteDependencies({ admin, transcribeWithElevenLabs, signMediaToken });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: JOB_ID,
      status: "succeeded",
      text: "Hello",
      chargedAmountUsdMicros: 100_000,
    });
    expect(signMediaToken).toHaveBeenCalledWith({
      kind: "download",
      sub: USER_ID,
      key: `users/${USER_ID}/media/tmp/${ASSET_ID}/input.wav`,
      assetId: ASSET_ID,
      jobId: JOB_ID,
      exp: 1_782_907_800,
    }, "test-token-secret");
    expect(transcribeWithElevenLabs).toHaveBeenCalledWith({
      cloudStorageUrl: `https://media.example.test/objects/${ASSET_ID}?token=download.token`,
      signal: expect.any(AbortSignal),
    });
    expect(admin.rpc).toHaveBeenCalledWith("record_and_settle_reel_caption_job", {
      p_job_id: JOB_ID,
      p_final_cost_usd_micros: 100_000,
      p_output: expect.objectContaining({
        id: JOB_ID,
        status: "succeeded",
        text: "Hello",
        chargedAmountUsdMicros: 100_000,
      }),
      p_metadata: {
        duration_seconds: 12,
        raw_provider_cost: expect.any(Number),
        charged_amount_usd_micros: 100_000,
        caption_count: 1,
      },
      p_usage_event: {
        user_id: USER_ID,
        job_id: JOB_ID,
        provider: "elevenlabs",
        model: "scribe_v2",
        operation: "reel_captions",
        input_units: 12,
        output_units: 1,
        raw_provider_cost: expect.any(Number),
        charged_amount_usd_micros: 100_000,
        markup_amount_usd_micros: expect.any(Number),
        metadata: {
          duration_seconds: 12,
          language_code: "en",
          language_probability: 0.98,
          caption_count: 1,
        },
      },
    });
    expect(admin.cleanupAssetUpdate).toMatchObject({
      status: "attached",
      job_id: JOB_ID,
      metadata: {
        deletion_reason: "caption_job_succeeded",
        caption_job_id: JOB_ID,
      },
    });
    expect(admin.cleanupAssetFilters).toEqual([["id", ASSET_ID]]);
  });

  it("logs internal transcription errors and returns a safe public caption failure", async () => {
    const transcribeWithElevenLabs = vi.fn(async () => {
      throw new Error("provider failed for https://media.example.test/objects/token-secret");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = mockProcessAdmin({
      asset: {
        id: ASSET_ID,
        user_id: USER_ID,
        kind: "input",
        status: "uploaded",
        content_type: "audio/wav",
        storage_key: `users/${USER_ID}/media/tmp/${ASSET_ID}/input.wav`,
      },
    });

    mockCaptionRouteDependencies({ admin, transcribeWithElevenLabs });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "caption_generation_failed",
        message: "Caption generation failed. Try again later.",
      },
    });
    expect(admin.rpc).toHaveBeenCalledWith("release_balance_reservation", {
      p_job_id: JOB_ID,
      p_status: "failed",
      p_error: "caption_generation_failed",
      p_metadata: { reason: "caption_generation_failed" },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Caption generation failed",
      expect.objectContaining({ jobId: JOB_ID }),
      expect.any(Error),
    );
  });

  it("logs pricing lookup errors after claim and returns a safe public caption failure", async () => {
    const transcribeWithElevenLabs = vi.fn();
    const getReelCaptionPricing = vi.fn(async () => {
      throw new Error("database failure with private details");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = mockProcessAdmin({
      asset: {
        id: ASSET_ID,
        user_id: USER_ID,
        kind: "input",
        status: "uploaded",
        content_type: "audio/wav",
        storage_key: `users/${USER_ID}/media/tmp/${ASSET_ID}/input.wav`,
      },
    });

    mockCaptionRouteDependencies({
      admin,
      getReelCaptionPricing,
      transcribeWithElevenLabs,
    });

    const { POST } = await import("@/app/api/v1/reel-captions/jobs/[jobId]/process/route");
    const response = await POST(
      new Request(`https://example.test/api/v1/reel-captions/jobs/${JOB_ID}/process`, {
        method: "POST",
      }),
      { params: Promise.resolve({ jobId: JOB_ID }) },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "caption_generation_failed",
        message: "Caption generation failed. Try again later.",
      },
    });
    expect(admin.claimUpdate).toHaveBeenCalledTimes(1);
    expect(transcribeWithElevenLabs).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith("release_balance_reservation", {
      p_job_id: JOB_ID,
      p_status: "failed",
      p_error: "caption_generation_failed",
      p_metadata: { reason: "caption_generation_failed" },
    });
    expect(admin.cleanupAssetUpdate).toMatchObject({
      status: "attached",
      job_id: JOB_ID,
      metadata: expect.objectContaining({
        deletion_reason: "caption_job_failed",
        caption_job_id: JOB_ID,
      }),
    });
    expect(admin.cleanupAssetFilters).toEqual([["id", ASSET_ID]]);
    expect(consoleError).toHaveBeenCalledWith(
      "Caption generation failed",
      expect.objectContaining({ jobId: JOB_ID }),
      expect.any(Error),
    );
  });
});

function mockCaptionRouteDependencies({
  admin,
  createInputAssetUpload = vi.fn(),
  signMediaToken = vi.fn(async () => "download-token"),
  transcribeWithElevenLabs = vi.fn(),
  getReelCaptionPricing = vi.fn(async () => pricingRule),
}: {
  admin: unknown;
  createInputAssetUpload?: ReturnType<typeof vi.fn>;
  signMediaToken?: ReturnType<typeof vi.fn>;
  transcribeWithElevenLabs?: ReturnType<typeof vi.fn>;
  getReelCaptionPricing?: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("@/lib/api/auth", () => ({
    requireApiAuth: vi.fn(async () => ({
      ok: true,
      auth: { user: { id: USER_ID } },
    })),
  }));
  vi.doMock("@/lib/api/license", () => ({
    licenseGateResponse: vi.fn(async () => null),
  }));
  vi.doMock("@/lib/media/assets", () => ({
    createInputAssetUpload,
  }));
  vi.doMock("@/lib/media/env", () => ({
    getMediaEnv: vi.fn(() => ({
      baseUrl: "https://media.example.test",
      tokenSecret: "test-token-secret",
      workerSharedSecret: "worker-secret",
      maxUploadBytes: 1_000_000,
      uploadUrlTtlSeconds: 900,
      downloadUrlTtlSeconds: 600,
    })),
  }));
  vi.doMock("@/lib/media/tokens", () => ({
    signMediaToken,
  }));
  vi.doMock("@/lib/reel-captions/elevenlabs", () => ({
    transcribeWithElevenLabs,
  }));
  vi.doMock("@/lib/reel-captions/pricing", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/reel-captions/pricing")>()),
    getReelCaptionPricing,
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createSupabaseAdminClient: vi.fn(() => admin),
  }));
}

function mockCreateJobAdmin({
  jobUpdateError = null,
}: {
  jobUpdateError?: { message: string } | null;
} = {}) {
  const admin = {
    insertedJob: null as unknown,
    updatedJobInput: null as unknown,
    cleanupAssetUpdate: null as unknown,
    cleanupAssetFilters: [] as Array<[string, unknown]>,
    from: vi.fn((table: string) => {
      if (table === "media_assets") {
        return {
          update: vi.fn((values: unknown) => {
            admin.cleanupAssetUpdate = values;
            const chain = {
              eq: vi.fn(async (column: string, value: unknown) => {
                admin.cleanupAssetFilters.push([column, value]);
                return { data: null, error: null };
              }),
            };
            return chain;
          }),
        };
      }

      if (table !== "generation_jobs") {
        throw new Error(`Unexpected table ${table}`);
      }

      const eq = vi.fn(async () => ({ data: null, error: jobUpdateError }));
      return {
        insert: vi.fn((values: unknown) => {
          admin.insertedJob = values;
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: JOB_ID }, error: null })),
            })),
          };
        }),
        update: vi.fn((values: unknown) => {
          admin.updatedJobInput = values;
          return { eq };
        }),
      };
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: vi.fn(async () => ({
          data: { signedUrl: "https://supabase.test/upload", token: "token" },
          error: null,
        })),
      })),
    },
  };

  return admin;
}

function mockProcessAdmin({
  asset,
  jobStatus = "queued",
  mediaAssetId = ASSET_ID,
  claimResult = { id: JOB_ID },
  jobLookupError = null,
  assetLookupError = null,
  claimError = null,
}: {
  asset: Record<string, unknown> | null;
  jobStatus?: string;
  mediaAssetId?: unknown;
  claimResult?: { id: string } | null;
  jobLookupError?: { message: string } | null;
  assetLookupError?: { message: string } | null;
  claimError?: { message: string } | null;
}) {
  const generationJob = {
    id: JOB_ID,
    user_id: USER_ID,
    provider: "elevenlabs",
    model: "scribe_v2",
    status: jobStatus,
    input: {
      duration_seconds: 12,
      filename: "voice.wav",
      content_type: "audio/wav",
      media_asset_id: mediaAssetId,
    },
    output: null,
    reserved_amount_usd_micros: 100_000,
  };

  const admin = {
    cleanupAssetUpdate: null as unknown,
    cleanupAssetFilters: [] as Array<[string, unknown]>,
    claimUpdate: vi.fn(),
    usageInsert: vi.fn(),
    from: vi.fn((table: string) => {
      if (table === "generation_jobs") {
        return {
          select: vi.fn(() => {
            const chain = {
              eq: vi.fn(() => chain),
              maybeSingle: vi.fn(async () => ({
                data: jobLookupError ? null : generationJob,
                error: jobLookupError,
              })),
            };
            return chain;
          }),
          update: vi.fn((values: unknown) => {
            admin.claimUpdate(values);
            const chain = {
              eq: vi.fn(() => chain),
              in: vi.fn(async () => ({ data: claimResult, error: null })),
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: claimError ? null : claimResult,
                  error: claimError,
                })),
              })),
            };
            return chain;
          }),
        };
      }

      if (table === "media_assets") {
        return {
          select: vi.fn(() => {
            const chain = {
              eq: vi.fn(() => chain),
              maybeSingle: vi.fn(async () => ({
                data: assetLookupError ? null : asset,
                error: assetLookupError,
              })),
            };
            return chain;
          }),
          update: vi.fn((values: unknown) => {
            admin.cleanupAssetUpdate = values;
            return {
              eq: vi.fn(async (column: string, value: unknown) => {
                admin.cleanupAssetFilters.push([column, value]);
                return { data: null, error: null };
              }),
            };
          }),
        };
      }

      if (table === "usage_events") {
        return {
          insert: admin.usageInsert,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    storage: {
      from: vi.fn(() => ({
        exists: vi.fn(async () => ({ data: true, error: null })),
        createSignedUrl: vi.fn(async () => ({
          data: { signedUrl: "https://supabase.test/audio.wav" },
          error: null,
        })),
        remove: vi.fn(async () => ({ data: null, error: null })),
      })),
    },
  };

  return admin;
}

function jsonRequest(pathname: string, body: unknown): Request {
  return new Request(`https://example.test${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
