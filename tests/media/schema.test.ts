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

  it("rejects enum values outside the model schema", () => {
    expect(validateMediaParameters(
      { duration: "12s" },
      {
        type: "object",
        properties: { duration: { type: "string", enum: ["4s", "6s", "8s"] } },
      },
    )).toEqual({
      ok: false,
      error: "Invalid parameter value for duration: expected one of 4s, 6s, 8s.",
    });
  });

  it("validates integer and numeric bounds", () => {
    expect(validateMediaParameters(
      { num_images: 2 },
      {
        type: "object",
        properties: { num_images: { type: "integer", minimum: 1, maximum: 4 } },
      },
    )).toEqual({ ok: true, value: { num_images: 2 } });

    expect(validateMediaParameters(
      { num_images: 2.5 },
      {
        type: "object",
        properties: { num_images: { type: "integer", minimum: 1, maximum: 4 } },
      },
    )).toEqual({
      ok: false,
      error: "Invalid parameter type for num_images: expected integer.",
    });

    expect(validateMediaParameters(
      { num_images: 5 },
      {
        type: "object",
        properties: { num_images: { type: "integer", minimum: 1, maximum: 4 } },
      },
    )).toEqual({
      ok: false,
      error: "Invalid parameter value for num_images: expected <= 4.",
    });
  });

  it("validates arrays and nested object items", () => {
    expect(validateMediaParameters(
      { multi_prompt: [{ timestamp: 0, prompt: "open" }] },
      {
        type: "object",
        properties: {
          multi_prompt: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              type: "object",
              required: ["timestamp", "prompt"],
              additionalProperties: false,
              properties: {
                timestamp: { type: "number", minimum: 0 },
                prompt: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    )).toEqual({ ok: true, value: { multi_prompt: [{ timestamp: 0, prompt: "open" }] } });
  });

  it("supports oneOf for GPT image_size", () => {
    const schema = {
      type: "object" as const,
      properties: {
        image_size: {
          oneOf: [
            { type: "string", enum: ["square", "landscape_16_9", "auto"] },
            {
              type: "object",
              required: ["width", "height"],
              additionalProperties: false,
              properties: {
                width: { type: "integer", minimum: 16, maximum: 3840 },
                height: { type: "integer", minimum: 16, maximum: 3840 },
              },
            },
          ],
        },
      },
    };

    expect(validateMediaParameters({ image_size: "auto" }, schema)).toEqual({
      ok: true,
      value: { image_size: "auto" },
    });
    expect(validateMediaParameters({ image_size: { width: 1024, height: 768 } }, schema)).toEqual({
      ok: true,
      value: { image_size: { width: 1024, height: 768 } },
    });
  });

  it("validates named cross-field constraints", () => {
    const schema = {
      type: "object" as const,
      properties: {
        prompt: { type: "string" as const },
        multi_prompt: { type: "array" as const, minItems: 1 },
      },
      constraints: [{ type: "exactly_one" as const, fields: ["prompt", "multi_prompt"] }],
    };

    expect(validateMediaParameters({}, schema)).toEqual({
      ok: false,
      error: "Exactly one of prompt, multi_prompt is required.",
    });
    expect(validateMediaParameters({ prompt: "open", multi_prompt: [{ prompt: "close" }] }, schema)).toEqual({
      ok: false,
      error: "Exactly one of prompt, multi_prompt is required.",
    });
  });
});
