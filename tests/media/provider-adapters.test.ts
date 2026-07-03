import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaModel } from "@/lib/media/types";

const mocks = vi.hoisted(() => ({
  falSubmit: vi.fn(),
  falStatus: vi.fn(),
  falResult: vi.fn(),
  ElevenLabsClient: vi.fn(),
  getMediaEnv: vi.fn(),
}));

vi.mock("@fal-ai/client", () => ({
  fal: {
    queue: {
      submit: mocks.falSubmit,
      status: mocks.falStatus,
      result: mocks.falResult,
    },
  },
}));

vi.mock("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: mocks.ElevenLabsClient,
}));

vi.mock("@/lib/media/env", () => ({
  getMediaEnv: mocks.getMediaEnv,
}));

describe("falMediaAdapter", () => {
  beforeEach(() => {
    mocks.falSubmit.mockReset();
    mocks.falStatus.mockReset();
    mocks.falResult.mockReset();
    mocks.getMediaEnv.mockReset();
    mocks.getMediaEnv.mockReturnValue({ falWebhookBaseUrl: null });
  });

  it("extracts output urls only from declared Fal result paths when selectors are provided", async () => {
    const { extractFalOutputs } = await import("@/lib/media/providers/fal");

    expect(extractFalOutputs({
      preview: { url: "https://cdn.example.com/preview.png" },
      echoed_input: { url: "https://media.example.test/objects/input_1?token=secret" },
      result: {
        files: [
          { url: "https://cdn.example.com/final.webm", content_type: "video/webm" },
          { url: "data:video/mp4;base64,ignored" },
        ],
      },
    }, ["video"], {
      outputPaths: [{ path: "result.files", type: "video" }],
    })).toEqual([
      {
        url: "https://cdn.example.com/final.webm",
        type: "video",
        contentType: "video/webm",
      },
    ]);
  });

  it("does not use generic recursive Fal URL extraction unless metadata opts in", async () => {
    const { extractFalOutputs } = await import("@/lib/media/providers/fal");
    const payload = {
      preview: { url: "https://cdn.example.com/preview.png" },
      result: { video: { url: "https://cdn.example.com/final.mp4" } },
    };

    expect(extractFalOutputs(payload, ["video"])).toEqual([]);
    expect(extractFalOutputs(payload, ["video"], { allowGenericUrlFallback: true })).toEqual([
      {
        url: "https://cdn.example.com/preview.png",
        type: "video",
        contentType: "video/mp4",
      },
      {
        url: "https://cdn.example.com/final.mp4",
        type: "video",
        contentType: "video/mp4",
      },
    ]);
  });

  it("falls back to generic Fal URL extraction when declared paths produce no outputs and fallback is enabled", async () => {
    const { extractFalOutputs } = await import("@/lib/media/providers/fal");

    expect(extractFalOutputs({
      preview: { url: "https://cdn.example.com/preview.png" },
      result: { files: [] },
    }, ["video"], {
      outputPaths: [{ path: "result.files", type: "video" }],
      allowGenericUrlFallback: true,
    })).toEqual([
      {
        url: "https://cdn.example.com/preview.png",
        type: "video",
        contentType: "video/mp4",
      },
    ]);
  });

  it("submits a queued job with merged parameters and input urls", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    const abortController = new AbortController();
    mocks.falSubmit.mockResolvedValue({ request_id: "fal_req_1" });

    await expect(falMediaAdapter.run({
      model: mediaModel({
        defaultParameters: { guidance_scale: 3, safety_checker: true },
        parameterSchema: {
          type: "object",
          required: ["prompt"],
          properties: { prompt: { type: "string" }, guidance_scale: { type: "number" } },
        },
      }),
      parameters: { prompt: "a mountain", guidance_scale: 5 },
      inputUrls: ["https://media.example.com/input.png"],
      signal: abortController.signal,
    })).resolves.toEqual({
      status: "waiting_provider",
      providerJobId: "fal_req_1",
      metadata: {
        endpoint: "fal-ai/frontier-video",
        fal_request_id: "fal_req_1",
      },
    });

    expect(mocks.falSubmit).toHaveBeenCalledWith("fal-ai/frontier-video", {
      input: {
        guidance_scale: 5,
        safety_checker: true,
        prompt: "a mountain",
        input_urls: ["https://media.example.com/input.png"],
      },
      abortSignal: abortController.signal,
    });
  });

  it("passes the Fal webhook URL when configured", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    mocks.getMediaEnv.mockReturnValue({
      falWebhookBaseUrl: "https://www.woven.video",
    });
    mocks.falSubmit.mockResolvedValue({ request_id: "fal_req_webhook" });

    await falMediaAdapter.run({
      model: mediaModel({
        parameterSchema: {
          type: "object",
          properties: { prompt: { type: "string" } },
        },
      }),
      parameters: { prompt: "a mountain" },
      inputUrls: [],
    });

    expect(mocks.falSubmit).toHaveBeenCalledWith("fal-ai/frontier-video", {
      input: { prompt: "a mountain" },
      webhookUrl: "https://www.woven.video/api/v1/media/webhooks/fal",
      abortSignal: undefined,
    });
  });

  it("maps role-aware input assets to Fal provider fields", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    mocks.falSubmit.mockResolvedValue({ request_id: "fal_req_roles" });

    await falMediaAdapter.run({
      model: mediaModel({
        inputAssetSchema: {
          roles: [
            { role: "first_frame", providerField: "first_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
            { role: "last_frame", providerField: "last_frame_url", mediaKind: "image", required: true, min: 1, max: 1, contentTypePrefixes: ["image/"] },
          ],
        },
        parameterSchema: {
          type: "object",
          properties: { prompt: { type: "string" } },
        },
      }),
      parameters: { prompt: "product reveal" },
      inputUrls: [],
      inputAssets: [
        { assetId: "asset_first", role: "first_frame", url: "https://media.example/first.png", contentType: "image/png" },
        { assetId: "asset_last", role: "last_frame", url: "https://media.example/last.png", contentType: "image/png" },
      ],
    });

    expect(mocks.falSubmit).toHaveBeenCalledWith("fal-ai/frontier-video", {
      input: {
        prompt: "product reveal",
        first_frame_url: "https://media.example/first.png",
        last_frame_url: "https://media.example/last.png",
      },
      abortSignal: undefined,
    });
  });

  it("drops parameters not declared in the model schema", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    mocks.falSubmit.mockResolvedValue({ request_id: "fal_req_2" });

    await falMediaAdapter.run({
      model: mediaModel({
        defaultParameters: { num_images: 1 },
        parameterSchema: {
          type: "object",
          required: ["prompt"],
          properties: { prompt: { type: "string" } },
        },
      }),
      parameters: { prompt: "a mountain", num_images: 10, resolution: "4k" },
      inputUrls: [],
    });

    expect(mocks.falSubmit).toHaveBeenCalledWith("fal-ai/frontier-video", {
      input: { num_images: 1, prompt: "a mountain" },
      abortSignal: undefined,
    });
  });

  it("polls an existing Fal job and returns outputs when completed", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    mocks.falStatus.mockResolvedValue({ status: "COMPLETED", request_id: "fal_req_1" });
    mocks.falResult.mockResolvedValue({
      data: { video: { url: "https://cdn.example.com/output.mp4" } },
    });

    await expect(falMediaAdapter.run({
      model: mediaModel({
        outputTypes: ["video"],
        metadata: {
          provider_cost_usd: "0.42",
          fal_output_paths: [{ path: "video", type: "video" }],
        },
      }),
      parameters: { prompt: "a mountain" },
      inputUrls: [],
      providerJobId: "fal_req_1",
    })).resolves.toEqual({
      status: "succeeded",
      outputs: [
        {
          url: "https://cdn.example.com/output.mp4",
          type: "video",
          contentType: "video/mp4",
        },
      ],
      rawCostUsd: 0.42,
      metadata: {
        endpoint: "fal-ai/frontier-video",
        fal_request_id: "fal_req_1",
        fal_status: "COMPLETED",
      },
    });

    expect(mocks.falStatus).toHaveBeenCalledWith("fal-ai/frontier-video", {
      requestId: "fal_req_1",
      logs: true,
      abortSignal: undefined,
    });
    expect(mocks.falResult).toHaveBeenCalledWith("fal-ai/frontier-video", {
      requestId: "fal_req_1",
      abortSignal: undefined,
    });
  });

  it("keeps polling an existing Fal job while it is still in progress", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    mocks.falStatus.mockResolvedValue({ status: "IN_PROGRESS", request_id: "fal_req_1" });

    await expect(falMediaAdapter.run({
      model: mediaModel(),
      parameters: { prompt: "a mountain" },
      inputUrls: [],
      providerJobId: "fal_req_1",
    })).resolves.toEqual({
      status: "waiting_provider",
      providerJobId: "fal_req_1",
      metadata: {
        endpoint: "fal-ai/frontier-video",
        fal_request_id: "fal_req_1",
        fal_status: "IN_PROGRESS",
      },
    });

    expect(mocks.falResult).not.toHaveBeenCalled();
  });

  it("rejects a completed Fal job when no output urls can be extracted", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    mocks.falStatus.mockResolvedValue({ status: "COMPLETED", request_id: "fal_req_1" });
    mocks.falResult.mockResolvedValue({
      data: { images: [], note: "provider returned no files" },
    });

    await expect(falMediaAdapter.run({
      model: mediaModel({ outputTypes: ["image"] }),
      parameters: { prompt: "a mountain" },
      inputUrls: [],
      providerJobId: "fal_req_1",
    })).rejects.toThrow("provider_no_outputs");
  });
});

