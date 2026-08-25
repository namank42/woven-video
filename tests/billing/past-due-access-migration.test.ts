import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("past-due access cutover migration", () => {
  it("restricts subscription access and invalidates existing delinquent rows", async () => {
    const source = await readFile(
      "supabase/migrations/20260824130000_restrict_subscription_access_statuses.sql",
      "utf8",
    );

    expect(source).toContain("security definer");
    expect(source).toContain("status in ('trialing', 'active')");
    expect(source).toContain(
      "grant execute on function public.user_has_access(uuid) to authenticated, service_role",
    );
    expect(source).toMatch(
      /update public\.subscriptions\s+set updated_at = now\(\)\s+where status in \('past_due', 'unpaid'\)/s,
    );
  });
});
