import type { MediaInputAssetRole, MediaInputAssetSchema, MediaModel } from "@/lib/media/types";

export type MediaJobInputAsset = {
  assetId: string;
  role: string;
};

export function parseMediaJobInputAssets({
  model,
  inputAssets,
  inputAssetIds,
}: {
  model: Pick<MediaModel, "inputAssetSchema">;
  inputAssets: unknown;
  inputAssetIds: unknown;
}): { ok: true; inputAssets: MediaJobInputAsset[]; inputAssetIds: string[] } | { ok: false; error: string } {
  const schema = normalizeInputAssetSchema(model.inputAssetSchema);

  if (inputAssets !== undefined && inputAssetIds !== undefined) {
    return { ok: false, error: "input_assets and input_asset_ids cannot both be provided." };
  }

  if (inputAssets !== undefined) {
    if (!Array.isArray(inputAssets)) {
      return { ok: false, error: "input_assets must be an array." };
    }

    const parsed: MediaJobInputAsset[] = [];
    for (const item of inputAssets) {
      if (
        !isRecord(item) ||
        typeof item.asset_id !== "string" ||
        !item.asset_id.trim() ||
        typeof item.role !== "string" ||
        !item.role.trim()
      ) {
        return { ok: false, error: "input_assets must contain asset_id and role strings." };
      }

      parsed.push({
        assetId: item.asset_id.trim(),
        role: item.role.trim(),
      });
    }

    const validation = validateInputAssetRoles(parsed, schema);
    if (!validation.ok) {
      return validation;
    }

    return {
      ok: true,
      inputAssets: parsed,
      inputAssetIds: parsed.map((item) => item.assetId),
    };
  }

  const legacyIds = parseLegacyInputAssetIds(inputAssetIds);
  if (!legacyIds.ok) {
    return legacyIds;
  }

  if (legacyIds.inputAssetIds.length === 0) {
    const validation = validateInputAssetRoles([], schema);
    if (!validation.ok) {
      return validation;
    }

    return { ok: true, inputAssets: [], inputAssetIds: [] };
  }

  const inferredRole = inferLegacyRole(schema, legacyIds.inputAssetIds.length);
  if (!inferredRole) {
    return { ok: false, error: "input_assets with roles are required for this model." };
  }

  const inferredInputAssets = legacyIds.inputAssetIds.map((assetId) => ({
    assetId,
    role: inferredRole,
  }));
  const validation = validateInputAssetRoles(inferredInputAssets, schema);
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    inputAssets: inferredInputAssets,
    inputAssetIds: legacyIds.inputAssetIds,
  };
}

export function validateInputAssetRoles(
  inputAssets: MediaJobInputAsset[],
  schema: MediaInputAssetSchema | undefined,
): { ok: true } | { ok: false; error: string } {
  const normalizedSchema = normalizeInputAssetSchema(schema);
  const seenAssetIds = new Set<string>();

  for (const asset of inputAssets) {
    if (seenAssetIds.has(asset.assetId)) {
      return { ok: false, error: "input_assets must not repeat asset_id values." };
    }

    seenAssetIds.add(asset.assetId);
  }

  if (normalizedSchema.roles.length === 0) {
    for (const asset of inputAssets) {
      if (asset.role !== "image") {
        return { ok: false, error: "input_assets contains an unknown role." };
      }
    }

    return { ok: true };
  }

  const roleMap = new Map(normalizedSchema.roles.map((role) => [role.role, role]));
  const counts = new Map<string, number>();

  for (const asset of inputAssets) {
    const role = roleMap.get(asset.role);
    if (!role) {
      return { ok: false, error: "input_assets contains an unknown role." };
    }

    counts.set(asset.role, (counts.get(asset.role) ?? 0) + 1);
  }

  for (const role of normalizedSchema.roles) {
    const count = counts.get(role.role) ?? 0;
    if (role.required && count === 0) {
      return { ok: false, error: `input_assets is missing required role ${role.role}.` };
    }
    if (count < role.min) {
      return { ok: false, error: `input_assets role ${role.role} requires at least ${role.min} asset(s).` };
    }
    if (count > role.max) {
      return { ok: false, error: `input_assets role ${role.role} allows at most ${role.max} asset(s).` };
    }
  }

  return { ok: true };
}

export function inputAssetRoleFor(schema: MediaInputAssetSchema | undefined, roleName: string) {
  return normalizeInputAssetSchema(schema).roles.find((role) => role.role === roleName) ?? null;
}

function parseLegacyInputAssetIds(
  value: unknown,
): { ok: true; inputAssetIds: string[] } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, inputAssetIds: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: "input_asset_ids must be an array of nonempty strings." };
  }

  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return { ok: false, error: "input_asset_ids must be an array of nonempty strings." };
    }

    ids.push(item.trim());
  }

  return { ok: true, inputAssetIds: ids };
}

function inferLegacyRole(schema: MediaInputAssetSchema, count: number) {
  if (count !== 1) {
    return null;
  }

  if (schema.roles.length === 0) {
    return "image";
  }

  if (schema.roles.length === 1) {
    const [role] = schema.roles;
    if (role && role.min <= 1 && role.max === 1) {
      return role.role;
    }
  }

  return null;
}

function normalizeInputAssetSchema(schema: MediaInputAssetSchema | undefined): MediaInputAssetSchema {
  return {
    roles: Array.isArray(schema?.roles) ? schema.roles : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function matchesInputAssetRoleContentType(contentType: string, role: MediaInputAssetRole) {
  return role.contentTypePrefixes.some((prefix) => contentType.startsWith(prefix));
}
