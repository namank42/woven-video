import type {
  MediaParameterConstraint,
  MediaParameterPrimitiveType,
  MediaParameterPropertySchema,
  MediaParameterSchema,
} from "@/lib/media/types";

type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateMediaParameters(
  parameters: unknown,
  schema: MediaParameterSchema,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    return { ok: false, error: "parameters must be a JSON object." };
  }

  const value = parameters as Record<string, unknown>;
  const result = validateObject(value, schema, "");
  if (!result.ok) return result;

  const constraint = validateConstraints(value, schema.constraints ?? []);
  if (!constraint.ok) return constraint;

  return { ok: true, value };
}

function validateObject(
  value: Record<string, unknown>,
  schema: MediaParameterSchema | MediaParameterPropertySchema,
  path: string,
): ValidationResult {
  for (const key of schema.required ?? []) {
    if (!(key in value)) return invalid(`Missing required parameter: ${joinPath(path, key)}.`);
  }

  const declared = new Set([
    ...Object.keys(schema.properties ?? {}),
    ...(schema.required ?? []),
  ]);

  if (schema.additionalProperties !== true) {
    for (const key of Object.keys(value)) {
      if (!declared.has(key)) return invalid(`Unknown parameter: ${joinPath(path, key)}.`);
    }
  }

  for (const [key, rule] of Object.entries(schema.properties ?? {})) {
    if (!(key in value)) continue;
    const result = validateValue(value[key], rule, joinPath(path, key));
    if (!result.ok) return result;
  }

  return ok();
}

function validateValue(
  value: unknown,
  schema: MediaParameterPropertySchema,
  path: string,
): ValidationResult {
  if (schema.oneOf) return validateAlternatives(value, schema.oneOf, path, "oneOf");
  if (schema.anyOf) return validateAlternatives(value, schema.anyOf, path, "anyOf");

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    return invalid(`Invalid parameter type for ${path}: expected ${types.join(" or ")}.`);
  }

  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    return invalid(`Invalid parameter value for ${path}: expected one of ${schema.enum.join(", ")}.`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return invalid(`Invalid parameter value for ${path}: expected >= ${schema.minimum}.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return invalid(`Invalid parameter value for ${path}: expected <= ${schema.maximum}.`);
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return invalid(`Invalid parameter value for ${path}: expected at least ${schema.minLength} characters.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return invalid(`Invalid parameter value for ${path}: expected at most ${schema.maxLength} characters.`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return invalid(`Invalid parameter value for ${path}: expected at least ${schema.minItems} items.`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return invalid(`Invalid parameter value for ${path}: expected at most ${schema.maxItems} items.`);
    }
    if (schema.items) {
      for (const [index, item] of value.entries()) {
        const result = validateValue(item, schema.items, `${path}[${index}]`);
        if (!result.ok) return result;
      }
    }
  }

  if (isRecord(value) && schema.properties) {
    const result = validateObject(value, schema, path);
    if (!result.ok) return result;
  }

  return ok();
}

function validateAlternatives(
  value: unknown,
  schemas: MediaParameterPropertySchema[],
  path: string,
  mode: "oneOf" | "anyOf",
): ValidationResult {
  let matched = 0;
  let lastError: ValidationResult | null = null;

  for (const schema of schemas) {
    const result = validateValue(value, schema, path);
    if (result.ok) {
      matched += 1;
      if (mode === "anyOf") return result;
    } else if (lastError === null) {
      lastError = result;
    }
  }

  if (mode === "oneOf" ? matched === 1 : matched >= 1) {
    return ok();
  }

  return lastError ?? invalid(`Invalid parameter value for ${path}.`);
}

function validateConstraints(
  value: Record<string, unknown>,
  constraints: MediaParameterConstraint[],
): ValidationResult {
  for (const constraint of constraints) {
    if (
      !constraint ||
      typeof constraint !== "object" ||
      !Array.isArray(constraint.fields) ||
      !constraint.fields.every((field) => typeof field === "string")
    ) {
      return invalid("Invalid media parameter schema.");
    }

    const present = constraint.fields.filter((field) => value[field] !== undefined);
    if (constraint.type === "exactly_one" && present.length !== 1) {
      return invalid(constraint.message ?? `Exactly one of ${constraint.fields.join(", ")} is required.`);
    }
    if (constraint.type === "at_least_one" && present.length < 1) {
      return invalid(constraint.message ?? `At least one of ${constraint.fields.join(", ")} is required.`);
    }
  }
  return ok();
}

function matchesType(value: unknown, type: MediaParameterPrimitiveType): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function ok(): ValidationResult {
  return { ok: true };
}

function invalid(error: string): ValidationResult {
  return { ok: false, error };
}
