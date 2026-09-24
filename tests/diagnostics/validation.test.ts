import { describe, expect, it } from "vitest";

import type { DiagnosticRecordV1 } from "../../supabase/functions/_shared/diagnostics/types.ts";
import {
  DIAGNOSTIC_MAX_BATCH_BYTES,
  DIAGNOSTIC_MAX_RECORD_BYTES,
  validateDiagnosticRecord,
  validateDiagnosticReportBatch,
} from "../../supabase/functions/_shared/diagnostics/validation.ts";

const UUIDS = {
  installation: "20000000-0000-4000-8000-000000000001",
  record: "20000000-0000-4000-8000-000000000002",
  record2: "20000000-0000-4000-8000-000000000003",
  wovenJob: "20000000-0000-4000-8000-000000000004",
  chat: "20000000-0000-4000-8000-000000000005",
};

function record(
  overrides: Partial<DiagnosticRecordV1> = {},
): DiagnosticRecordV1 {
  return {
    record_id: UUIDS.record,
    occurred_at: "2026-09-24T06:03:21.125Z",
    source: "turn",
    failure_site: "model_stream",
    errors: [{ name: "AI_APICallError", message: "request failed" }],
    ...overrides,
  };
}

function envelope(
  records: unknown[] = [record()],
  overrides: Record<string, unknown> = {},
) {
  return {
    schema_version: 1,
    installation_id: UUIDS.installation,
    app_version: "1.2.3",
    build: "456",
    records,
    ...overrides,
  };
}

