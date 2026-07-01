import type { ModelPricingRule } from "@/lib/billing/model-pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  MEDIA_OPERATIONS,
  type MediaKind,
  type MediaModel,
  type MediaOperation,
  type MediaParameterSchema,
  type MediaProvider,
} from "@/lib/media/types";

const SELECT_COLUMNS =
  "id, provider, model, operation, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, metadata";

export async function listMediaModels(): Promise<MediaModel[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("model_pricing_rules")
    .select(SELECT_COLUMNS)
    .in("operation", [...MEDIA_OPERATIONS])
    .eq("enabled", true)
    .order("display_name");

  if (error) throw new Error(error.message);
  return (data ?? []).map((rule) => parseMediaModel(rule as ModelPricingRule)).filter(isMediaModel);
}

export async function getMediaModel(id: string): Promise<MediaModel | null> {
  const models = await listMediaModels();
  return models.find((model) => model.id === id) ?? null;
}

export function parseMediaModel(rule: ModelPricingRule): MediaModel | null {
  const metadata = rule.metadata ?? {};
  const publicId = stringValue(metadata.public_id);
  const providerEndpoint = stringValue(metadata.provider_endpoint);
  const kind = mediaKind(metadata.kind);
  const provider = mediaProvider(rule.provider);
  const operation = mediaOperation(rule.operation);
  const parameterSchema = schemaValue(metadata.parameter_schema);

  if (!publicId || !providerEndpoint || !kind || !provider || !operation || !parameterSchema) {
    return null;
  }

  return {
    id: publicId,
    provider,
    providerModel: rule.model,
    providerEndpoint,
    operation,
    kind,
    displayName: rule.display_name,
    supportsUploadedInputs: Boolean(metadata.supports_uploaded_inputs),
    supportedInputTypes: stringArray(metadata.supported_input_types),
    outputTypes: stringArray(metadata.output_types),
    defaultParameters: objectValue(metadata.default_parameters),
    parameterSchema,
    pricing: {
      unit: pricingUnit(metadata.pricing_unit),
      minimumUsdMicros: Number(rule.minimum_charge_usd_micros),
      reserveUsdMicros: Number(rule.reserve_amount_usd_micros),
      markupBps: Number(rule.markup_bps),
    },
    metadata,
    rule,
  };
}

function isMediaModel(model: MediaModel | null): model is MediaModel {
  return model !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function schemaValue(value: unknown): MediaParameterSchema | null {
  const object = objectValue(value);
  return object.type === "object" ? object as MediaParameterSchema : { type: "object", properties: {} };
}

function mediaProvider(value: string): MediaProvider | null {
  return value === "fal" || value === "elevenlabs" ? value : null;
}

function mediaOperation(value: string): MediaOperation | null {
  return (MEDIA_OPERATIONS as readonly string[]).includes(value) ? value as MediaOperation : null;
}

function mediaKind(value: unknown): MediaKind | null {
  return value === "image" || value === "video" || value === "audio" || value === "captions" ? value : null;
}

function pricingUnit(value: unknown): "job" | "second" | "minute" {
  return value === "second" || value === "minute" ? value : "job";
}
