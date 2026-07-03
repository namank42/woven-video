import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mediaModelRates } from "@/lib/pricing-page-rates";

describe("media runtime catalog seed", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260703180000_seed_media_runtime_catalog.sql"),
    "utf8",
  );

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
});
