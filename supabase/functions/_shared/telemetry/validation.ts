import { TELEMETRY_CATALOG_V1, type TelemetryPropertyRule } from "./catalog.ts";
import type {
  TelemetryBatchRequestV1,
  TelemetryRejectionReason,
  TelemetryValidationResult,
} from "./types.ts";

export const TELEMETRY_MAX_BATCH_BYTES = 65_536;
export const TELEMETRY_MAX_EVENT_BYTES = 16_384;
export const TELEMETRY_MAX_BATCH_EVENTS = 50;
export const TELEMETRY_MAX_ARRAY_ITEMS = 32;
export const TELEMETRY_MAX_STRING_LENGTH = 128;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/;
const hashPattern = /^[0-9a-f]{64}$/;
const macOSPattern = /^\d{1,2}\.\d{1,2}$/;
const safeTextPattern = /^[\x20-\x7e]+$/;
const appVersionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const appBuildPattern = /^\d{1,32}$/;

const batchKeys = ["batch_id", "catalog_version", "events"];
const eventRequiredKeys = [
  "app",
  "app_launch_id",
  "catalog_version",
  "event_id",
  "event_name",
  "host_observed_sequence",
  "installation_id",
  "occurred_at",
  "priority",
  "properties",
  "source",
  "source_sequence",
  "stage",
  "stream",
  "system",
];
const eventOptionalKeys = [
  "chat_id",
  "incident_id",
  "operation_id",
  "tool_call_id",
  "turn_id",
  "workspace_id",
];
const appKeys = ["build", "environment", "release_channel", "version"];
const systemKeys = ["architecture", "macos_major_minor"];
const forbiddenKeyTokens = [
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
  "environment_value",
  "auth",
  "cookie",
  "api_key",
  "header",
  "attachment_bytes",
  "base64",
  "image",
  "audio",
  "video",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function safeEventId(value: unknown): string {
  if (
    isRecord(value) && typeof value.event_id === "string" &&
    uuidPattern.test(value.event_id)
  ) {
    return value.event_id;
  }
  return "00000000-0000-4000-8000-000000000000";
}

function rejectedResult(
  status: 400 | 413,
  events: unknown[],
  reason: TelemetryRejectionReason,
): TelemetryValidationResult {
  const submitted = events.length > 0 ? events : [{}];
  return {
    ok: false,
    status,
    response: {
      accepted: [],
      rejected: submitted.map((event) => ({
        event_id: safeEventId(event),
        reason,
        permanent: reason !== "rate_limited",
      })),
      retry_after_ms: null,
    },
  };
}

function isBoundedString(
  value: unknown,
  maxLength = TELEMETRY_MAX_STRING_LENGTH,
) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maxLength &&
    safeTextPattern.test(value);
}

function isValidTimestamp(value: string) {
  const match = timestampPattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

function propertyRejection(
  value: unknown,
  rule: TelemetryPropertyRule,
): TelemetryRejectionReason | null {
  if (rule.type === "string") {
    if (!isBoundedString(value)) return "invalid_schema";
    if (rule.hash) {
      return hashPattern.test(value as string) ? null : "invalid_schema";
    }
    return rule.enum?.includes(value as string) ? null : "invalid_schema";
  }
  if (rule.type === "boolean") {
    return typeof value === "boolean" ? null : "invalid_schema";
  }
  if (rule.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "invalid_schema";
    }
    if (rule.integer && !Number.isSafeInteger(value)) return "invalid_schema";
    if (rule.min !== undefined && value < rule.min) return "invalid_schema";
    if (rule.max !== undefined && value > rule.max) return "invalid_schema";
    return null;
  }
  if (!Array.isArray(value) || value.length > TELEMETRY_MAX_ARRAY_ITEMS) {
    return "invalid_schema";
  }
  if (rule.type === "string_array") {
    if (!rule.enum) return "invalid_schema";
    for (const item of value) {
      if (!isBoundedString(item) || !rule.enum.includes(item as string)) {
        return "invalid_schema";
      }
    }
    return null;
  }
  return value.every((item) => Number.isSafeInteger(item) && item >= 0)
    ? null
    : "invalid_schema";
}

