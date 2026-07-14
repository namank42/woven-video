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

  it("renders optional long-context rates on desktop and mobile", async () => {
    const pageSource = await readFile("app/pricing/page.tsx", "utf8");

    expect(pageSource).toContain("function ChatRateValue");
    expect(pageSource).toContain(
      "Higher tiers apply when input exceeds 272K tokens.",
    );

    for (const field of ["input", "output", "cacheRead", "cacheWrite"]) {
      expect(
        pageSource.split(`higherTier={model.higherTier?.${field}}`),
      ).toHaveLength(3);
    }

    expect(pageSource).not.toMatch(/["']use client["']/);
  });

  it("renders optional dated rate labels on desktop and mobile", async () => {
    const pageSource = await readFile("app/pricing/page.tsx", "utf8");
    const chatModelsSource = pageSource
      .split("function ChatModelsTable()", 2)[1]
      .split("function MediaModelsTable()", 1)[0];
    const [desktopSource, mobileSource, ...unexpectedSections] =
      chatModelsSource.split('<div className="flex flex-col gap-3 md:hidden">');

    expect(unexpectedSections).toHaveLength(0);
    expect(desktopSource.split("model.rateLabel ?")).toHaveLength(2);
    expect(desktopSource.split("{model.rateLabel}")).toHaveLength(2);
    expect(mobileSource.split("model.rateLabel ?")).toHaveLength(2);
    expect(mobileSource.split("{model.rateLabel}")).toHaveLength(2);
  });
});
