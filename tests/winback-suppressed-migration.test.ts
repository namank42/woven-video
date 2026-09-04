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
    const normalizedSql = sql.replace(/\s+/g, " ").trim();

    expect(normalizedSql).toBe(
      "alter table public.profiles add column if not exists winback_suppressed boolean not null default false;",
    );
  });
});
