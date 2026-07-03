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

export type MediaParameterPrimitiveType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export type MediaParameterConstraint =
  | { type: "exactly_one"; fields: string[]; message?: string }
  | { type: "at_least_one"; fields: string[]; message?: string };

export type MediaParameterPropertySchema = {
  type?: MediaParameterPrimitiveType | MediaParameterPrimitiveType[];
  enum?: Array<string | number | boolean | null>;
  required?: string[];
  properties?: Record<string, MediaParameterPropertySchema>;
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: MediaParameterPropertySchema;
  anyOf?: MediaParameterPropertySchema[];
  oneOf?: MediaParameterPropertySchema[];
  default?: unknown;
  description?: string;
};

export type MediaParameterSchema = MediaParameterPropertySchema & {
  type: "object";
  required?: string[];
  properties?: Record<string, MediaParameterPropertySchema>;
  constraints?: MediaParameterConstraint[];
};

export type MediaInputAssetRole = {
  role: string;
  providerField: string;
  mediaKind: "image" | "video" | "audio";
  required: boolean;
  min: number;
  max: number;
  contentTypePrefixes: string[];
};

export type MediaInputAssetConstraint =
  | { type: "at_least_one_role"; roles: string[]; message?: string }
  | { type: "requires_any_role_when_role_present"; role: string; roles: string[]; message?: string };

export type MediaInputAssetSchema = {
  roles: MediaInputAssetRole[];
  constraints?: MediaInputAssetConstraint[];
};

export type MediaPricingFormula = {
  type:
    | "static"
    | "flat_generation"
    | "nano_banana"
    | "gemini_unit"
    | "veo_seconds"
    | "seedance_seconds"
    | "kling_seconds"
    | "music_minutes"
    | "gpt_image_conservative";
  [key: string]: unknown;
};

export type MediaPricingQuote = {
  estimateKind: "static" | "parameter_quote" | "conservative_quote";
  providerCostUsdMicros: number;
  chargedAmountUsdMicros: number;
  reservedAmountUsdMicros: number;
  markupAmountUsdMicros: number;
  formula: string;
  inputs: Record<string, unknown>;
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
  inputAssetSchema: MediaInputAssetSchema;
  pricingFormula: MediaPricingFormula;
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
