export type HostedModelSelectionPolicy = {
  is_default: boolean;
  replaces_model_ids: string[];
};

export type HostedModelSelectionInput = {
  model: string;
  metadata: unknown;
};

export type HostedModelSelectionValidation =
  | {
      ok: true;
      policiesByModelId: Map<string, HostedModelSelectionPolicy>;
    }
  | { ok: false; reason: string };

function failure(reason: string): HostedModelSelectionValidation {
  return { ok: false, reason };
}

function isMetadataObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalBackendModelId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    return false;
  }

  const slash = value.indexOf("/");
  return !/\s/.test(value) && slash > 0 && slash < value.length - 1;
}

export function validateHostedModelSelectionPolicies(
  models: HostedModelSelectionInput[],
): HostedModelSelectionValidation {
  const policiesByModelId = new Map<string, HostedModelSelectionPolicy>();
  const seenModelIds = new Set<string>();

  for (const model of models) {
    if (model.model.startsWith("woven:")) {
      return failure(`${model.model}: model IDs must not use the woven: prefix`);
    }
    if (!isCanonicalBackendModelId(model.model)) {
      return failure(
        `${model.model}: model ID must be a non-empty canonical backend ID`,
      );
    }
    if (seenModelIds.has(model.model)) {
      return failure(`duplicate model ID ${model.model}`);
    }
    seenModelIds.add(model.model);

    if (!isMetadataObject(model.metadata)) {
      return failure(`${model.model}: metadata must be an object`);
    }

    const isDefault = model.metadata.is_default;
    if (typeof isDefault !== "boolean") {
      return failure(`${model.model}: is_default must be a boolean`);
    }

    const rawReplacementIds = model.metadata.replaces_model_ids;
    if (!Array.isArray(rawReplacementIds)) {
      return failure(`${model.model}: replaces_model_ids must be an array`);
    }

    const replacementIds: string[] = [];
    const seen = new Set<string>();

    for (const rawReplacementId of rawReplacementIds) {
      if (!isCanonicalBackendModelId(rawReplacementId)) {
        return failure(
          `${model.model}: replacement IDs must be non-empty canonical strings`,
        );
      }
      if (rawReplacementId.startsWith("woven:")) {
        return failure(`${model.model}: replacement IDs must not use the woven: prefix`);
      }
      if (rawReplacementId === model.model) {
        return failure(`${model.model}: a model cannot replace itself`);
      }
      if (seen.has(rawReplacementId)) {
        return failure(`${model.model}: duplicate replacement ID ${rawReplacementId}`);
      }

      replacementIds.push(rawReplacementId);
      seen.add(rawReplacementId);
    }

    policiesByModelId.set(model.model, {
      is_default: isDefault,
      replaces_model_ids: replacementIds,
    });
  }

  const defaultCount = [...policiesByModelId.values()].filter(
    (policy) => policy.is_default,
  ).length;
  if (defaultCount !== 1) {
    return failure(`expected exactly one default model, found ${defaultCount}`);
  }

  const replacementOwners = new Map<string, string>();

  for (const [modelId, policy] of policiesByModelId) {
    for (const replacementId of policy.replaces_model_ids) {
      if (seenModelIds.has(replacementId)) {
        return failure(`${modelId}: replacement ID ${replacementId} is enabled`);
      }

      const existingOwner = replacementOwners.get(replacementId);
      if (existingOwner) {
        return failure(
          `replacement ID ${replacementId} is claimed by ${existingOwner} and ${modelId}`,
        );
      }
      replacementOwners.set(replacementId, modelId);
    }
  }

  return { ok: true, policiesByModelId };
}