function bytesOf(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validate(value: unknown, bytes?: number) {
  return validateDiagnosticReportBatch(value, bytes ?? bytesOf(value));
}

describe("diagnostic-report v1 validation", () => {
  it("accepts a minimal valid record", () => {
    const result = validate(envelope());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toEqual([record()]);
    expect(result.rejected).toEqual([]);
  });

  it("accepts every optional field with a valid value", () => {
    const full = record({
      error_class: "network",
      http_status: 503,
      native_error_domain: "avfoundation",
      native_error_code: -11829,
      code_site: "compaction/summarizer.ts:228",
      woven_job_id: UUIDS.wovenJob,
      chat_id: UUIDS.chat,
      turn_id: UUIDS.chat,
      operation_id: UUIDS.chat,
      model_id: "woven:openai/gpt-5.6-sol",
      errors: [
        {
          name: "AI_APICallError",
          message: "request failed",
          response_body: "{}",
          detail: "extra detail",
        },
      ],
    });
    const result = validate(envelope([full]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toEqual([full]);
    expect(result.rejected).toEqual([]);
  });

  it("returns 400 for a malformed envelope", () => {
    const cases: unknown[] = [
      envelope([record()], { schema_version: 2 }),
      envelope([record()], { installation_id: "not-a-uuid" }),
      envelope([record()], { app_version: "bad" }),
      envelope([record()], { build: "bad-build" }),
      envelope([]),
      envelope(Array.from({ length: 21 }, () => record())),
      { ...envelope(), surprise: true },
      "not-an-object",
      null,
    ];
    for (const bad of cases) {
      const result = validate(bad);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.status).toBe(400);
      expect(result.response).toEqual({
        accepted: [],
        rejected: [],
        retry_after_ms: null,
      });
    }
  });

  it("returns 413 when the encoded batch exceeds the byte cap", () => {
    const result = validate(envelope(), DIAGNOSTIC_MAX_BATCH_BYTES + 1);
    expect(result).toEqual({
      ok: false,
      status: 413,
      response: { accepted: [], rejected: [], retry_after_ms: null },
    });
  });

  it("rejects a bad record without sinking its batch mates", () => {
    const good = record({ record_id: UUIDS.record });
    const bad = record({
      record_id: UUIDS.record2,
      failure_site: "not_a_real_site",
    });
    const result = validate(envelope([good, bad]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toEqual([good]);
    expect(result.rejected).toEqual([
      { record_id: UUIDS.record2, reason: "invalid_schema" },
    ]);
  });

  it("rejects a duplicate record_id within one batch, keeping only the first", () => {
    const first = record({ record_id: UUIDS.record });
    const duplicate = record({
      record_id: UUIDS.record,
      failure_site: "export_render",
    });
    const result = validate(envelope([first, duplicate]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toEqual([first]);
    expect(result.rejected).toEqual([
      { record_id: UUIDS.record, reason: "invalid_schema" },
    ]);
  });

  it("treats an uppercase and lowercase spelling of the same UUID as a duplicate", () => {
    const first = record({ record_id: UUIDS.record.toUpperCase() });
    const duplicate = record({
      record_id: UUIDS.record,
      failure_site: "export_render",
    });
    const result = validate(envelope([first, duplicate]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toEqual([first]);
    expect(result.rejected).toEqual([
      { record_id: UUIDS.record, reason: "invalid_schema" },
    ]);
  });

  it.each([
    ["a non-UUID record_id", { record_id: "not-a-uuid" }],
    ["an invalid occurred_at", { occurred_at: "not-a-date" }],
    ["an unknown source", { source: "not_a_source" }],
    ["an unknown failure_site", { failure_site: "not_a_real_site" }],
    ["an unknown error_class", { error_class: "mystery" }],
    ["an out-of-range http_status", { http_status: 999 }],
    ["an unknown native_error_domain", { native_error_domain: "mystery" }],
    ["a code_site with a space", { code_site: "compaction/summarizer.ts: 228" }],
    ["a code_site with a leading /Users/ path", { code_site: "/Users/x/f.ts:1" }],
    ["a non-UUID woven_job_id", { woven_job_id: "not-a-uuid" }],
    ["a non-UUID chat_id", { chat_id: "not-a-uuid" }],
    ["a malformed model_id", { model_id: "bad model id!" }],
    ["an unknown record key", { extra_key: "nope" }],
    ["zero errors", { errors: [] }],
    [
      "more than 4 errors",
      {
        errors: Array.from({ length: 5 }, () => ({ name: "x", message: "y" })),
      },
    ],
    ["an error with an empty name", { errors: [{ name: "", message: "y" }] }],
    [
      "an error name over 128 chars",
      { errors: [{ name: "x".repeat(129), message: "y" }] },
    ],
    [
      "an error message over 2000 chars",
      { errors: [{ name: "x", message: "y".repeat(2_001) }] },
    ],
    [
      "an unknown error entry key",
      { errors: [{ name: "x", message: "y", extra: "z" }] },
    ],
    [
      "a NUL byte in the error message",
      { errors: [{ name: "x", message: "before\0after" }] },
    ],
    [
      "a NUL byte in the error name",
      { errors: [{ name: "bad\0name", message: "y" }] },
    ],
    [
      "an unpaired high surrogate in the error message",
      { errors: [{ name: "x", message: "before\uD800after" }] },
    ],
    [
      "an unpaired low surrogate in response_body",
      {
        errors: [
          { name: "x", message: "y", response_body: "before\uDC00after" },
        ],
      },
    ],
    [
      "a NUL byte in detail",
      { errors: [{ name: "x", message: "y", detail: "before\0after" }] },
    ],
  ] as const)("rejects a record with %s", (_label, overrides) => {
    const result = validateDiagnosticRecord(
      record(overrides as Partial<DiagnosticRecordV1>),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_schema" });
  });

  it.each([
    ["compaction/summarizer.ts:278"],
    ["WovenHarness/NativeReelExporter.swift:412"],
  ] as const)("accepts a valid code_site value %s", (codeSite) => {
    const result = validateDiagnosticRecord(record({ code_site: codeSite }));
    expect(result.ok).toBe(true);
  });

  it.each([
    ["../a.ts:1"],
    ["a/./b.ts:1"],
    ["Users/n/projects/w/f.ts:1"],
    ["a.ts"],
    ["a.txt:1"],
  ] as const)("rejects the code_site value %s", (codeSite) => {
    const result = validateDiagnosticRecord(record({ code_site: codeSite }));
    expect(result).toEqual({ ok: false, reason: "invalid_schema" });
  });

  it("accepts an empty message, response_body, and detail (e.g. `new Error()`)", () => {
    const result = validateDiagnosticRecord(
      record({
        errors: [
          { name: "Error", message: "", response_body: "", detail: "" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.errors).toEqual([
      { name: "Error", message: "", response_body: "", detail: "" },
    ]);
  });

  it("accepts a native_error_code below zero, such as -11829", () => {
    const result = validateDiagnosticRecord(
      record({ native_error_domain: "avfoundation", native_error_code: -11829 }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a single record over the 16 KB per-record cap as payload_too_large", () => {
    const oversized = record({
      errors: Array.from({ length: 4 }, () => ({
        name: "x",
        message: "y".repeat(2_000),
        response_body: "z".repeat(2_000),
        detail: "w".repeat(2_000),
      })),
    });
    expect(bytesOf(oversized)).toBeGreaterThan(DIAGNOSTIC_MAX_RECORD_BYTES);
    const result = validateDiagnosticRecord(oversized);
    expect(result).toEqual({ ok: false, reason: "payload_too_large" });
  });
});
