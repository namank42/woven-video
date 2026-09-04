import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  catalogFixtureV1,
  TELEMETRY_CATALOG_V1,
} from "../../supabase/functions/_shared/telemetry/catalog.ts";
import type {
  TelemetryBatchRequestV1,
  TelemetryEnvelopeV1,
  TelemetryRejectionReason,
} from "../../supabase/functions/_shared/telemetry/types.ts";
import {
  TELEMETRY_MAX_BATCH_BYTES,
  TELEMETRY_MAX_BATCH_EVENTS,
  TELEMETRY_MAX_EVENT_BYTES,
  validateTelemetryBatch,
} from "../../supabase/functions/_shared/telemetry/validation.ts";

const UUIDS = {
  batch: "10000000-0000-4000-8000-000000000001",
  product: "10000000-0000-4000-8000-000000000002",
  operational: "10000000-0000-4000-8000-000000000003",
  installation: "10000000-0000-4000-8000-000000000004",
  launch: "10000000-0000-4000-8000-000000000005",
  operation: "10000000-0000-4000-8000-000000000006",
  incident: "10000000-0000-4000-8000-000000000007",
};

function productEvent(
  overrides: Partial<TelemetryEnvelopeV1> = {},
): TelemetryEnvelopeV1 {
  return {
    event_id: UUIDS.product,
    catalog_version: 1,
    stream: "product",
    event_name: "app_lifecycle",
    occurred_at: "2026-09-04T06:03:21.125Z",
    source: "desktop",
    source_sequence: 1,
    host_observed_sequence: 1,
    installation_id: UUIDS.installation,
    app_launch_id: UUIDS.launch,
    operation_id: UUIDS.operation,
    stage: "foregrounded",
    priority: 2,
    app: {
      version: "0.1.82",
      build: "182",
      environment: "production",
      release_channel: "stable",
    },
    system: { macos_major_minor: "15.6", architecture: "arm64" },
    properties: {},
    ...overrides,
  };
}

function operationalEvent(
  overrides: Partial<TelemetryEnvelopeV1> = {},
): TelemetryEnvelopeV1 {
  return productEvent({
    event_id: UUIDS.operational,
    stream: "operational",
    event_name: "telemetry_delivery_summary",
    stage: "reported",
    priority: 3,
    properties: {
      recorded_count: 12,
      accepted_count: 10,
      permanently_rejected_count: 1,
      dropped_count: 1,
    },
    ...overrides,
  });
}

function batch(events: TelemetryEnvelopeV1[]): TelemetryBatchRequestV1 {
  return { catalog_version: 1, batch_id: UUIDS.batch, events };
}

function validate(value: unknown, bytes?: number) {
  return validateTelemetryBatch(
    value,
    bytes ?? new TextEncoder().encode(JSON.stringify(value)).byteLength,
  );
}

function expectRejected(
  value: unknown,
  reason: TelemetryRejectionReason,
  status: 400 | 413 = 400,
  bytes?: number,
) {
  const result = validate(value, bytes);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.status).toBe(status);
  expect(result.response.accepted).toEqual([]);
  expect(result.response.rejected[0]?.reason).toBe(reason);
  expect(result.response.rejected[0]?.permanent).toBe(true);
  expect(result.response.retry_after_ms).toBeNull();
}

