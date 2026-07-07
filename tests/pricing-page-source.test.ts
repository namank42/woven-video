import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("pricing page source", () => {
  it("uses static pricing data instead of runtime model fetches", async () => {
    const pageSource = await readFile("app/pricing/page.tsx", "utf8");
    const pricingDataSource = await readFile(
      "lib/pricing-page-rates.ts",
      "utf8",
    );

    expect(pageSource).toMatch(
      /import\s*{[\s\S]*chatModelRates[\s\S]*featureRates[\s\S]*mediaModelRates[\s\S]*}\s*from\s*"@\/lib\/pricing-page-rates"/,
    );
    expect(pageSource).not.toMatch(/\bconst\s+(models|otherFeatures)\b/);
    expect(pageSource).not.toMatch(/["']use client["']/);

    const combinedStaticSources = `${pageSource}\n${pricingDataSource}`;
    expect(combinedStaticSources).not.toMatch(
      /createSupabase|api\/v1\/media\/models|fetch\(|listMediaModels/,
    );
  });

  it("does not render internal media provider endpoint IDs", async () => {
    const pageSource = await readFile("app/pricing/page.tsx", "utf8");

    expect(pageSource).not.toMatch(/model\.modelIds|modelIds\.map/);
  });

  it("labels media qualifiers as public details instead of notes", async () => {
    const pageSource = await readFile("app/pricing/page.tsx", "utf8");

    expect(pageSource).toMatch(/>\s*Details\s*</);
    expect(pageSource).not.toMatch(/>\s*Notes\s*</);
  });
});
