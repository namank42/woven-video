import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712121000_seed_hosted_reasoning_efforts.sql",
);

describe("hosted reasoning effort metadata migration", () => {
  it("seeds the exact reviewed contract for every enabled hosted chat model", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('openai/gpt-5.6-sol', '[\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]'::jsonb, 'medium')",
    );
    expect(normalized).toContain(
      "('openai/gpt-5.6-terra', '[\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]'::jsonb, 'medium')",
    );
    expect(normalized).toContain(
      "('anthropic/claude-sonnet-4.6', '[\"low\", \"medium\", \"high\", \"max\"]'::jsonb, 'high')",
    );
    expect(normalized).toContain(
      "('anthropic/claude-opus-4.8', '[\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]'::jsonb, 'high')",
    );
    expect(normalized).toContain(
      "('moonshotai/kimi-k2.6', '[]'::jsonb, null)",
    );
    expect(normalized).toContain("'supports_reasoning', true");
    expect(normalized).toContain("'supported_reasoning_efforts', contract.efforts");
    expect(normalized).toContain("'default_reasoning_effort', contract.default_effort");
    expect(normalized).toContain("coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(");
    expect(normalized).toContain("rules.provider = 'vercel-ai-gateway'");
    expect(normalized).toContain("rules.operation = 'chat'");
    expect(sql).not.toMatch(/metadata\s*=\s*jsonb_build_object/i);
  });
});
