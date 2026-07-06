import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260706123000_disable_redundant_hosted_chat_models.sql",
);

describe("hosted chat model removal migration", () => {
  it("disables redundant hosted chat rows without deleting billing history", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("update public.model_pricing_rules");
    expect(sql).toContain("enabled = false");
    expect(sql).toContain("provider = 'vercel-ai-gateway'");
    expect(sql).toContain("operation = 'chat'");
    expect(sql).toContain("'anthropic/claude-haiku-4.5'");
    expect(sql).toContain("'xai/grok-4.3'");
  });
});
