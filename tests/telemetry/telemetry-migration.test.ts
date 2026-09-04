import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260904130000_create_desktop_telemetry.sql",
);
const configPath = join(process.cwd(), "supabase/config.toml");

describe("desktop telemetry migration contract", () => {
  it("creates separate private streams without changing legacy analytics_events", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("create table public.telemetry_product_events");
    expect(sql).toContain("create table public.telemetry_operational_events");
    expect(sql).not.toMatch(
      /(?:alter|drop)\s+table\s+public\.analytics_events/i,
    );
    for (
      const table of [
        "telemetry_product_events",
        "telemetry_operational_events",
        "telemetry_installation_account_links",
        "telemetry_ingestion_rate_windows",
      ]
    ) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(sql).toContain(`grant all on public.${table} to service_role`);
    }
    expect(sql).toMatch(
      /revoke all on public\.telemetry_product_events from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /revoke all on public\.telemetry_operational_events from public, anon, authenticated/i,
    );
  });

  it("declares one service-role transaction boundary for rates, links, and inserts", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.telemetry_admit_and_insert(",
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("600");
    expect(sql).toContain("1200");
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toMatch(/on conflict \(event_id\) do nothing/i);
    expect(sql).toContain("telemetry_installation_account_links");
    expect(sql).toMatch(
      /revoke all on function public\.telemetry_admit_and_insert\(jsonb, uuid, timestamptz\) from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.telemetry_admit_and_insert\(jsonb, uuid, timestamptz\) to service_role/i,
    );
  });

  it("stores the required indexed envelope fields and operational fingerprints", () => {
    const sql = readFileSync(migrationPath, "utf8");
    for (
      const field of [
        "event_id",
        "occurred_at",
        "received_at",
        "catalog_version",
        "event_name",
        "stage",
        "installation_id",
        "user_id",
        "app_version",
        "app_environment",
        "release_channel",
        "workspace_id",
        "chat_id",
        "turn_id",
        "operation_id",
        "incident_id",
        "tool_call_id",
        "source_sequence",
        "host_observed_sequence",
        "priority",
        "properties",
      ]
    ) {
      expect(sql).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(sql).toContain("error_domain");
    expect(sql).toContain("error_code");
    expect(sql).toContain("error_fingerprint");
    expect(sql).toContain("telemetry_operational_error_idx");
  });

  it("installs exact retention cutoffs and the named daily cron job", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain(
      "create or replace function public.telemetry_apply_retention()",
    );
    expect(sql).toContain("interval '13 months'");
    expect(sql).toContain("interval '90 days'");
    expect(sql).toContain("desktop-telemetry-retention-daily");
    expect(sql).toContain("0 4 * * *");
  });

  it("keeps JWT verification enabled for the ingestion function", () => {
    const config = readFileSync(configPath, "utf8");
    expect(config).toMatch(
      /\[functions\.telemetry-ingest\]\s*\nverify_jwt\s*=\s*true/,
    );
  });
});
