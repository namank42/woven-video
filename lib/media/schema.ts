import type { MediaParameterSchema } from "@/lib/media/types";

export function validateMediaParameters(
  parameters: unknown,
  schema: MediaParameterSchema,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    return { ok: false, error: "parameters must be a JSON object." };
  }

  const value = parameters as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!(key in value)) return { ok: false, error: `Missing required parameter: ${key}.` };
  }

  for (const [key, rule] of Object.entries(schema.properties ?? {})) {
    if (!(key in value)) continue;
    if (!matchesType(value[key], rule.type)) {
      return { ok: false, error: `Invalid parameter type for ${key}: expected ${rule.type}.` };
    }
  }

  return { ok: true, value };
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === type;
}
