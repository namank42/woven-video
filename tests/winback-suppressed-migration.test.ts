import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260903120000_add_winback_suppressed.sql",
);

describe("winback suppression migration lineage", () => {
  it("restores the applied version as an idempotent schema-only migration without customer data", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const executableSql = sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();

    expect(executableSql).toBe(
      "alter table public.profiles add column if not exists winback_suppressed boolean not null default false;",
    );
    expect(sql).not.toMatch(/\bupdate\s+public\.profiles\b/i);
    expect(sql).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    );
    expect(sql).not.toMatch(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    );
    expect(sql).not.toMatch(
      /(?:--[^\n]*\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b)|(?:["'][A-Z][a-z]+(?:\s+[A-Z][a-z]+)*["'])/,
    );
  });
});