function validateEvent(value: unknown): TelemetryRejectionReason | null {
  if (!isRecord(value)) return "invalid_schema";
  if (safeEventId(value) !== value.event_id) return "invalid_schema";
  if (!hasExactKeys(value, eventRequiredKeys, eventOptionalKeys)) {
    return "invalid_schema";
  }
  if (value.catalog_version !== 1) return "invalid_schema";
  if (typeof value.event_name !== "string") return "unknown_event";
  const catalog = TELEMETRY_CATALOG_V1[value.event_name];
  if (!catalog || catalog.stream !== value.stream) return "unknown_event";
  if (
    !catalog.stages.includes(value.stage as string) ||
    value.priority !== catalog.priority
  ) {
    return "invalid_schema";
  }
  if (value.source !== "desktop" && value.source !== "sidecar") {
    return "invalid_schema";
  }
  if (
    !Number.isSafeInteger(value.source_sequence) ||
    (value.source_sequence as number) < 0 ||
    !Number.isSafeInteger(value.host_observed_sequence) ||
    (value.host_observed_sequence as number) < 0
  ) {
    return "invalid_schema";
  }
  if (
    typeof value.occurred_at !== "string" ||
    !isValidTimestamp(value.occurred_at)
  ) {
    return "invalid_schema";
  }
  for (
    const key of ["installation_id", "app_launch_id", ...eventOptionalKeys]
  ) {
    if (
      Object.hasOwn(value, key) &&
      (typeof value[key] !== "string" ||
        !uuidPattern.test(value[key] as string))
    ) {
      return "invalid_schema";
    }
  }
  if (!isRecord(value.app) || !hasExactKeys(value.app, appKeys)) {
    return "invalid_schema";
  }
  if (
    !isBoundedString(value.app.version, 64) ||
    !appVersionPattern.test(value.app.version as string) ||
    !isBoundedString(value.app.build, 32) ||
    !appBuildPattern.test(value.app.build as string) ||
    !["development", "beta", "production"].includes(
      value.app.environment as string,
    ) ||
    !["internal", "beta", "stable"].includes(
      value.app.release_channel as string,
    )
  ) {
    return "invalid_schema";
  }
  if (!isRecord(value.system) || !hasExactKeys(value.system, systemKeys)) {
    return "invalid_schema";
  }
  if (
    typeof value.system.macos_major_minor !== "string" ||
    !macOSPattern.test(value.system.macos_major_minor) ||
    !["arm64", "x86_64", "other"].includes(value.system.architecture as string)
  ) {
    return "invalid_schema";
  }
  if (!isRecord(value.properties)) return "invalid_schema";
  const properties = value.properties;
  const rules = {
    ...catalog.requiredProperties,
    ...catalog.optionalProperties,
  };
  for (const key of Object.keys(properties)) {
    const normalized = key.toLowerCase();
    if (forbiddenKeyTokens.some((token) => normalized.includes(token))) {
      return "privacy_violation";
    }
    if (!Object.hasOwn(rules, key)) {
      return "invalid_schema";
    }
    const rejection = propertyRejection(properties[key], rules[key]);
    if (rejection) return rejection;
  }
  if (
    !Object.keys(catalog.requiredProperties).every((key) =>
      Object.hasOwn(properties, key)
    )
  ) {
    return "invalid_schema";
  }
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
      TELEMETRY_MAX_EVENT_BYTES
  ) {
    return "invalid_schema";
  }
  return null;
}

export function validateTelemetryBatch(
  value: unknown,
  encodedBytes: number,
): TelemetryValidationResult {
  const candidateEvents = isRecord(value) && Array.isArray(value.events)
    ? value.events
    : [];
  if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 0) {
    return rejectedResult(400, candidateEvents, "invalid_schema");
  }
  if (encodedBytes > TELEMETRY_MAX_BATCH_BYTES) {
    return rejectedResult(413, candidateEvents, "invalid_schema");
  }
  if (
    !isRecord(value) || !hasExactKeys(value, batchKeys) ||
    value.catalog_version !== 1 ||
    typeof value.batch_id !== "string" || !uuidPattern.test(value.batch_id) ||
    !Array.isArray(value.events) || value.events.length < 1 ||
    value.events.length > TELEMETRY_MAX_BATCH_EVENTS
  ) {
    return rejectedResult(400, candidateEvents, "invalid_schema");
  }
  const seen = new Set<string>();
  let installationId: string | null = null;
  for (const event of value.events) {
    const eventId = safeEventId(event);
    if (seen.has(eventId)) {
      return rejectedResult(400, value.events, "invalid_schema");
    }
    seen.add(eventId);
    const reason = validateEvent(event);
    if (reason) return rejectedResult(400, value.events, reason);
    const candidateInstallationId = (event as Record<string, unknown>)
      .installation_id as string;
    if (installationId !== null && installationId !== candidateInstallationId) {
      return rejectedResult(400, value.events, "invalid_schema");
    }
    installationId = candidateInstallationId;
  }
  return { ok: true, batch: value as TelemetryBatchRequestV1 };
}