describe("elevenLabsMediaAdapter", () => {
  const originalApiKey = process.env.ELEVENLABS_API_KEY;

  beforeEach(() => {
    mocks.ElevenLabsClient.mockReset();
    if (originalApiKey === undefined) {
      delete process.env.ELEVENLABS_API_KEY;
    } else {
      process.env.ELEVENLABS_API_KEY = originalApiKey;
    }
  });

  it("throws provider_not_configured when the API key is missing", async () => {
    const { elevenLabsMediaAdapter } = await import("@/lib/media/providers/elevenlabs");
    delete process.env.ELEVENLABS_API_KEY;

    await expect(elevenLabsMediaAdapter.run({
      model: mediaModel({
        provider: "elevenlabs",
        operation: "text_to_speech",
        metadata: { voice_id: "voice_1" },
      }),
      parameters: { text: "Hello" },
      inputUrls: [],
    })).rejects.toThrow("provider_not_configured");
    expect(mocks.ElevenLabsClient).not.toHaveBeenCalled();
  });

  it("streams text-to-speech bytes as inline audio data without a data url", async () => {
    const { elevenLabsMediaAdapter } = await import("@/lib/media/providers/elevenlabs");
    process.env.ELEVENLABS_API_KEY = "eleven_key";
    const stream = vi.fn(async () => streamFrom([1, 2, 3, 4]));
    mocks.ElevenLabsClient.mockImplementation(function MockElevenLabsClient() {
      return {
        textToSpeech: { stream },
      };
    });
    const abortController = new AbortController();

    await expect(elevenLabsMediaAdapter.run({
      model: mediaModel({
        provider: "elevenlabs",
        providerModel: "eleven_multilingual_v2",
        operation: "text_to_speech",
        outputTypes: ["audio"],
        metadata: { voice_id: "voice_1", provider_cost_usd: 0.08 },
      }),
      parameters: { text: "Hello", output_format: "mp3_44100_128" },
      inputUrls: [],
      signal: abortController.signal,
    })).resolves.toEqual({
      status: "succeeded",
      outputs: [
        {
          data: Buffer.from([1, 2, 3, 4]),
          type: "audio",
          contentType: "audio/mpeg",
        },
      ],
      rawCostUsd: 0.08,
      metadata: {
        endpoint: "text-to-speech",
        output_format: "mp3_44100_128",
        byte_length: 4,
      },
    });

    expect(mocks.ElevenLabsClient).toHaveBeenCalledWith({ apiKey: "eleven_key" });
    expect(stream).toHaveBeenCalledWith("voice_1", {
      text: "Hello",
      modelId: "eleven_multilingual_v2",
      outputFormat: "mp3_44100_128",
    }, {
      abortSignal: abortController.signal,
    });
  });

  it("maps sound effect parameters through the ElevenLabs SDK client", async () => {
    const { elevenLabsMediaAdapter } = await import("@/lib/media/providers/elevenlabs");
    process.env.ELEVENLABS_API_KEY = "eleven_key";
    const convert = vi.fn(async () => streamFrom([5, 6]));
    mocks.ElevenLabsClient.mockImplementation(function MockElevenLabsClient() {
      return {
        textToSoundEffects: { convert },
      };
    });
    const abortController = new AbortController();

    await expect(elevenLabsMediaAdapter.run({
      model: mediaModel({
        provider: "elevenlabs",
        providerModel: "eleven_text_to_sound_v2",
        operation: "sound_effects",
        outputTypes: ["audio"],
      }),
      parameters: {
        text: "cinematic hit",
        duration_seconds: 1.5,
        prompt_influence: 0.7,
        loop: true,
        output_format: "mp3_44100_128",
      },
      inputUrls: [],
      signal: abortController.signal,
    })).resolves.toMatchObject({
      status: "succeeded",
      outputs: [{ data: Buffer.from([5, 6]), type: "audio", contentType: "audio/mpeg" }],
      metadata: {
        endpoint: "sound-generation",
        output_format: "mp3_44100_128",
        byte_length: 2,
      },
    });

    expect(convert).toHaveBeenCalledWith({
      text: "cinematic hit",
      modelId: "eleven_text_to_sound_v2",
      outputFormat: "mp3_44100_128",
      durationSeconds: 1.5,
      promptInfluence: 0.7,
      loop: true,
    }, {
      abortSignal: abortController.signal,
    });
  });

  it("maps music parameters through the ElevenLabs SDK client", async () => {
    const { elevenLabsMediaAdapter } = await import("@/lib/media/providers/elevenlabs");
    process.env.ELEVENLABS_API_KEY = "eleven_key";
    const compose = vi.fn(async () => streamFrom([7, 8, 9]));
    mocks.ElevenLabsClient.mockImplementation(function MockElevenLabsClient() {
      return {
        music: { compose },
      };
    });

    await expect(elevenLabsMediaAdapter.run({
      model: mediaModel({
        provider: "elevenlabs",
        providerModel: "music_v2",
        operation: "music_generation",
        outputTypes: ["audio"],
      }),
      parameters: {
        prompt: "ambient synth bed",
        music_length_ms: 30_000,
        seed: 42,
        force_instrumental: true,
      },
      inputUrls: [],
    })).resolves.toMatchObject({
      status: "succeeded",
      outputs: [{ data: Buffer.from([7, 8, 9]), type: "audio", contentType: "audio/mpeg" }],
      metadata: {
        endpoint: "music",
        output_format: "mp3_44100_128",
        byte_length: 3,
      },
    });

    expect(compose).toHaveBeenCalledWith({
      prompt: "ambient synth bed",
      modelId: "music_v2",
      outputFormat: "mp3_44100_128",
      musicLengthMs: 30_000,
      seed: 42,
      forceInstrumental: true,
    }, {
      abortSignal: undefined,
    });
  });
});

function mediaModel(overrides: Partial<MediaModel> = {}): MediaModel {
  return {
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
    ...overrides,
  } as MediaModel;
}

function streamFrom(bytes: number[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
}
