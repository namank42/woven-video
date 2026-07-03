import type { ModelPricingRule } from "@/lib/billing/model-pricing";
import {
  MEDIA_OPERATIONS,
  type MediaInputAssetConstraint,
  type MediaInputAssetSchema,
  type MediaKind,
  type MediaModel,
  type MediaOperation,
  type MediaParameterPropertySchema,
  type MediaParameterPrimitiveType,
  type MediaParameterSchema,
  type MediaProvider,
  type MediaPricingFormula,
} from "@/lib/media/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SELECT_COLUMNS =
  "id, provider, model, operation, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, metadata";
const PARAMETER_TYPES = ["string", "number", "integer", "boolean", "object", "array", "null"] as const;
const PRICING_FORMULA_TYPES = [
  "static",
  "flat_generation",
  "nano_banana",
  "gemini_unit",
  "veo_seconds",
  "seedance_seconds",
  "kling_seconds",
  "music_minutes",
  "gpt_image_conservative",
] as const;

export type MediaModelFilters = {
  kind?: MediaKind;
  operation?: MediaOperation;
};

export async function listMediaModels(filters: MediaModelFilters = {}): Promise<MediaModel[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("model_pricing_rules")
    .select(SELECT_COLUMNS)
    .in("operation", [...MEDIA_OPERATIONS])
    .eq("enabled", true)
    .order("display_name");

  if (filters.operation) {
    query = query.eq("operation", filters.operation);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((rule) => parseMediaModel(rule as ModelPricingRule))
    .filter(isMediaModel)
    .filter((model) => !filters.kind || model.kind === filters.kind);
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
  const parameterSchema = parameterSchemaValue(metadata.parameter_schema);
  const inputAssetSchema = inputAssetSchemaValue(metadata.input_asset_schema);
  const pricingFormula = pricingFormulaValue(metadata.pricing_formula);

  if (
    !publicId ||
    !providerEndpoint ||
    !kind ||
    !provider ||
    !operation ||
    !parameterSchema ||
    !inputAssetSchema ||
    !pricingFormula
  ) {
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
    supportsUploadedInputs: metadata.supports_uploaded_inputs === true,
    supportedInputTypes: stringArray(metadata.supported_input_types),
    outputTypes: stringArray(metadata.output_types),
    defaultParameters: objectValue(metadata.default_parameters),
    inputAssetSchema,
    pricingFormula,
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

function inputAssetSchemaValue(value: unknown): MediaInputAssetSchema | null {
  if (value === undefined) {
    return { roles: [] };
  }

  if (!isRecord(value)) {
    return null;
  }

  if (value.roles === undefined) {
    return { roles: [] };
  }

  if (!Array.isArray(value.roles)) {
    return null;
  }

  const roles = value.roles.map((role) => {
    if (!isRecord(role)) return null;

    const roleName = stringValue(role.role);
    const providerField = stringValue(role.provider_field);
    const mediaKind = inputMediaKind(role.media_kind);
    const required = typeof role.required === "boolean" ? role.required : null;
    const min = countValue(role.min);
    const max = countValue(role.max);

    if (
      !roleName ||
      !providerField ||
      !mediaKind ||
      required === null ||
      min === null ||
      max === null ||
      max < min ||
      !Array.isArray(role.content_type_prefixes)
    ) {
      return null;
    }

    const contentTypePrefixes = role.content_type_prefixes.map((prefix) =>
      typeof prefix === "string" && prefix.trim() ? prefix : null
    );

    if (contentTypePrefixes.some((prefix) => prefix === null)) {
      return null;
    }

    return {
      role: roleName,
      providerField,
      mediaKind,
      required,
      min,
      max,
      contentTypePrefixes: contentTypePrefixes as string[],
    };
  });

  if (!roles.every((role) => role !== null)) {
    return null;
  }

  const constraints = value.constraints === undefined ? undefined : inputAssetConstraintsValue(value.constraints);
  if (value.constraints !== undefined && !constraints) {
    return null;
  }

  return constraints ? { roles, constraints } : { roles };
}

function inputAssetConstraintsValue(value: unknown): MediaInputAssetConstraint[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const constraints: MediaInputAssetConstraint[] = [];
  for (const constraint of value) {
    if (!isRecord(constraint)) {
      return null;
    }

    if (constraint.type === "at_least_one_role") {
      if (!isStringArray(constraint.roles) || constraint.roles.length === 0) {
        return null;
      }
      if (constraint.message !== undefined && typeof constraint.message !== "string") {
        return null;
      }
      constraints.push(constraint.message === undefined
        ? { type: constraint.type, roles: [...constraint.roles] }
        : { type: constraint.type, roles: [...constraint.roles], message: constraint.message });
      continue;
    }

    if (constraint.type === "requires_any_role_when_role_present") {
      const role = stringValue(constraint.role);
      if (!role || !isStringArray(constraint.roles) || constraint.roles.length === 0) {
        return null;
      }
      if (constraint.message !== undefined && typeof constraint.message !== "string") {
        return null;
      }
      constraints.push(constraint.message === undefined
        ? { type: constraint.type, role, roles: [...constraint.roles] }
        : { type: constraint.type, role, roles: [...constraint.roles], message: constraint.message });
      continue;
    }

    return null;
  }

  return constraints;
}

function pricingFormulaValue(value: unknown): MediaPricingFormula | null {
  if (value === undefined) {
    return { type: "static" };
  }

  if (!isRecord(value)) {
    return null;
  }

  const type = pricingFormulaTypeValue(value.type);
  if (!type) {
    return null;
  }

  return {
    ...value,
    type,
  };
}

function parameterSchemaValue(value: unknown): MediaParameterSchema | null {
  if (value === undefined) {
    return { type: "object", properties: {} };
  }

  if (!isRecord(value) || value.type !== "object") {
    return null;
  }

  const schema = parameterPropertySchemaValue(value);
  if (!schema || schema.type !== "object") {
    return null;
  }

  const constraints = value.constraints === undefined ? undefined : parameterConstraintsValue(value.constraints);
  if (value.constraints !== undefined && !constraints) {
    return null;
  }

  const rootSchema: MediaParameterSchema = {
    ...schema,
    type: "object",
  };
  if (constraints) {
    rootSchema.constraints = constraints;
  }
  return rootSchema;
}

function parameterPropertySchemaValue(value: unknown): MediaParameterPropertySchema | null {
  if (!isRecord(value)) {
    return null;
  }

  const schema: MediaParameterPropertySchema = {};

  if (value.type !== undefined) {
    if (Array.isArray(value.type)) {
      if (value.type.length === 0) {
        return null;
      }

      const types = value.type.map((type) => primitiveTypeValue(type));
      if (types.some((type) => type === null)) {
        return null;
      }
      schema.type = types as MediaParameterPrimitiveType[];
    } else {
      const type = primitiveTypeValue(value.type);
      if (!type) {
        return null;
      }
      schema.type = type;
    }
  }

  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.some((item) => !isEnumValue(item))) {
      return null;
    }
    schema.enum = [...value.enum];
  }

  if (value.required !== undefined) {
    if (!isStringArray(value.required)) {
      return null;
    }
    schema.required = [...value.required];
  }

  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) {
      return null;
    }

    const properties: Record<string, MediaParameterPropertySchema> = {};
    for (const [key, property] of Object.entries(value.properties)) {
      const parsed = parameterPropertySchemaValue(property);
      if (!parsed) {
        return null;
      }
      properties[key] = parsed;
    }

    schema.properties = properties;
  }

  if (value.additionalProperties !== undefined) {
    if (typeof value.additionalProperties !== "boolean") {
      return null;
    }
    schema.additionalProperties = value.additionalProperties;
  }

  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const) {
    const numericValue = value[key];
    if (numericValue !== undefined) {
      if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
        return null;
      }
      schema[key] = numericValue;
    }
  }

  if (value.items !== undefined) {
    const items = parameterPropertySchemaValue(value.items);
    if (!items) {
      return null;
    }
    schema.items = items;
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = value[key];
    if (variants !== undefined) {
      if (!Array.isArray(variants)) {
        return null;
      }

      const parsed = variants.map((variant) => parameterPropertySchemaValue(variant));
      if (parsed.some((variant) => variant === null)) {
        return null;
      }

      schema[key] = parsed as MediaParameterPropertySchema[];
    }
  }

  if (value.default !== undefined) {
    schema.default = value.default;
  }

  if (value.description !== undefined) {
    if (typeof value.description !== "string") {
      return null;
    }
    schema.description = value.description;
  }

  return schema;
}

