import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260706124000_disable_slack_notifications_for_test_identities.sql",
);

describe("Slack test-notification guard migration", () => {
  it("prevents test identities from posting Slack signup and feedback notifications", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("create or replace function public.notify_slack_on_signup()");
    expect(sql).toContain("create or replace function public.notify_slack_on_feedback()");
    expect(sql).toContain("@example.test");
    expect(sql).toContain("return new;");

    const testDomainGuard = /@example\.test[\s\S]*?return new;/;
    expect(sql).toMatch(testDomainGuard);
    expect(sql.indexOf("@example.test")).toBeLessThan(sql.indexOf("net.http_post"));
  });
});
