import type { ModelPricingRule } from "@/lib/billing/model-pricing";

export const MEDIA_OPERATIONS = [
  "image_generation",
  "video_generation",
  "text_to_speech",
  "sound_effects",
  "music_generation",
  "reel_captions",
] as const;

export type MediaOperation = (typeof MEDIA_OPERATIONS)[number];
export type MediaKind = "image" | "video" | "audio" | "captions";
export type MediaProvider = "fal" | "elevenlabs";

export type MediaParameterSchema = {
  type: "object";
  required?: string[];
  properties?: Record<string, { type: "string" | "number" | "boolean" | "object" | "array" }>;
};

export type MediaModel = {
  id: string;
  provider: MediaProvider;
  providerModel: string;
  providerEndpoint: string;
  operation: MediaOperation;
  kind: MediaKind;
  displayName: string;
  supportsUploadedInputs: boolean;
  supportedInputTypes: string[];
  outputTypes: string[];
  defaultParameters: Record<string, unknown>;
  parameterSchema: MediaParameterSchema;
  pricing: {
    unit: "job" | "second" | "minute";
    minimumUsdMicros: number;
    reserveUsdMicros: number;
    markupBps: number;
  };
  metadata: Record<string, unknown>;
  rule: ModelPricingRule;
};
