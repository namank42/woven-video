import { describe, expect, it } from "vitest";
import { validateMediaParameters } from "@/lib/media/schema";

describe("validateMediaParameters", () => {
  it("accepts required typed parameters", () => {
    const result = validateMediaParameters(
      { prompt: "a cat", duration: 5 },
      {
        type: "object",
        required: ["prompt"],
        properties: { prompt: { type: "string" }, duration: { type: "number" } },
      },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects missing and mistyped parameters", () => {
    expect(validateMediaParameters({}, { type: "object", required: ["prompt"] })).toEqual({
      ok: false,
      error: "Missing required parameter: prompt.",
    });
    expect(validateMediaParameters({ prompt: 7 }, {
      type: "object",
      properties: { prompt: { type: "string" } },
    })).toEqual({
      ok: false,
      error: "Invalid parameter type for prompt: expected string.",
    });
  });
});
