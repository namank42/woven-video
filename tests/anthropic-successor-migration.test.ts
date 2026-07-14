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
    const statements = sql
      .split(";")
      .map((statement) => statement.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const sonnetUpsert =
      statements.find(
        (statement) =>
          statement.includes("insert into public.model_pricing_rules as rules") &&
          statement.includes("'anthropic/claude-sonnet-5'"),
      ) ?? "";
    expect(sonnetUpsert).toContain(
      [
        "values (",
        "'vercel-ai-gateway',",
        "'anthropic/claude-sonnet-5',",
        "'chat',",
        "'Claude Sonnet 5',",
        "2000,",
        "1,",
        "50000,",
        "true,",
        "jsonb_build_object(",
        "'provider_model_id', 'anthropic/claude-sonnet-5',",
        "'supports_reasoning', true,",
        `'supported_reasoning_efforts', '["low", "medium", "high", "xhigh", "max"]'::jsonb,`,
        "'default_reasoning_effort', 'high',",
        "'is_default', false,",
        `'replaces_model_ids', '["anthropic/claude-sonnet-4.6"]'::jsonb`,
        ") ) on conflict (provider, model, operation) do update",
      ].join(" "),
    );
    expect(sonnetUpsert).toContain(
      "metadata = coalesce(rules.metadata, '{}'::jsonb) || excluded.metadata",
    );

    const sonnetDisable =
      statements.find(
        (statement) =>
          statement.startsWith("update public.model_pricing_rules") &&
          statement.includes("model = 'anthropic/claude-sonnet-4.6'"),
      ) ?? "";
    expect(sonnetDisable).toBe(
      "update public.model_pricing_rules set enabled = false, updated_at = now() where provider = 'vercel-ai-gateway' and model = 'anthropic/claude-sonnet-4.6' and operation = 'chat'",
    );

    const opusUpdate =
      statements.find(
        (statement) =>
          statement.startsWith("update public.model_pricing_rules as rules") &&
          statement.includes("rules.model = 'anthropic/claude-opus-4.8'"),
      ) ?? "";
    expect(opusUpdate).toBe(
      `update public.model_pricing_rules as rules set metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object( 'is_default', false, 'replaces_model_ids', '["anthropic/claude-opus-4.7"]'::jsonb ), updated_at = now() where rules.provider = 'vercel-ai-gateway' and rules.model = 'anthropic/claude-opus-4.8' and rules.operation = 'chat'`,
    );

    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/metadata\s*=\s*excluded\.metadata\s*[,;]/i);
  });
});