describe("desktop telemetry v1 validation", () => {
  it("accepts a valid mixed product and operational batch", () => {
    const value = batch([productEvent(), operationalEvent()]);
    expect(validate(value)).toEqual({ ok: true, batch: value });
  });

  it("rejects duplicate event IDs within one batch", () => {
    expectRejected(
      batch([productEvent(), operationalEvent({ event_id: UUIDS.product })]),
      "invalid_schema",
    );
  });

  it("returns a permanent disposition for every event when a batch is invalid", () => {
    const validPeer = productEvent();
    const privacyInvalidPeer = operationalEvent({
      properties: {
        ...operationalEvent().properties,
        output: "must never be stored",
      },
    });

    const result = validate(batch([validPeer, privacyInvalidPeer]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.accepted).toEqual([]);
    expect(result.response.rejected).toEqual([
      {
        event_id: validPeer.event_id,
        reason: "privacy_violation",
        permanent: true,
      },
      {
        event_id: privacyInvalidPeer.event_id,
        reason: "privacy_violation",
        permanent: true,
      },
    ]);
  });

  it("rejects batches spanning more than one installation", () => {
    expectRejected(
      batch([
        productEvent(),
        operationalEvent({
          installation_id: "10000000-0000-4000-8000-000000000099",
        }),
      ]),
      "invalid_schema",
    );
  });

  it("rejects unknown event names and wrong-stream event names", () => {
    expectRejected(
      batch([productEvent({ event_name: "not_catalogued" })]),
      "unknown_event",
    );
    expectRejected(
      batch([productEvent({ stream: "operational" })]),
      "unknown_event",
    );
  });

  it("rejects unknown envelope, app, system, and property keys", () => {
    expectRejected(
      batch([{ ...productEvent(), surprise: true } as TelemetryEnvelopeV1]),
      "invalid_schema",
    );
    expectRejected(
      batch([
        productEvent({
          app: {
            ...productEvent().app,
            surprise: "x",
          } as TelemetryEnvelopeV1["app"],
        }),
      ]),
      "invalid_schema",
    );
    expectRejected(
      batch([
        productEvent({
          system: {
            ...productEvent().system,
            surprise: "x",
          } as TelemetryEnvelopeV1["system"],
        }),
      ]),
      "invalid_schema",
    );
    expectRejected(
      batch([productEvent({ properties: { surprise: true } })]),
      "invalid_schema",
    );
  });

  it.each([
    "prompt",
    "response",
    "reasoning",
    "feedback",
    "transcript",
    "path",
    "url",
    "host",
    "args",
    "output",
    "error_message",
    "stack",
    "log",
    "command",
    "cookie",
    "api_key",
    "authorization_header",
    "attachment_base64",
  ])("rejects privacy-sensitive property key %s", (key) => {
    expectRejected(
      batch([productEvent({ properties: { [key]: "secret-value" } })]),
      "privacy_violation",
    );
  });

  it.each(
    [
      ["file path", "file:///Users/private/secret.txt", "privacy_violation"],
      ["URL", "https://private.example.test/project", "privacy_violation"],
      ["host name", "api.private.example.com", "privacy_violation"],
      ["file name", "private-project.json", "privacy_violation"],
      ["workspace name", "Confidential Client Launch", "invalid_schema"],
      ["token-shaped secret", "sk-proj-1234567890abcdef", "privacy_violation"],
    ] as const,
  )(
    "rejects %s submitted as an arbitrary taxonomy value",
    (_label, value, reason) => {
      expectRejected(
        batch([productEvent({ properties: { launch_reason: value } })]),
        reason,
      );
    },
  );

  it("requires arbitrary setting values to be irreversibly content-free", () => {
    expectRejected(
      batch([
        productEvent({
          event_name: "setting_change",
          stage: "committed",
          priority: 3,
          properties: {
            setting_id: "default_workspace",
            selected_value: "client_launch_workspace",
          },
        }),
      ]),
      "invalid_schema",
    );
  });

  it("applies content safety to taxonomy arrays", () => {
    expectRejected(
      batch([
        operationalEvent({
          event_name: "turn_summary",
          stage: "succeeded",
          priority: 1,
          properties: { tool_sequence: ["read", "file:///private/input"] },
        }),
      ]),
      "privacy_violation",
    );
  });

  it.each(
    [
      ["version", "file:///Users/private/Woven.app", "privacy_violation"],
      ["version", "Confidential Client Build", "invalid_schema"],
      ["build", "sk-proj-1234567890abcdef", "privacy_violation"],
    ] as const,
  )(
    "rejects content-bearing app %s values",
    (field, value, reason) => {
      expectRejected(
        batch([
          productEvent({
            app: { ...productEvent().app, [field]: value },
          }),
        ]),
        reason,
      );
    },
  );

  it("rejects oversized scalars, arrays, and individual events", () => {
    expectRejected(
      batch([
        productEvent({
          app: { ...productEvent().app, version: "x".repeat(65) },
        }),
      ]),
      "invalid_schema",
    );
    expectRejected(
      batch([
        operationalEvent({
          properties: {
            ...operationalEvent().properties,
            dropped_priorities: Array.from({ length: 33 }, (_, index) => index),
          },
        }),
      ]),
      "invalid_schema",
    );
    const oversized = productEvent({
      app: {
        ...productEvent().app,
        version: "x".repeat(TELEMETRY_MAX_EVENT_BYTES),
      },
    });
    expectRejected(batch([oversized]), "invalid_schema");
  });

  it("rejects free-form content in taxonomy string properties", () => {
    expectRejected(
      batch([
        productEvent({
          properties: { launch_reason: "opened my secret project" },
        }),
      ]),
      "invalid_schema",
    );
  });

  it("enforces the event count and encoded batch byte limits", () => {
    const events = Array.from(
      { length: TELEMETRY_MAX_BATCH_EVENTS + 1 },
      (_, index) =>
        productEvent({
          event_id: `10000000-0000-4000-8000-${
            String(index + 100).padStart(12, "0")
          }`,
          source_sequence: index + 1,
          host_observed_sequence: index + 1,
        }),
    );
    expectRejected(batch(events), "invalid_schema");
    expectRejected(
      batch([productEvent()]),
      "invalid_schema",
      413,
      TELEMETRY_MAX_BATCH_BYTES + 1,
    );
  });

  it("rejects malformed identifiers, timestamps, sequences, and safe hashes", () => {
    for (
      const key of [
        "event_id",
        "installation_id",
        "app_launch_id",
        "workspace_id",
        "chat_id",
        "operation_id",
        "turn_id",
        "incident_id",
        "tool_call_id",
      ] as const
    ) {
      expectRejected(
        batch([productEvent({ [key]: "not-a-uuid" })]),
        "invalid_schema",
      );
    }
    expectRejected(
      batch([productEvent({ occurred_at: "September 4" })]),
      "invalid_schema",
    );
    expectRejected(
      batch([productEvent({ occurred_at: "2026-02-31T00:00:00Z" })]),
      "invalid_schema",
    );
    expectRejected(
      batch([productEvent({ source_sequence: -1 })]),
      "invalid_schema",
    );
    expectRejected(
      batch([
        operationalEvent({
          event_name: "storage_incident",
          stage: "failed",
          priority: 0,
          incident_id: UUIDS.incident,
          properties: {
            error_domain: "storage",
            error_code: "write_failed",
            component: "chat_store",
            phase: "persist",
            severity: "error",
            user_visible: true,
            retryable: true,
            transient: false,
            error_fingerprint: "not-a-sha256",
          },
        }),
      ]),
      "invalid_schema",
    );
  });

  it("exports every catalog entry to the canonical fixture exactly", () => {
    const entries = Object.values(TELEMETRY_CATALOG_V1);
    expect(entries).toHaveLength(57);
    expect(entries.filter((entry) => entry.stream === "product")).toHaveLength(
      46,
    );
    expect(
      entries.filter((entry) => entry.stream === "operational"),
    ).toHaveLength(11);
    const fixturePath = join(
      process.cwd(),
      "tests/fixtures/telemetry/catalog-v1.json",
    );
    expect(existsSync(fixturePath)).toBe(true);
    const expected = `${JSON.stringify(catalogFixtureV1)}\n`;
    expect(readFileSync(fixturePath, "utf8")).toBe(expected);
  });
});
