import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715123000_rollback_hosted_model_full_cutover.sql",
);

describe("hosted model full-cutover rollback migration", () => {
  it("restores the previous hosted catalog without deleting history", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('openai/gpt-5.5', true, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-sonnet-4.6', true, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-opus-4.8', true, false, '[\"anthropic/claude-opus-4.7\"]'::jsonb)",
    );
    expect(normalized).toContain(
      "('moonshotai/kimi-k2.6', true, true, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('openai/gpt-5.6-sol', false, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('openai/gpt-5.6-terra', false, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-sonnet-5', false, false, '[]'::jsonb)",
    );
    expect(normalized.match(/, true, true, /g)).toHaveLength(1);
    expect(normalized).toContain("rules.provider = 'vercel-ai-gateway'");
    expect(normalized).toContain("rules.operation = 'chat'");
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/metadata\s*=\s*jsonb_build_object/i);
  });
});
