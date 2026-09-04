import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260904123000_add_model_catalog_visibility.sql",
);

describe("model catalog visibility migration", () => {
  it("soft-hides Kimi without changing admission or Luna replacements", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "add column catalog_visible boolean not null default true",
    );
    expect(normalized).toContain(
      "set catalog_visible = false, enabled = true, metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object( 'is_default', false )",
    );
    expect(normalized).toContain(
      "where rules.provider = 'vercel-ai-gateway' and rules.operation = 'chat' and rules.model = 'moonshotai/kimi-k3'",
    );
    expect(sql).not.toContain("openai/gpt-5.6-luna");
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
  });
});
