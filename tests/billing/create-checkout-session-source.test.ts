import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("create-checkout-session source", () => {
  it("checks trial-used eligibility before creating subscription checkout", async () => {
    const source = await readFile(
      "supabase/functions/create-checkout-session/index.ts",
      "utf8",
    );

    expect(source).toContain("user_trial_used");
    expect(source).toContain("failed_to_check_trial_eligibility");
    expect(source).toContain("checkoutMode");
  });
});
