import { describe, expect, it, vi } from "vitest";

import type { DiagnosticIngestDependencies } from "../../supabase/functions/_shared/diagnostics/types.ts";
import { DIAGNOSTIC_MAX_BATCH_BYTES } from "../../supabase/functions/_shared/diagnostics/validation.ts";
import { handleDiagnosticReport } from "../../supabase/functions/diagnostic-report/handler.ts";

const INSTALLATION_ID = "30000000-0000-4000-8000-000000000001";
const RECORD_ID = "30000000-0000-4000-8000-000000000002";
const RECORD_ID_2 = "30000000-0000-4000-8000-000000000003";

function record(overrides: Record<string, unknown> = {}) {
  return {
    record_id: RECORD_ID,
    occurred_at: "2026-09-24T06:03:21.125Z",
    source: "turn",
    failure_site: "model_stream",
    errors: [{ name: "AI_APICallError", message: "request failed" }],
    ...overrides,
  };
}

function envelope(records: unknown[]) {
  return {
    schema_version: 1,
    installation_id: INSTALLATION_ID,
    app_version: "1.2.3",
    build: "456",
    records,
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://example.test/functions/v1/diagnostic-report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: "sb_publishable_fixture",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

// Mirrors the real RPC's per-record ON CONFLICT DO NOTHING semantics: every
// submitted id counts as accepted, whether newly inserted or already stored
// from an earlier delivery of the same record_id.
function fakeDatastore() {
  const stored = new Set<string>();
  const admitAndInsert = vi.fn(
    async (batch: { records: Array<{ record_id: string }> }) => {
      const ids = batch.records.map((r) => r.record_id);
      for (const id of ids) stored.add(id);
      return { accepted: ids, rejected: [], retry_after_ms: null };
    },
  );
  return { stored, admitAndInsert };
}

function dependencies(
  overrides: Partial<DiagnosticIngestDependencies> = {},
): DiagnosticIngestDependencies {
  return {
    resolveVerifiedUserId: vi.fn().mockResolvedValue(null),
    admitAndInsert: vi.fn().mockResolvedValue({
      accepted: [],
      rejected: [],
      retry_after_ms: null,
    }),
    now: () => new Date("2026-09-24T06:04:00.000Z"),
    ...overrides,
  };
}

describe("diagnostic-report ingest handler", () => {
  it("accepts a valid record end to end", async () => {
    const { admitAndInsert } = fakeDatastore();
    const deps = dependencies({ admitAndInsert });
    const response = await handleDiagnosticReport(
      request(envelope([record()])),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: [RECORD_ID],
      rejected: [],
      retry_after_ms: null,
    });
    expect(admitAndInsert).toHaveBeenCalledWith(
      {
        installation_id: INSTALLATION_ID,
        app_version: "1.2.3",
        build: "456",
        records: [record()],
      },
      null,
      new Date("2026-09-24T06:04:00.000Z"),
    );
  });

  it("rejects a bad record per-record without sinking its batch mates", async () => {
    const { admitAndInsert } = fakeDatastore();
    const deps = dependencies({ admitAndInsert });
    const good = record({ record_id: RECORD_ID });
    const bad = record({
      record_id: RECORD_ID_2,
      failure_site: "not_a_real_site",
    });
    const response = await handleDiagnosticReport(
      request(envelope([good, bad])),
      deps,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      accepted: [RECORD_ID],
      rejected: [{ record_id: RECORD_ID_2, reason: "invalid_schema" }],
      retry_after_ms: null,
    });
    expect(admitAndInsert).toHaveBeenCalledWith(
      expect.objectContaining({ records: [good] }),
      null,
      expect.any(Date),
    );
  });

  it("merges a DB-level per-record rejection with the TS-level rejections", async () => {
    // Simulates the exact-16384-byte boundary: validation.ts accepted the
    // record, but the RPC's own per-record exception handling rejected it
    // (e.g. the row-size CHECK) without sinking the rest of the batch.
    const good = record({ record_id: RECORD_ID });
    const dbRejected = record({ record_id: RECORD_ID_2 });
    const tsRejected = record({
      record_id: "30000000-0000-4000-8000-000000000004",
      failure_site: "not_a_real_site",
    });
    const admitAndInsert = vi.fn().mockResolvedValue({
      accepted: [RECORD_ID],
      rejected: [{ record_id: RECORD_ID_2, reason: "payload_too_large" }],
      retry_after_ms: null,
    });
    const deps = dependencies({ admitAndInsert });
    const response = await handleDiagnosticReport(
      request(envelope([good, dbRejected, tsRejected])),
      deps,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toEqual([RECORD_ID]);
    expect(body.rejected).toEqual(
      expect.arrayContaining([
        {
          record_id: "30000000-0000-4000-8000-000000000004",
          reason: "invalid_schema",
        },
        { record_id: RECORD_ID_2, reason: "payload_too_large" },
      ]),
    );
    expect(body.rejected).toHaveLength(2);
    // Only the TS-accepted records (good + dbRejected) reach the RPC.
    expect(admitAndInsert).toHaveBeenCalledWith(
      expect.objectContaining({ records: [good, dbRejected] }),
      null,
      expect.any(Date),
    );
  });

  it("does not call admitAndInsert when every record is rejected", async () => {
    const admitAndInsert = vi.fn();
    const deps = dependencies({ admitAndInsert });
    const bad = record({ failure_site: "not_a_real_site" });
    const response = await handleDiagnosticReport(
      request(envelope([bad])),
      deps,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toHaveLength(1);
    expect(body.retry_after_ms).toBeNull();
    expect(admitAndInsert).not.toHaveBeenCalled();
  });

  it("rejects a NUL byte per record end to end, never reaching admitAndInsert with it", async () => {
    // JSON.parse turns the wire's \u0000 escape into a real embedded NUL
    // character in the JS string, which jsonb cannot store -- validation.ts
    // must catch this before the record is ever handed to admitAndInsert.
    const { admitAndInsert } = fakeDatastore();
    const deps = dependencies({ admitAndInsert });
    const good = record({ record_id: RECORD_ID });
    const nulRecord = record({
      record_id: RECORD_ID_2,
      errors: [{ name: "x", message: "before\u0000after" }],
    });
    const response = await handleDiagnosticReport(
      request(envelope([good, nulRecord])),
      deps,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toEqual([RECORD_ID]);
    expect(body.rejected).toEqual([
      { record_id: RECORD_ID_2, reason: "invalid_schema" },
    ]);
    expect(admitAndInsert).toHaveBeenCalledWith(
      expect.objectContaining({ records: [good] }),
      null,
      expect.any(Date),
    );
  });

  it("is idempotent across two deliveries of the same record_id", async () => {
    const { admitAndInsert, stored } = fakeDatastore();
    const deps = dependencies({ admitAndInsert });

    const first = await handleDiagnosticReport(
      request(envelope([record()])),
      deps,
    );
    expect(await first.json()).toEqual({
      accepted: [RECORD_ID],
      rejected: [],
      retry_after_ms: null,
    });
    expect(stored.size).toBe(1);

    // Client retries the exact same record (e.g. it never saw the first
    // response and did not clear its local queue).
    const second = await handleDiagnosticReport(
      request(envelope([record()])),
      deps,
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      accepted: [RECORD_ID],
      rejected: [],
      retry_after_ms: null,
    });
    expect(stored.size).toBe(1);
    expect(admitAndInsert).toHaveBeenCalledTimes(2);
  });

  it("returns 429 with a Retry-After header when the batch would exceed the rate limit", async () => {
    const admitAndInsert = vi.fn().mockResolvedValue({
      accepted: [],
      rejected: [],
      retry_after_ms: 600_000,
    });
    const deps = dependencies({ admitAndInsert });
    const response = await handleDiagnosticReport(
      request(envelope([record()])),
      deps,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    expect(await response.json()).toEqual({
      accepted: [],
      rejected: [],
      retry_after_ms: 600_000,
    });
  });

  it("returns 400 for a malformed envelope without calling admitAndInsert", async () => {
    const admitAndInsert = vi.fn();
    const deps = dependencies({ admitAndInsert });
    const response = await handleDiagnosticReport(
      request({
        schema_version: 2,
        installation_id: INSTALLATION_ID,
        app_version: "1.2.3",
        build: "456",
        records: [record()],
      }),
      deps,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      accepted: [],
      rejected: [],
      retry_after_ms: null,
    });
    expect(admitAndInsert).not.toHaveBeenCalled();
  });

  it("returns 400 for an unparseable body", async () => {
    const deps = dependencies();
    const response = await handleDiagnosticReport(
      new Request("https://example.test/functions/v1/diagnostic-report", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: "sb_publishable_fixture" },
        body: "{not json",
      }),
      deps,
    );
    expect(response.status).toBe(400);
  });

  it("returns 413 for an oversized body", async () => {
    const admitAndInsert = vi.fn();
    const deps = dependencies({ admitAndInsert });
    const response = await handleDiagnosticReport(
      request(envelope([record()]), {
        "Content-Length": String(DIAGNOSTIC_MAX_BATCH_BYTES + 1),
      }),
      deps,
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      accepted: [],
      rejected: [],
      retry_after_ms: null,
    });
    expect(admitAndInsert).not.toHaveBeenCalled();
  });

  it("returns 401 when identity resolution rejects", async () => {
    const deps = dependencies({
      resolveVerifiedUserId: vi.fn().mockRejectedValue(new Error("unauthorized")),
    });
    const response = await handleDiagnosticReport(
      request(envelope([record()])),
      deps,
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 with neither an authorization header nor an apikey", async () => {
    const deps = dependencies();
    const response = await handleDiagnosticReport(
      new Request("https://example.test/functions/v1/diagnostic-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope([record()])),
      }),
      deps,
    );
    expect(response.status).toBe(401);
  });

  it("resolves a verified user JWT to a non-null userId passed through to admitAndInsert", async () => {
    const { admitAndInsert } = fakeDatastore();
    const deps = dependencies({
      admitAndInsert,
      resolveVerifiedUserId: vi.fn().mockResolvedValue("user-123"),
    });
    const response = await handleDiagnosticReport(
      request(envelope([record()]), { Authorization: "Bearer user-jwt" }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(admitAndInsert).toHaveBeenCalledWith(
      expect.any(Object),
      "user-123",
      expect.any(Date),
    );
  });

  it("supports OPTIONS and rejects non-POST methods", async () => {
    const deps = dependencies();
    const options = await handleDiagnosticReport(
      new Request("https://example.test/functions/v1/diagnostic-report", {
        method: "OPTIONS",
      }),
      deps,
    );
    expect(options.status).toBe(200);

    const get = await handleDiagnosticReport(
      new Request("https://example.test/functions/v1/diagnostic-report", {
        method: "GET",
      }),
      deps,
    );
    expect(get.status).toBe(405);
  });
});
