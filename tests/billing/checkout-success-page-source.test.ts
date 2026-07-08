import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("checkout success page source", () => {
  it("chooses success copy from the subscription query instead of static trial copy", async () => {
    const source = await readFile("app/checkout/success/page.tsx", "utf8");

    expect(source).toContain("searchParams");
    expect(source).toContain("subscription");
    expect(source).toContain('variant="trial"');
    expect(source).not.toContain('variant="success"');
  });
});
