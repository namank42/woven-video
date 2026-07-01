import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("pricing page source", () => {
  it("uses static pricing data instead of runtime model fetches", async () => {
    const source = await readFile("app/pricing/page.tsx", "utf8");

    expect(source).toContain("@/lib/pricing-page-rates");
    expect(source).toContain("mediaModelRates");
    expect(source).not.toMatch(
      /createSupabase|api\/v1\/media\/models|fetch\(|listMediaModels/,
    );
  });
});
