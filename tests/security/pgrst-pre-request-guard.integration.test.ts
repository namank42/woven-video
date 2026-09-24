// Live-stack regression test for the public.pgrst_pre_request guard
// (supabase/migrations/20260924140000_guard_locked_rpc_calls.sql), which
// exists to stop supabase/postgres#2377: on supabase/postgres 17.6.1.111,
// calling a function the caller has no EXECUTE grant on segfaults the
// backend and restarts the whole database.
//
// Requires a running local Supabase stack (`supabase start`). Gated behind
// RUN_SUPABASE_DB_TESTS=1, matching tests/media/db-rpcs.integration.test.ts,
// since it needs live infrastructure and is not part of the default
// `pnpm test` run.
import { execSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runDbTests = process.env.RUN_SUPABASE_DB_TESTS === "1";
const describeDb = runDbTests ? describe : describe.skip;

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_woven-video";
// This project's [auth.email] enable_signup is false (Google-only sign-in;
// see app/privacy/page.tsx), so email/password sign-in is rejected outright
// by GoTrue even for an admin-created user. To get a genuine `authenticated`
// role JWT for this guard-only test (which has nothing to do with the login
// flow), mint one directly with the project's JWT secret -- the same
// well-known default `supabase start` uses locally.
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signAuthenticatedJwt(userId: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    sub: userId,
    role: "authenticated",
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${
    base64url(JSON.stringify(payload))
  }`;
  const signature = base64url(
    createHmac("sha256", JWT_SECRET).update(signingInput).digest(),
  );
  return `${signingInput}.${signature}`;
}

function requireEnv() {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required when RUN_SUPABASE_DB_TESTS=1.",
    );
  }
}

// The desktop app sends both apikey and Authorization: Bearer <key> for an
// anonymous/installation-only call (see resolveTelemetryIdentity in
// supabase/functions/_shared/auth.ts) -- it does not rely on Kong locally
// auto-injecting a demo anon JWT when Authorization is absent. Send both
// explicitly here too, so this test exercises the same request shape the
// real client produces.
function anonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, ...extra };
}

// A plausible JSON value for a Postgres parameter type, so a call reaches
// the function-privilege check this guard protects instead of being
// rejected earlier by PostgREST's own type coercion.
function sampleValue(pgType: string): unknown {
  const t = pgType.trim().toLowerCase();
  if (t === "uuid") return randomUUID();
  if (t === "uuid[]") return [randomUUID()];
  if (t === "text[]") return ["sample-text"];
  if (t === "text" || t === "character varying") return "sample-text";
  if (t.includes("timestamp")) return new Date().toISOString();
  if (t === "boolean") return true;
  if (["bigint", "integer", "smallint", "numeric"].includes(t)) return 1;
  if (t === "jsonb" || t === "json") return {};
  return "sample-text";
}

function argsFor(shape: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, type]) => [key, sampleValue(type)]),
  );
}

async function callRpc(
  fn: string,
  args: Record<string, unknown>,
  headers: Record<string, string>,
) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Profile": "public",
      ...headers,
    },
    body: JSON.stringify(args),
  });
}

// Captured from the local database on 2026-09-24 via:
//   select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
//   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
//   where n.nspname in ('public','graphql_public') and p.prokind = 'f'
//     and not has_function_privilege('anon', p.oid, 'execute');
// 48 rows. Every one of these previously segfaulted the database when
// called as anon with real-shaped parameters.
const LOCKED_FUNCTIONS: Array<{ name: string; args: Record<string, string> }> = [
  { name: "cancel_queued_media_job", args: { p_user_id: "uuid", p_job_id: "uuid" } },
  { name: "claim_expired_media_assets_for_deletion", args: { p_now: "timestamptz", p_limit: "integer" } },
  { name: "claim_media_job_by_id", args: { p_job_id: "uuid", p_lease_seconds: "integer" } },
  { name: "claim_media_jobs", args: { p_limit: "integer", p_lease_seconds: "integer" } },
  { name: "complete_media_asset_deletions", args: { p_asset_ids: "uuid[]", p_now: "timestamptz" } },
  { name: "create_profile_and_billing_account", args: {} },
  { name: "diagnostic_error_records_apply_retention", args: {} },
  {
    name: "diagnostic_report_admit_and_insert",
    args: {
      p_records: "jsonb",
      p_installation_id: "uuid",
      p_app_version: "text",
      p_build: "text",
      p_user_id: "uuid",
      p_received_at: "timestamptz",
    },
  },
  { name: "ensure_billing_account", args: { p_user_id: "uuid" } },
  { name: "extend_claimed_media_job_lease", args: { p_job_id: "uuid", p_claim_token: "uuid", p_lease_seconds: "integer" } },
  {
    name: "fail_claimed_media_output_asset",
    args: { p_job_id: "uuid", p_claim_token: "uuid", p_asset_id: "uuid", p_user_id: "uuid", p_metadata: "jsonb" },
  },
  {
    name: "fail_media_output_asset_attempt",
    args: {
      p_job_id: "uuid",
      p_asset_id: "uuid",
      p_user_id: "uuid",
      p_output_attempt_id: "text",
      p_storage_key: "text",
      p_metadata: "jsonb",
    },
  },
  { name: "finalize_expired_media_jobs_for_reconciliation", args: { p_now: "timestamptz", p_limit: "integer" } },
  { name: "find_media_jobs_for_trigger_reconciliation", args: { p_limit: "integer", p_now: "timestamptz" } },
  { name: "get_billing_balance", args: {} },
  {
    name: "grant_balance",
    args: {
      p_user_id: "uuid",
      p_amount_usd_micros: "bigint",
      p_source: "text",
      p_source_id: "text",
      p_kind: "text",
      p_metadata: "jsonb",
    },
  },
  {
    name: "grant_license",
    args: { p_user_id: "uuid", p_source: "text", p_source_id: "text", p_kind: "text", p_metadata: "jsonb" },
  },
  { name: "has_access", args: {} },
  { name: "has_active_license", args: {} },
  {
    name: "insert_ledger_entry",
    args: {
      p_account_id: "uuid",
      p_user_id: "uuid",
      p_kind: "text",
      p_amount_usd_micros: "bigint",
      p_source: "text",
      p_source_id: "text",
      p_metadata: "jsonb",
    },
  },
  { name: "license_cutoff", args: {} },
  {
    name: "mark_claimed_media_output_asset_ready",
    args: {
      p_job_id: "uuid",
      p_claim_token: "uuid",
      p_asset_id: "uuid",
      p_user_id: "uuid",
      p_download_expires_at: "timestamptz",
      p_metadata: "jsonb",
    },
  },
  {
    name: "mark_media_job_waiting_provider",
    args: { p_job_id: "uuid", p_claim_token: "uuid", p_provider_job_id: "text", p_progress: "jsonb" },
  },
  { name: "mark_subscription_checkout_session_completed", args: { p_stripe_checkout_session_id: "text" } },
  {
    name: "prepare_claimed_media_output_asset",
    args: {
      p_job_id: "uuid",
      p_claim_token: "uuid",
      p_asset_id: "uuid",
      p_user_id: "uuid",
      p_content_type: "text",
      p_size_bytes: "bigint",
      p_storage_key: "text",
      p_metadata: "jsonb",
    },
  },
  {
    name: "record_and_settle_claimed_media_job",
    args: {
      p_job_id: "uuid",
      p_claim_token: "uuid",
      p_final_cost_usd_micros: "bigint",
      p_output: "jsonb",
      p_metadata: "jsonb",
      p_usage_event: "jsonb",
    },
  },
  {
    name: "record_and_settle_reel_caption_job",
    args: { p_job_id: "uuid", p_final_cost_usd_micros: "bigint", p_output: "jsonb", p_metadata: "jsonb", p_usage_event: "jsonb" },
  },
  {
    name: "record_media_job_trigger_dispatch",
    args: { p_job_id: "uuid", p_run_id: "text", p_dispatch_source: "text", p_idempotency_key: "text", p_dispatched_at: "timestamptz" },
  },
  {
    name: "record_subscription",
    args: {
      p_user_id: "uuid",
      p_stripe_subscription_id: "text",
      p_stripe_customer_id: "text",
      p_status: "text",
      p_price_id: "text",
      p_trial_end: "timestamptz",
      p_current_period_end: "timestamptz",
      p_cancel_at_period_end: "boolean",
      p_last_event_at: "timestamptz",
      p_cancel_at: "timestamptz",
      p_metadata: "jsonb",
    },
  },
  {
    name: "record_subscription_checkout_session",
    args: {
      p_reservation_id: "uuid",
      p_user_id: "uuid",
      p_stripe_checkout_session_id: "text",
      p_stripe_checkout_url: "text",
      p_expires_at: "timestamptz",
      p_metadata: "jsonb",
    },
  },
  { name: "release_balance_reservation", args: { p_job_id: "uuid", p_status: "text", p_error: "text", p_metadata: "jsonb" } },
  {
    name: "release_claimed_media_job",
    args: { p_job_id: "uuid", p_claim_token: "uuid", p_status: "text", p_error: "text", p_metadata: "jsonb" },
  },
  { name: "release_media_asset_deletion_claims", args: { p_asset_ids: "uuid[]" } },
  { name: "reserve_balance", args: { p_user_id: "uuid", p_job_id: "uuid", p_amount_usd_micros: "bigint", p_metadata: "jsonb" } },
  { name: "reserve_subscription_checkout_session", args: { p_user_id: "uuid", p_stripe_customer_id: "text" } },
  {
    name: "reuse_claimed_media_output_asset",
    args: {
      p_job_id: "uuid",
      p_claim_token: "uuid",
      p_asset_id: "uuid",
      p_user_id: "uuid",
      p_content_type: "text",
      p_size_bytes: "bigint",
      p_storage_key: "text",
      p_metadata: "jsonb",
    },
  },
  { name: "revoke_license", args: { p_source: "text", p_source_id: "text", p_user_id: "uuid", p_reason: "text", p_metadata: "jsonb" } },
  { name: "settle_balance_reservation", args: { p_job_id: "uuid", p_final_cost_usd_micros: "bigint", p_output: "jsonb", p_metadata: "jsonb" } },
  {
    name: "settle_claimed_media_job",
    args: { p_job_id: "uuid", p_claim_token: "uuid", p_final_cost_usd_micros: "bigint", p_output: "jsonb", p_metadata: "jsonb" },
  },
  {
    name: "settle_flat_tool_call",
    args: { p_job_id: "uuid", p_operation: "text", p_final_cost_usd_micros: "bigint", p_raw_provider_cost: "numeric", p_metadata: "jsonb" },
  },
  {
    name: "start_flat_tool_call",
    args: {
      p_user_id: "uuid",
      p_provider: "text",
      p_model: "text",
      p_operation: "text",
      p_job_type: "text",
      p_amount_usd_micros: "bigint",
      p_input: "jsonb",
    },
  },
  { name: "sync_profile_email", args: {} },
  {
    name: "telemetry_admit_and_insert",
    args: { p_batch: "jsonb", p_user_id: "uuid", p_received_at: "timestamptz" },
  },
  { name: "telemetry_apply_retention", args: {} },
  { name: "trial_used", args: {} },
  { name: "user_has_access", args: { p_user_id: "uuid" } },
  { name: "user_has_active_license", args: { p_user_id: "uuid" } },
  { name: "user_trial_used", args: { p_user_id: "uuid" } },
];

// Granted to `authenticated` but not `anon`: the guard must not block these
// for a real signed-in user.
const AUTHENTICATED_ONLY_FUNCTIONS: Array<{ name: string; args: Record<string, string> }> = [
  { name: "get_billing_balance", args: {} },
  { name: "has_access", args: {} },
  { name: "license_cutoff", args: {} },
  { name: "trial_used", args: {} },
  { name: "user_has_access", args: { p_user_id: "uuid" } },
  { name: "user_has_active_license", args: { p_user_id: "uuid" } },
];

describeDb("pgrst_pre_request guard against supabase/postgres#2377", () => {
  let userId: string;
  let userAccessToken: string;
  let testStartedAt: string;

  beforeAll(async () => {
    // Deferred to beforeAll (not the describe body): describe.skip still
    // executes its callback to enumerate child tests, so anything that can
    // throw on missing env vars must live inside a hook or test body, or a
    // plain `pnpm test` run (no RUN_SUPABASE_DB_TESTS) fails the whole file
    // instead of skipping it.
    requireEnv();
    testStartedAt = new Date().toISOString();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // No password: this project's auth.email.enable_signup is false
    // (Google-only sign-in), so email/password login is rejected outright.
    // A bare admin-created user plus a locally-signed JWT (see
    // signAuthenticatedJwt above) is enough to exercise PostgREST's
    // `authenticated` role -- this test cares only about role resolution,
    // not the login flow.
    const email = `pre-request-guard-${randomUUID()}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("failed to create test user");
    userId = data.user.id;
    userAccessToken = signAuthenticatedJwt(userId);
  }, 30_000);

  afterAll(async () => {
    if (!userId) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(userId);
  });

  it.each(LOCKED_FUNCTIONS.map((fn) => [fn.name, fn] as const))(
    "blocks an anon call to locked function %s with 401 or 404, never 503",
    async (_name, fn) => {
      const response = await callRpc(fn.name, argsFor(fn.args), anonHeaders());
      expect(response.status).not.toBe(503);
      expect([401, 404]).toContain(response.status);
    },
  );

  it("blocks an encoded /rpc/ path (\"/%72pc/<fn>\") the same as the plain path", async () => {
    // PostgREST splits the raw path on literal "/" bytes, THEN
    // percent-decodes each segment -- "/%72pc/<fn>" (%72 = "r") routes as
    // an RPC call even though the raw path does not start with "/rpc/". A
    // guard that only regex-matched the raw path missed this entirely.
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/%72pc/telemetry_admit_and_insert`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Profile": "public",
          ...anonHeaders(),
        },
        body: JSON.stringify({ p_batch: {}, p_user_id: null, p_received_at: null }),
      },
    );
    expect(response.status).not.toBe(503);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("42501");
  });

  it("ignores Accept-Profile on a POST (wrong header for a write method), still blocks against public", async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/telemetry_admit_and_insert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Profile": "graphql_public",
        ...anonHeaders(),
      },
      body: JSON.stringify({ p_batch: {}, p_user_id: null, p_received_at: null }),
    });
    expect(response.status).not.toBe(503);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("42501");
  });

  it("ignores Content-Profile on a GET (wrong header for a read), never crosses into graphql_public", async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/telemetry_admit_and_insert`, {
      method: "GET",
      headers: { "Content-Profile": "graphql_public", ...anonHeaders() },
    });
    // public.telemetry_admit_and_insert does not exist in graphql_public,
    // so if the guard wrongly used Content-Profile here it would find no
    // match and do nothing; PostgREST's own (correct) resolution also
    // defaults to public for a GET with no Accept-Profile, and 404s on its
    // own since this function needs parameters GET can't supply as a body.
    // Either way, the one outcome that must never happen is a crash.
    expect(response.status).not.toBe(503);
    expect([401, 404]).toContain(response.status);
  });

  it("selects graphql_public via Accept-Profile on GET and does not block an anon-open function there", async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/graphql`, {
      method: "GET",
      headers: { "Accept-Profile": "graphql_public", ...anonHeaders() },
    });
    expect(response.status).not.toBe(503);
    if (response.status === 401) {
      const body = await response.json();
      expect(body.code).not.toBe("42501");
    }
  });

  it("selects graphql_public via Content-Profile on POST and does not block an anon-open function there", async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Profile": "graphql_public",
        ...anonHeaders(),
      },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    expect(response.status).not.toBe(503);
    if (response.status === 401) {
      const body = await response.json();
      expect(body.code).not.toBe("42501");
    }
  });

  it.each(AUTHENTICATED_ONLY_FUNCTIONS.map((fn) => [fn.name, fn] as const))(
    "still allows a signed-in user to call %s (not blocked by the guard)",
    async (_name, fn) => {
      const response = await callRpc(fn.name, argsFor(fn.args), {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userAccessToken}`,
      });
      expect(response.status).not.toBe(503);
      if (response.status === 401 || response.status === 403) {
        const body = await response.json();
        // A domain-level 401/403 from the function's own logic is fine;
        // the guard's own rejection (42501) is what must never appear here.
        expect(body.code).not.toBe("42501");
      } else {
        expect(response.status).toBe(200);
      }
    },
  );

  it("still allows service-role calls to the telemetry and diagnostics admit RPCs", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const installationId = randomUUID();
    const eventId = randomUUID();
    const telemetryResult = await admin.rpc("telemetry_admit_and_insert", {
      p_batch: {
        catalog_version: 1,
        batch_id: randomUUID(),
        events: [
          {
            event_id: eventId,
            catalog_version: 1,
            stream: "product",
            event_name: "app_lifecycle",
            occurred_at: new Date().toISOString(),
            source: "desktop",
            source_sequence: 1,
            host_observed_sequence: 1,
            installation_id: installationId,
            app_launch_id: randomUUID(),
            stage: "foregrounded",
            priority: 2,
            app: { version: "0.1.82", build: "182", environment: "development", release_channel: "internal" },
            system: { macos_major_minor: "15.6", architecture: "arm64" },
            properties: {},
          },
        ],
      },
      p_user_id: null,
      p_received_at: new Date().toISOString(),
    });
    expect(telemetryResult.error).toBeNull();
    expect(telemetryResult.data?.accepted).toContain(eventId);

    const recordId = randomUUID();
    const diagnosticsResult = await admin.rpc("diagnostic_report_admit_and_insert", {
      p_records: [
        {
          record_id: recordId,
          occurred_at: new Date().toISOString(),
          source: "turn",
          failure_site: "model_stream",
          errors: [{ name: "AI_APICallError", message: "guard smoke test" }],
        },
      ],
      p_installation_id: randomUUID(),
      p_app_version: "1.2.3",
      p_build: "456",
      p_user_id: null,
      p_received_at: new Date().toISOString(),
    });
    expect(diagnosticsResult.error).toBeNull();
    expect(diagnosticsResult.data?.accepted).toContain(recordId);
  });

  it("still admits a real batch through the telemetry-ingest and diagnostic-report edge functions end to end", async () => {
    const installationId = randomUUID();
    const eventId = randomUUID();
    const telemetryResponse = await fetch(`${SUPABASE_URL}/functions/v1/telemetry-ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...anonHeaders() },
      body: JSON.stringify({
        catalog_version: 1,
        batch_id: randomUUID(),
        events: [
          {
            event_id: eventId,
            catalog_version: 1,
            stream: "product",
            event_name: "app_lifecycle",
            occurred_at: new Date().toISOString(),
            source: "desktop",
            source_sequence: 1,
            host_observed_sequence: 1,
            installation_id: installationId,
            app_launch_id: randomUUID(),
            stage: "foregrounded",
            priority: 2,
            app: { version: "0.1.82", build: "182", environment: "development", release_channel: "internal" },
            system: { macos_major_minor: "15.6", architecture: "arm64" },
            properties: {},
          },
        ],
      }),
    });
    expect(telemetryResponse.status).toBe(200);
    const telemetryBody = await telemetryResponse.json();
    expect(telemetryBody.accepted).toContain(eventId);

    const recordId = randomUUID();
    const diagnosticResponse = await fetch(`${SUPABASE_URL}/functions/v1/diagnostic-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...anonHeaders() },
      body: JSON.stringify({
        schema_version: 1,
        installation_id: randomUUID(),
        app_version: "1.2.3",
        build: "456",
        records: [
          {
            record_id: recordId,
            occurred_at: new Date().toISOString(),
            source: "turn",
            failure_site: "model_stream",
            errors: [{ name: "AI_APICallError", message: "edge function guard smoke test" }],
          },
        ],
      }),
    });
    expect(diagnosticResponse.status).toBe(200);
    const diagnosticBody = await diagnosticResponse.json();
    expect(diagnosticBody.accepted).toContain(recordId);
  });

  it("produces zero segfaults in the database container logs during this run", () => {
    const sinceFlag = `--since ${testStartedAt}`;
    const logs = execSync(`docker logs ${DB_CONTAINER} ${sinceFlag} 2>&1`, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const segfaultLines = logs
      .split("\n")
      .filter((line) => /signal 11|segmentation fault/i.test(line));
    expect(segfaultLines).toEqual([]);
  });
});
