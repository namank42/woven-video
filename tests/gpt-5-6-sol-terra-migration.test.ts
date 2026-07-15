import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712120000_add_gpt_5_6_sol_terra.sql",
);

describe("GPT-5.6 Sol and Terra migration", () => {
  it("adds the two hosted models and disables GPT-5.5 without deleting it", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('vercel-ai-gateway', 'openai/gpt-5.6-sol', 'chat', 'GPT-5.6 Sol', 2000, 1, 100000, jsonb_build_object('provider_model_id', 'openai/gpt-5.6-sol'))",
    );
    expect(normalized).toContain(
      "('vercel-ai-gateway', 'openai/gpt-5.6-terra', 'chat', 'GPT-5.6 Terra', 2000, 1, 50000, jsonb_build_object('provider_model_id', 'openai/gpt-5.6-terra'))",
    );
    expect(normalized).toContain(
      "on conflict (provider, model, operation) do update",
    );
    expect(normalized).toContain("enabled = true");
    expect(normalized).toContain(
      "where provider = 'vercel-ai-gateway' and operation = 'chat' and model = 'openai/gpt-5.5'",
    );
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
  });
});
