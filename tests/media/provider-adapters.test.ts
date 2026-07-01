import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaModel } from "@/lib/media/types";

const mocks = vi.hoisted(() => ({
  falSubmit: vi.fn(),
  falStatus: vi.fn(),
  falResult: vi.fn(),
  ElevenLabsClient: vi.fn(),
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

describe("falMediaAdapter", () => {
  beforeEach(() => {
    mocks.falSubmit.mockReset();
    mocks.falStatus.mockReset();
    mocks.falResult.mockReset();
  });

  it("extracts nested output urls with inferred media type and content type", async () => {
    const { extractFalOutputs } = await import("@/lib/media/providers/fal");

    expect(extractFalOutputs({
      preview: { url: "https://cdn.example.com/preview.png" },
      result: {
        files: [
          { url: "https://cdn.example.com/final.webm", content_type: "video/webm" },
          { url: "data:video/mp4;base64,ignored" },
        ],
      },
    }, ["video"])).toEqual([
      {
        url: "https://cdn.example.com/preview.png",
        type: "video",
        contentType: "video/mp4",
      },
      {
        url: "https://cdn.example.com/final.webm",
        type: "video",
        contentType: "video/webm",
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

  it("polls an existing Fal job and returns outputs when completed", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    mocks.falStatus.mockResolvedValue({ status: "COMPLETED", request_id: "fal_req_1" });
    mocks.falResult.mockResolvedValue({
      data: { video: { url: "https://cdn.example.com/output.mp4" } },
    });

    await expect(falMediaAdapter.run({
      model: mediaModel({
        metadata: { provider_cost_usd: "0.42" },
        outputTypes: ["video"],
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

  it("streams text-to-speech bytes into an audio data url", async () => {
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
          url: "data:audio/mpeg;base64,AQIDBA==",
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
