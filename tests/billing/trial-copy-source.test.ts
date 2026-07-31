import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const currentTrialSurfaces = [
  "app/page.tsx",
  "app/pricing/page.tsx",
  "app/terms/page.tsx",
  "app/account/page.tsx",
  "components/marketing/page-sections.tsx",
  "components/account/subscription-offer.ts",
  "components/account/start-trial-button.tsx",
  "components/checkout/checkout-result.tsx",
  "components/contact/contact-form.tsx",
  "lib/seo/constants.ts",
  "lib/seo/faqs.ts",
  "lib/seo/hubs.ts",
  "lib/seo/landing-pages.ts",
  "lib/seo/schema.ts",
] as const;

const staleTrialCopy = /7[- ]day|7 days|day 7/i;
const staleEmailPromise = /we email you before your trial ends/i;
const staleRefundPromise = /refund within (?:your )?7[- ]day/i;

describe("current three-day trial copy", () => {
  for (const path of currentTrialSurfaces) {
    it(`${path} contains no stale seven-day offer`, async () => {
      const source = await readFile(path, "utf8");

      expect(source).not.toMatch(staleTrialCopy);
      expect(source).not.toMatch(staleEmailPromise);
      expect(source).not.toMatch(staleRefundPromise);
    });
  }
});
