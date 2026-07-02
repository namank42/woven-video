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

  it("rejects parameters not declared in the schema", () => {
    expect(validateMediaParameters(
      { prompt: "a cat", num_images: 10 },
      {
        type: "object",
        required: ["prompt"],
        properties: { prompt: { type: "string" } },
      },
    )).toEqual({
      ok: false,
      error: "Unknown parameter: num_images.",
    });
  });

  it("accepts required keys that have no properties entry", () => {
    expect(validateMediaParameters(
      { prompt: "a cat" },
      { type: "object", required: ["prompt"] },
    )).toEqual({
      ok: true,
      value: { prompt: "a cat" },
    });
  });
});
