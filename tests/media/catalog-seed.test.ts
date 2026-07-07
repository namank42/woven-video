import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mediaModelRates } from "@/lib/pricing-page-rates";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260703180000_seed_media_runtime_catalog.sql"),
  "utf8",
);
const nanoBananaLiteEndpointMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql",
);
const gptImageSizedRatesMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260706122000_reseed_gpt_image_sized_rates.sql",
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

  it("seeds Nano Banana 2 Lite with Fal image pricing", () => {
    const rows = metadataRows();
    for (const id of ["google/nano-banana-2-lite", "google/nano-banana-2-lite/edit"]) {
      const metadata = rows.get(id) as CatalogMetadata;
      expect(metadata.public_id).toBe(id);
      expect(metadata.provider_endpoint).toBe(id);
      expect(metadata.pricing_formula).toMatchObject({
        type: "nano_banana",
        provider_rate_usd_per_image: "0.0398",
      });
      expect(seedColumnsForModel(id)).toMatchObject({
        markupBps: 2_000,
        minimumChargeUsdMicros: 0,
        reserveAmountUsdMicros: 47_760,
      });
    }
    expect(rows.has("fal-ai/nano-banana-lite")).toBe(false);
    expect(rows.has("fal-ai/nano-banana-lite/edit")).toBe(false);
  });

  it("includes a follow-up migration for databases that already applied the old Nano Banana Lite price", () => {
    expect(existsSync(nanoBananaLiteEndpointMigrationPath)).toBe(true);
    const correction = readFileSync(nanoBananaLiteEndpointMigrationPath, "utf8");

    expect(correction).toContain("'google/nano-banana-2-lite'");
    expect(correction).toContain("'google/nano-banana-2-lite/edit'");
    expect(correction).toContain("'fal-ai/nano-banana-lite'");
    expect(correction).toContain("'fal-ai/nano-banana-lite/edit'");
    expect(correction).toContain("2000,");
    expect(correction).toContain("0,");
    expect(correction).toContain("47760,");
    expect(correction).toContain("enabled = false");
    expect(correction).toContain("provider_rate_usd_per_image");
    expect(correction).toContain("0.0398");
  });

  it("includes a GPT Image 2 sized-rate reseed migration", () => {
    expect(existsSync(gptImageSizedRatesMigrationPath)).toBe(true);
    const reseed = readFileSync(gptImageSizedRatesMigrationPath, "utf8");

    expect(reseed).toContain("update public.model_pricing_rules");
    expect(reseed).toContain("minimum_charge_usd_micros = 10000");
    expect(reseed).toContain("where provider = 'fal'");
    expect(reseed).toContain("and model in ('openai/gpt-image-2', 'openai/gpt-image-2/edit')");
    expect(reseed).toContain("and operation = 'image_generation'");
    expect(extractPricingFormula(reseed)).toEqual({
      type: "gpt_image_sized",
      size_parameter: "image_size",
      quality_parameter: "quality",
      image_parameter: "num_images",
      provider_rate_usd_by_quality_and_size: {
        low: { standard: "0.01", large: "0.01", max: "0.02" },
        medium: { standard: "0.07", large: "0.07", max: "0.13" },
        high: { standard: "0.27", large: "0.28", max: "0.51" },
      },
    });
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
  provider_endpoint: string;
  pricing_formula: Record<string, unknown>;
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

function seedColumnsForModel(modelId: string) {
  const escapedModelId = modelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    String.raw`\(\s*'fal',\s*'${escapedModelId}',\s*'[^']+',\s*'[^']+',\s*(\d+),\s*(\d+),\s*(\d+),`,
  );
  const match = migration.match(pattern);
  expect(match).not.toBeNull();
  return {
    markupBps: Number(match?.[1]),
    minimumChargeUsdMicros: Number(match?.[2]),
    reserveAmountUsdMicros: Number(match?.[3]),
  };
}

function extractPricingFormula(sql: string) {
  const match = sql.match(/\$\$([\s\S]*?)\$\$::jsonb/);
  expect(match).not.toBeNull();
  return JSON.parse(match?.[1] ?? "{}") as Record<string, unknown>;
}
