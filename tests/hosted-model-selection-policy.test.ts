import { describe, expect, it } from "vitest";

import {
  validateHostedModelSelectionPolicies,
} from "@/lib/ai/hosted-model-selection-policy";

type CatalogModel = { model: string; metadata: unknown };

function validCatalog(): CatalogModel[] {
  return [
    {
      model: "openai/gpt-5.6-sol",
      metadata: {
        is_default: false,
        replaces_model_ids: ["openai/gpt-5.5"],
      },
    },
    {
      model: "openai/gpt-5.6-terra",
      metadata: { is_default: false, replaces_model_ids: [] },
    },
    {
      model: "anthropic/claude-sonnet-5",
      metadata: {
        is_default: false,
        replaces_model_ids: ["anthropic/claude-sonnet-4.6"],
      },
    },
    {
      model: "anthropic/claude-opus-4.8",
      metadata: {
        is_default: false,
        replaces_model_ids: ["anthropic/claude-opus-4.7"],
      },
    },
    {
      model: "moonshotai/kimi-k2.6",
      metadata: { is_default: true, replaces_model_ids: [] },
    },
  ];
}

function withMetadata(
  catalog: CatalogModel[],
  modelId: string,
  metadata: unknown,
): CatalogModel[] {
  return catalog.map((model) =>
    model.model === modelId ? { ...model, metadata } : model,
  );
}

describe("validateHostedModelSelectionPolicies", () => {
  it("returns the exact explicit policy for the valid five-model catalog", () => {
    const result = validateHostedModelSelectionPolicies(validCatalog());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    expect([...result.policiesByModelId.entries()]).toEqual([
      [
        "openai/gpt-5.6-sol",
        {
          is_default: false,
          replaces_model_ids: ["openai/gpt-5.5"],
        },
      ],
      ["openai/gpt-5.6-terra", { is_default: false, replaces_model_ids: [] }],
      [
        "anthropic/claude-sonnet-5",
        {
          is_default: false,
          replaces_model_ids: ["anthropic/claude-sonnet-4.6"],
        },
      ],
      [
        "anthropic/claude-opus-4.8",
        {
          is_default: false,
          replaces_model_ids: ["anthropic/claude-opus-4.7"],
        },
      ],
      ["moonshotai/kimi-k2.6", { is_default: true, replaces_model_ids: [] }],
    ]);
  });

  it.each([
    [null, "openai/gpt-5.6-sol: metadata must be an object"],
    [
      { replaces_model_ids: ["openai/gpt-5.5"] },
      "openai/gpt-5.6-sol: is_default must be a boolean",
    ],
    [
      { is_default: true },
      "openai/gpt-5.6-sol: replaces_model_ids must be an array",
    ],
    [
      { is_default: true, replaces_model_ids: [""] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: [123] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: [" openai/gpt-5.5"] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: ["openai/gpt 5.5"] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: ["gpt-5.5"] },
      "openai/gpt-5.6-sol: replacement IDs must be non-empty canonical strings",
    ],
    [
      { is_default: true, replaces_model_ids: ["woven:openai/gpt-5.5"] },
      "openai/gpt-5.6-sol: replacement IDs must not use the woven: prefix",
    ],
    [
      { is_default: true, replaces_model_ids: ["openai/gpt-5.6-sol"] },
      "openai/gpt-5.6-sol: a model cannot replace itself",
    ],
    [
      {
        is_default: true,
        replaces_model_ids: ["openai/gpt-5.5", "openai/gpt-5.5"],
      },
      "openai/gpt-5.6-sol: duplicate replacement ID openai/gpt-5.5",
    ],
  ] as const)("rejects invalid Sol metadata %#", (metadata, reason) => {
    expect(
      validateHostedModelSelectionPolicies(
        withMetadata(validCatalog(), "openai/gpt-5.6-sol", metadata),
      ),
    ).toEqual({ ok: false, reason });
  });

  it("rejects a catalog without a default", () => {
    const catalog = withMetadata(validCatalog(), "moonshotai/kimi-k2.6", {
      is_default: false,
      replaces_model_ids: [],
    });

    expect(validateHostedModelSelectionPolicies(catalog)).toEqual({
      ok: false,
      reason: "expected exactly one default model, found 0",
    });
  });

  it("rejects multiple defaults", () => {
    const catalog = withMetadata(validCatalog(), "openai/gpt-5.6-terra", {
      is_default: true,
      replaces_model_ids: [],
    });

    expect(validateHostedModelSelectionPolicies(catalog)).toEqual({
      ok: false,
      reason: "expected exactly one default model, found 2",
    });
  });

  it("rejects replacing an enabled model", () => {
    const catalog = withMetadata(validCatalog(), "openai/gpt-5.6-sol", {
      is_default: false,
      replaces_model_ids: ["openai/gpt-5.6-terra"],
    });

    expect(validateHostedModelSelectionPolicies(catalog)).toEqual({
      ok: false,
      reason: "openai/gpt-5.6-sol: replacement ID openai/gpt-5.6-terra is enabled",
    });
  });

  it("rejects one retired ID claimed by two enabled models", () => {
    const catalog = withMetadata(validCatalog(), "openai/gpt-5.6-terra", {
      is_default: false,
      replaces_model_ids: ["openai/gpt-5.5"],
    });

    expect(validateHostedModelSelectionPolicies(catalog)).toEqual({
      ok: false,
      reason:
        "replacement ID openai/gpt-5.5 is claimed by openai/gpt-5.6-sol and openai/gpt-5.6-terra",
    });
  });
});
