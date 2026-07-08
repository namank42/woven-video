import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("account page billing copy", () => {
  it("uses generic subscription cancellation copy", async () => {
    const source = await readFile("app/account/page.tsx", "utf8");

    expect(source).not.toContain("Trial checkout cancelled. No card was charged.");
    expect(source).toContain("Subscription checkout cancelled. No card was charged.");
  });
});
