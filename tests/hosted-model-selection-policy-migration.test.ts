import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712123000_seed_hosted_model_selection_policy.sql",
);

describe("hosted model selection policy migration", () => {
  it("seeds Sol as the sole default and GPT-5.5 successor", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('openai/gpt-5.6-sol', true, '[\"openai/gpt-5.5\"]'::jsonb)",
    );
    expect(normalized).toContain(
      "('openai/gpt-5.6-terra', false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-sonnet-4.6', false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-opus-4.8', false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('moonshotai/kimi-k2.6', false, '[]'::jsonb)",
    );
    expect(normalized.match(/, true, /g)).toHaveLength(1);
    expect(normalized).toContain("'is_default', policy.is_default");
    expect(normalized).toContain("'replaces_model_ids', policy.replaces_model_ids");
    expect(normalized).toContain(
      "coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(",
    );
    expect(normalized).toContain("rules.provider = 'vercel-ai-gateway'");
    expect(normalized).toContain("rules.operation = 'chat'");
    expect(sql).not.toMatch(/metadata\s*=\s*jsonb_build_object/i);
  });
});
