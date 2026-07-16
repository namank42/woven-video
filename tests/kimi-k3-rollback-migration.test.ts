import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260717123000_rollback_kimi_k3.sql",
);

describe("Kimi K3 rollback migration", () => {
  it("restores K2.6 as default while preserving both rows", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('moonshotai/kimi-k3', false, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('moonshotai/kimi-k2.6', true, true, '[\"moonshotai/kimi-k3\"]'::jsonb)",
    );
    expect(normalized.match(/, true, true, /g)).toHaveLength(1);
    expect(normalized).toContain("rules.provider = 'vercel-ai-gateway'");
    expect(normalized).toContain("rules.operation = 'chat'");
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/metadata\s*=\s*jsonb_build_object/i);
  });
});
