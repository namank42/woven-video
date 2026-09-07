import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const FORM = "components/account/balance-top-up-form.tsx";
const ACTION = "app/account/actions.ts";
const EDGE = "supabase/functions/create-checkout-session/index.ts";

describe("custom top-up limits", () => {
  it("has no upper bound in any enforcement layer", async () => {
    const [form, action, edge] = await Promise.all(
      [FORM, ACTION, EDGE].map((path) => readFile(path, "utf8")),
    );

    for (const source of [form, action, edge]) {
      expect(source).not.toContain("MAX_TOP_UP_CENTS");
    }

    expect(form).not.toContain('max="100"');
    expect(form).not.toMatch(/to \$100/);
    expect(action).not.toMatch(/between \$5 and \$100/);
  });

  it("keeps the $5 minimum in every enforcement layer", async () => {
    const [form, action, edge] = await Promise.all(
      [FORM, ACTION, EDGE].map((path) => readFile(path, "utf8")),
    );

    expect(form).toContain("customAmountCents >= 500");
    expect(form).toContain('min="5"');
    expect(action).toContain("MIN_TOP_UP_CENTS = 500");
    expect(action).toContain("amountCents >= MIN_TOP_UP_CENTS");
    expect(edge).toContain("MIN_TOP_UP_CENTS = 500");
    expect(edge).toContain("topUp.amountCents < MIN_TOP_UP_CENTS");
    expect(edge).toContain('"invalid_top_up_amount"');
  });
});
