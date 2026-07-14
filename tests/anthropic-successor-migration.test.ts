import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260714120000_rollout_claude_sonnet_5.sql",
);

describe("Anthropic successor migration", () => {
  it("adds Sonnet 5, retires Sonnet 4.6, and declares the Opus successor", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain("insert into public.model_pricing_rules as rules");
    expect(normalized).toContain("'vercel-ai-gateway', 'anthropic/claude-sonnet-5', 'chat', 'Claude Sonnet 5', 2000, 1, 50000, true");
    expect(normalized).toContain("'provider_model_id', 'anthropic/claude-sonnet-5'");
    expect(normalized).toContain("'supports_reasoning', true");
    expect(normalized).toContain(
      "'supported_reasoning_efforts', '[\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]'::jsonb",
    );
    expect(normalized).toContain("'default_reasoning_effort', 'high'");
    expect(normalized).toContain("'is_default', false");
    expect(normalized).toContain(
      "'replaces_model_ids', '[\"anthropic/claude-sonnet-4.6\"]'::jsonb",
    );
    expect(normalized).toContain(
      "metadata = coalesce(rules.metadata, '{}'::jsonb) || excluded.metadata",
    );
    expect(normalized).toContain(
      "set enabled = false, updated_at = now() where provider = 'vercel-ai-gateway' and model = 'anthropic/claude-sonnet-4.6' and operation = 'chat'",
    );
    expect(normalized).toContain(
      "'replaces_model_ids', '[\"anthropic/claude-opus-4.7\"]'::jsonb",
    );
    expect(normalized).toContain(
      "where rules.provider = 'vercel-ai-gateway' and rules.model = 'anthropic/claude-opus-4.8' and rules.operation = 'chat'",
    );
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/metadata\s*=\s*excluded\.metadata\s*[,;]/i);
  });
});
