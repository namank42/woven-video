import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260717120000_rollout_kimi_k3.sql",
);

describe("Kimi K3 cutover migration", () => {
  it("atomically enables K3 as the K2.6 successor and disables K2.6", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "'vercel-ai-gateway', 'moonshotai/kimi-k3', 'chat', 'Kimi K3', 2000, 1, 50000, true",
    );
    expect(normalized).toContain(
      "'provider_model_id', 'moonshotai/kimi-k3'",
    );
    expect(normalized).toContain("'supports_reasoning', true");
    expect(normalized).toContain("'supported_reasoning_efforts', '[]'::jsonb");
    expect(normalized).toContain("'default_reasoning_effort', null");
    expect(normalized).toContain("'is_default', true");
    expect(normalized).toContain(
      "'replaces_model_ids', '[\"moonshotai/kimi-k2.6\"]'::jsonb",
    );
    expect(normalized).toContain("metadata = coalesce(rules.metadata, '{}'::jsonb) || excluded.metadata");
    expect(normalized).toContain("set enabled = false");
    expect(normalized).toContain("'is_default', false");
    expect(normalized).toContain("'replaces_model_ids', '[]'::jsonb");
    expect(normalized).toContain(
      "where rules.provider = 'vercel-ai-gateway' and rules.operation = 'chat' and rules.model = 'moonshotai/kimi-k2.6'",
    );
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/metadata\s*=\s*excluded\.metadata/i);
  });
});