function primitiveTypeValue(value: unknown): MediaParameterPrimitiveType | null {
  return typeof value === "string" && (PARAMETER_TYPES as readonly string[]).includes(value)
    ? value as MediaParameterPrimitiveType
    : null;
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

function inputMediaKind(value: unknown): "image" | "video" | "audio" | null {
  return value === "image" || value === "video" || value === "audio" ? value : null;
}

function countValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEnumValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function pricingFormulaTypeValue(value: unknown): MediaPricingFormula["type"] | null {
  return typeof value === "string" && (PRICING_FORMULA_TYPES as readonly string[]).includes(value)
    ? value as MediaPricingFormula["type"]
    : null;
}

function parameterConstraintsValue(value: unknown): MediaParameterSchema["constraints"] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const constraints: NonNullable<MediaParameterSchema["constraints"]> = [];
  for (const constraint of value) {
    if (!isRecord(constraint)) {
      return null;
    }

    if (constraint.type !== "exactly_one" && constraint.type !== "at_least_one") {
      return null;
    }

    if (!isStringArray(constraint.fields) || constraint.fields.length === 0) {
      return null;
    }

    if (constraint.message !== undefined && typeof constraint.message !== "string") {
      return null;
    }

    const type = constraint.type;
    constraints.push(constraint.message === undefined
      ? { type, fields: [...constraint.fields] }
      : { type, fields: [...constraint.fields], message: constraint.message });
  }

  return constraints;
}
