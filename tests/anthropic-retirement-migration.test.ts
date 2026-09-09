import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateHostedModelSelectionPolicies } from "@/lib/ai/hosted-model-selection-policy";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260909120000_disable_anthropic_hosted_chat.sql",
);

describe("anthropic retirement migration", () => {
  it("disables and hides every anthropic chat rule without touching Luna", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "set enabled = false, catalog_visible = false",
    );
    expect(normalized).toContain(
      "metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object( 'is_default', false )",
    );
    expect(normalized).toContain(
      "where provider = 'vercel-ai-gateway' and operation = 'chat' and model like 'anthropic/%'",
    );
    expect(sql).not.toContain("openai/gpt-5.6-luna");
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
  });

  it("leaves a valid selection policy with Luna as the sole default", () => {
    const visible = [
      {
        model: "openai/gpt-5.6-sol",
        metadata: {
          is_default: false,
          replaces_model_ids: ["openai/gpt-5.5"],
        },
      },
      {
        model: "openai/gpt-5.6-terra",
        metadata: { is_default: false, replaces_model_ids: [] },
      },
      {
        model: "openai/gpt-5.6-luna",
        metadata: { is_default: true, replaces_model_ids: [] },
      },
    ];

    const result = validateHostedModelSelectionPolicies(visible);

    expect(result.ok).toBe(true);
  });
});

describe("retired anthropic admission", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/api/auth");
    vi.doUnmock("@/lib/api/license");
    vi.doUnmock("@/lib/billing/model-pricing");
    vi.doUnmock("@/lib/supabase/admin");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns 404 model_not_found without touching the database", async () => {
    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/billing/model-pricing", async (importOriginal) => ({
      ...((await importOriginal()) as Record<string, unknown>),
      getHostedChatModel: vi.fn(async () => null),
    }));
    const createSupabaseAdminClient = vi.fn(() => {
      throw new Error("retired model must not touch the database");
    });
    vi.doMock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

    const { POST } = await import("@/app/api/v1/chat/completions/route");
    const response = await POST(
      new Request("https://example.test/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "anthropic/claude-sonnet-5",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("model_not_found");
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
