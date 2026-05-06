export type CaptionToken = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
};

export type ElevenLabsTranscription = {
  text: string;
  languageCode: string | null;
  languageProbability: number | null;
  captions: CaptionToken[];
  raw: unknown;
};

type TranscribeParams = {
  audio?: Blob;
  filename?: string;
  cloudStorageUrl?: string;
  signal?: AbortSignal;
};

const ELEVENLABS_SPEECH_TO_TEXT_URL =
  "https://api.elevenlabs.io/v1/speech-to-text";

export async function transcribeWithElevenLabs({
  audio,
  filename,
  cloudStorageUrl,
  signal,
}: TranscribeParams): Promise<ElevenLabsTranscription> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ElevenLabs Scribe is not configured on this Woven instance.");
  }

  const form = new FormData();
  form.append("model_id", "scribe_v2");
  if (cloudStorageUrl) {
    form.append("cloud_storage_url", cloudStorageUrl);
  } else if (audio) {
    form.append("file", audio, filename ?? "voiceover.wav");
  } else {
    throw new Error("Missing audio input for ElevenLabs Scribe.");
  }

  const response = await fetch(ELEVENLABS_SPEECH_TO_TEXT_URL, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: form,
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs transcription failed: ${response.status} ${response.statusText}${
        detail ? ` - ${detail.slice(0, 500)}` : ""
      }`,
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  return {
    text: typeof raw.text === "string" ? raw.text : "",
    languageCode:
      typeof raw.language_code === "string" ? raw.language_code : null,
    languageProbability: finiteNumber(raw.language_probability),
    captions: normalizeWords(raw.words),
    raw,
  };
}

function normalizeWords(words: unknown): CaptionToken[] {
  if (!Array.isArray(words)) return [];

  const captions: CaptionToken[] = [];
  for (const word of words) {
    if (!isObject(word)) continue;
    const type = typeof word.type === "string" ? word.type : "word";
    if (type !== "word") continue;

    const rawText = textValue(word.text ?? word.word).trim();
    const start = finiteNumber(word.start);
    const end = finiteNumber(word.end);
    if (!rawText || start === null || end === null || end <= start) continue;

    captions.push({
      text: captions.length === 0 ? rawText : leadingSpaceToken(rawText),
      startMs: Math.round(start * 1000),
      endMs: Math.round(end * 1000),
      timestampMs: Math.round(start * 1000),
      confidence: finiteNumber(word.confidence ?? word.logprob),
    });
  }

  return captions;
}

function leadingSpaceToken(text: string): string {
  return /^[,.;:!?)}\]]/.test(text) ? text : ` ${text}`;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
