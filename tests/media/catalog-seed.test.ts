import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mediaModelRates } from "@/lib/pricing-page-rates";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260703180000_seed_media_runtime_catalog.sql"),
  "utf8",
);

describe("media runtime catalog seed", () => {
  it("seeds every pricing-page media model id", () => {
    const ids = mediaModelRates.flatMap((group) => group.modelIds);
    for (const id of ids) {
      expect(migration).toContain(`"public_id": "${id}"`);
    }
  });

  it("seeds role-aware provider mappings and disables generic Fal URL fallback", () => {
    expect(migration).toContain('"provider_field": "image_url"');
    expect(migration).toContain('"provider_field": "image_urls"');
    expect(migration).toContain('"provider_field": "first_frame_url"');
    expect(migration).toContain('"provider_field": "last_frame_url"');
    expect(migration).toContain('"provider_field": "video_url"');
    expect(migration).toContain('"fal_allow_generic_url_fallback": false');
  });

  it("seeds GPT Image 2 image_size as an enum-or-object oneOf schema", () => {
    const rows = metadataRows();
    const gptImage = rows.get("openai/gpt-image-2") as CatalogMetadata;
    const edit = rows.get("openai/gpt-image-2/edit") as CatalogMetadata;

    for (const row of [gptImage, edit]) {
      const imageSize = row.parameter_schema.properties.image_size;
      expect(imageSize).toMatchObject({
        oneOf: [
          { type: "string", enum: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9", "auto"] },
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
        default: "landscape_4_3",
      });
      expect(imageSize).not.toHaveProperty("enum");
    }
  });

  it("seeds Seedance reference rows with cross-role input asset constraints", () => {
    const rows = metadataRows();
    for (const id of [
      "bytedance/seedance-2.0/reference-to-video",
      "bytedance/seedance-2.0/fast/reference-to-video",
    ]) {
      expect(rows.get(id)?.input_asset_schema.constraints).toEqual([
        { type: "at_least_one_role", roles: ["reference_images", "reference_videos", "reference_audio"] },
        { type: "requires_any_role_when_role_present", role: "reference_audio", roles: ["reference_images", "reference_videos"] },
      ]);
    }
  });
});

type CatalogMetadata = {
  public_id: string;
  parameter_schema: {
    properties: Record<string, Record<string, unknown>>;
  };
  input_asset_schema: {
    constraints?: unknown[];
  };
};

function metadataRows() {
  const rows = new Map<string, CatalogMetadata>();
  for (const match of migration.matchAll(/\$\$([\s\S]*?)\$\$::jsonb/g)) {
    const metadata = JSON.parse(match[1] ?? "{}") as CatalogMetadata;
    rows.set(metadata.public_id, metadata);
  }
  return rows;
}
