import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type { MediaProviderAdapter, ProviderRunResult } from "@/lib/media/provider";

type ElevenLabsClientInstance = InstanceType<typeof ElevenLabsClient>;
type TextToSpeechRequest = Parameters<ElevenLabsClientInstance["textToSpeech"]["stream"]>[1];
type SoundEffectRequest = Parameters<ElevenLabsClientInstance["textToSoundEffects"]["convert"]>[0];
type MusicRequest = NonNullable<Parameters<ElevenLabsClientInstance["music"]["compose"]>[0]>;
type ElevenLabsRequestOptions = { abortSignal?: AbortSignal };
type AudioStream = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | ArrayBuffer | Uint8Array | Buffer;

const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

export const elevenLabsMediaAdapter: MediaProviderAdapter = {
  async run({ model, parameters, signal }) {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("provider_not_configured");
    }

    const client = new ElevenLabsClient({ apiKey });

    if (model.operation === "text_to_speech") {
      return runTextToSpeech({ client, model, parameters, signal });
    }

    if (model.operation === "sound_effects") {
      return runSoundEffects({ client, model, parameters, signal });
    }

    if (model.operation === "music_generation") {
      return runMusic({ client, model, parameters, signal });
    }

    throw new Error(`Unsupported ElevenLabs operation: ${model.operation}`);
  },
};

async function runTextToSpeech({
  client,
  model,
  parameters,
  signal,
}: {
  client: ElevenLabsClientInstance;
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
  parameters: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<ProviderRunResult> {
  const voiceId = stringValue(parameters.voice_id) ?? stringValue(model.metadata.voice_id);
  const text = stringValue(parameters.text);
  const modelId = stringValue(parameters.model_id) ?? model.providerModel;
  const outputFormat = stringValue(parameters.output_format) ?? DEFAULT_OUTPUT_FORMAT;
  if (!voiceId || !text) {
    throw new Error("invalid_media_input");
  }

  const audio = await client.textToSpeech.stream(voiceId, {
    text,
    modelId,
    outputFormat: outputFormat as TextToSpeechRequest["outputFormat"],
  } satisfies TextToSpeechRequest, requestOptions(signal));
  const bytes = await collectAudioBytes(audio);

  return audioResult(bytes, model, {
    endpoint: "text-to-speech",
    output_format: outputFormat,
  });
}

async function runSoundEffects({
  client,
  model,
  parameters,
  signal,
}: {
  client: ElevenLabsClientInstance;
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
  parameters: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<ProviderRunResult> {
  const text = stringValue(parameters.text);
  const outputFormat = stringValue(parameters.output_format) ?? DEFAULT_OUTPUT_FORMAT;
  if (!text) {
    throw new Error("invalid_media_input");
  }

  const audio = await client.textToSoundEffects.convert(definedValues({
    text,
    modelId: stringValue(parameters.model_id) ?? model.providerModel,
    outputFormat: outputFormat as SoundEffectRequest["outputFormat"],
    durationSeconds: numberValue(parameters.duration_seconds),
    promptInfluence: numberValue(parameters.prompt_influence),
    loop: booleanValue(parameters.loop),
  } satisfies SoundEffectRequest), requestOptions(signal));
  const bytes = await collectAudioBytes(audio);

  return audioResult(bytes, model, {
    endpoint: "sound-generation",
    output_format: outputFormat,
  });
}

async function runMusic({
  client,
  model,
  parameters,
  signal,
}: {
  client: ElevenLabsClientInstance;
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
  parameters: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<ProviderRunResult> {
  const providerParameters = {
    ...model.defaultParameters,
    ...parameters,
  };
  const prompt = stringValue(providerParameters.prompt);
  const compositionPlan =
    objectValue(providerParameters.compositionPlan) ?? objectValue(providerParameters.composition_plan);
  const outputFormat =
    stringValue(providerParameters.outputFormat) ??
    stringValue(providerParameters.output_format) ??
    DEFAULT_OUTPUT_FORMAT;
  if (!prompt && !compositionPlan) {
    throw new Error("invalid_media_input");
  }

  const audio = await client.music.compose(definedValues({
    prompt: prompt ?? undefined,
    compositionPlan: compositionPlan as MusicRequest["compositionPlan"],
    musicLengthMs: numberValue(providerParameters.musicLengthMs) ?? numberValue(providerParameters.music_length_ms),
    modelId: (stringValue(providerParameters.modelId) ?? stringValue(providerParameters.model_id) ?? model.providerModel) as MusicRequest["modelId"],
    outputFormat: outputFormat as MusicRequest["outputFormat"],
    seed: numberValue(providerParameters.seed),
    forceInstrumental: booleanValue(providerParameters.forceInstrumental) ?? booleanValue(providerParameters.force_instrumental),
    respectSectionsDurations: booleanValue(providerParameters.respectSectionsDurations),
    storeForInpainting: booleanValue(providerParameters.storeForInpainting),
    signWithC2Pa: booleanValue(providerParameters.signWithC2Pa),
  } satisfies MusicRequest), requestOptions(signal));
  const bytes = await collectAudioBytes(audio);

  return audioResult(bytes, model, {
    endpoint: "music",
    output_format: outputFormat,
  });
}

function audioResult(
  bytes: Buffer,
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"],
  metadata: Record<string, unknown>,
): ProviderRunResult {
  const outputFormat = stringValue(metadata.output_format) ?? DEFAULT_OUTPUT_FORMAT;
  const contentType = audioContentType(outputFormat);

  return {
    status: "succeeded",
    outputs: [{
      data: bytes,
      type: "audio",
      contentType,
    }],
    rawCostUsd: providerCostUsd(model.metadata),
    metadata: {
      ...metadata,
      byte_length: bytes.byteLength,
    },
  };
}

export function audioBytesToDataUrl(bytes: Buffer, contentType = "audio/mpeg") {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

export async function collectAudioBytes(audio: AudioStream): Promise<Buffer> {
  if (Buffer.isBuffer(audio)) {
    return audio;
  }

  if (audio instanceof Uint8Array) {
    return Buffer.from(audio);
  }

  if (audio instanceof ArrayBuffer) {
    return Buffer.from(audio);
  }

  if (isReadableStream(audio)) {
    const reader = audio.getReader();
    const chunks: Buffer[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of audio) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function requestOptions(signal?: AbortSignal): ElevenLabsRequestOptions {
  return signal ? { abortSignal: signal } : { abortSignal: undefined };
}

function providerCostUsd(metadata: Record<string, unknown>) {
  const cost = Number(metadata.provider_cost_usd ?? 0);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

function audioContentType(outputFormat: string) {
  if (/^wav/i.test(outputFormat)) return "audio/wav";
  if (/^pcm/i.test(outputFormat)) return "audio/wav";
  if (/^(ulaw|alaw)/i.test(outputFormat)) return "audio/basic";
  return "audio/mpeg";
}

function definedValues<T extends Record<string, unknown>>(object: T) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as T;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return isRecord(value) && typeof value.getReader === "function";
}
