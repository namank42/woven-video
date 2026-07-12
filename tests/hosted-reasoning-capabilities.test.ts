import { describe, expect, it } from "vitest";

import { parseHostedReasoningCapabilities } from "@/lib/ai/hosted-reasoning-capabilities";

const safeFallback = {
  supports_reasoning: false,
  supported_reasoning_efforts: [],
  default_reasoning_effort: null,
};

describe("parseHostedReasoningCapabilities", () => {
  it("accepts an exact ordered effort array and a member default", () => {
    expect(
      parseHostedReasoningCapabilities({
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
        default_reasoning_effort: "medium",
      }),
    ).toEqual({
      ok: true,
      value: {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
        default_reasoning_effort: "medium",
      },
    });
  });

  it("accepts reasoning support without granular tiers", () => {
    expect(
      parseHostedReasoningCapabilities({
        supports_reasoning: true,
        supported_reasoning_efforts: [],
        default_reasoning_effort: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        supports_reasoning: true,
        supported_reasoning_efforts: [],
        default_reasoning_effort: null,
      },
    });
  });

  it("accepts a fully disabled reasoning contract", () => {
    expect(
      parseHostedReasoningCapabilities({
        supports_reasoning: false,
        supported_reasoning_efforts: [],
        default_reasoning_effort: null,
      }),
    ).toEqual({ ok: true, value: safeFallback });
  });

  it.each([
    [null, "metadata must be an object"],
    [{}, "supports_reasoning must be a boolean"],
    [
      { supports_reasoning: true },
      "supported_reasoning_efforts must be an array",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "none"],
        default_reasoning_effort: "low",
      },
      "supported_reasoning_efforts contains unsupported value: none",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "low"],
        default_reasoning_effort: "low",
      },
      "supported_reasoning_efforts contains duplicate value: low",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["high", "medium"],
        default_reasoning_effort: "high",
      },
      "supported_reasoning_efforts must use canonical order",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "high"],
        default_reasoning_effort: null,
      },
      "non-empty supported_reasoning_efforts requires a member default_reasoning_effort",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: ["low", "high"],
        default_reasoning_effort: "medium",
      },
      "non-empty supported_reasoning_efforts requires a member default_reasoning_effort",
    ],
    [
      {
        supports_reasoning: true,
        supported_reasoning_efforts: [],
        default_reasoning_effort: "high",
      },
      "empty supported_reasoning_efforts requires a null default_reasoning_effort",
    ],
    [
      {
        supports_reasoning: false,
        supported_reasoning_efforts: ["low"],
        default_reasoning_effort: "low",
      },
      "supports_reasoning false requires empty efforts and a null default",
    ],
  ] as const)("safe-degrades invalid metadata %#", (metadata, reason) => {
    expect(parseHostedReasoningCapabilities(metadata)).toEqual({
      ok: false,
      value: safeFallback,
      reason,
    });
  });
});
