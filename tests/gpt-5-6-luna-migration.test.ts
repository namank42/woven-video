import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260904120000_rollout_gpt_5_6_luna.sql",
);

describe("GPT-5.6 Luna rollout migration", () => {
  it("adds Luna as the sole hosted default while keeping Kimi K3 selectable", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "'vercel-ai-gateway', 'openai/gpt-5.6-luna', 'chat', 'GPT-5.6 Luna', 2000, 1, 50000, true",
    );
    expect(normalized).toContain(
      "'provider_model_id', 'openai/gpt-5.6-luna'",
    );
    expect(normalized).toContain("'supports_reasoning', true");
    expect(normalized).toContain(
      "'supported_reasoning_efforts', '[\"low\", \"medium\", \"high\", \"xhigh\", \"max\"]'::jsonb",
    );
    expect(normalized).toContain("'default_reasoning_effort', 'medium'");
    expect(normalized).toContain("'is_default', true");
    expect(normalized).toContain("'replaces_model_ids', '[]'::jsonb");
    expect(normalized).toContain("set metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object( 'is_default', false )");
    expect(normalized).toContain(
      "where rules.provider = 'vercel-ai-gateway' and rules.operation = 'chat' and rules.model = 'moonshotai/kimi-k3'",
    );
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/set\s+enabled\s*=\s*false[\s\S]*moonshotai\/kimi-k3/i);
  });
});
