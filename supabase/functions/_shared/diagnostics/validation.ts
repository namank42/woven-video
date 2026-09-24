// Stage 2 backend validator for the `diagnostic-report` Edge Function.
//
// Unlike Stage 1 telemetry (which rejects a whole batch over one invalid
// event), this validates each record independently: a malformed envelope is
// a 400 for the whole request, but a single bad record inside an otherwise
// valid envelope is rejected on its own and does not sink its batch mates.
//
// Reuses the Stage 1 enum values and the uuid/site rule patterns from
// _shared/telemetry instead of redeclaring them, per the Stage 2 contract.
import {
  ERROR_CLASS_VALUES,
  FAILURE_SITE_VALUES,
  NATIVE_ERROR_DOMAIN_VALUES,
} from "../telemetry/catalog.ts";
import {
  hasExactKeys,
  isRecord,
  isValidSite,
  isValidTimestamp,
  uuidPattern,
} from "../telemetry/validation.ts";
import type {
  DiagnosticErrorEntryV1,
  DiagnosticReportResponseV1,
  DiagnosticRecordV1,
  DiagnosticRejectionReason,
} from "./types.ts";

export const DIAGNOSTIC_MAX_BATCH_BYTES = 65_536;
export const DIAGNOSTIC_MAX_RECORD_BYTES = 16_384;
export const DIAGNOSTIC_MAX_RECORDS = 20;
export const DIAGNOSTIC_MAX_ERRORS = 4;
export const DIAGNOSTIC_MAX_NAME_LENGTH = 128;
export const DIAGNOSTIC_MAX_TEXT_LENGTH = 2_000;

const appVersionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const appBuildPattern = /^\d{1,32}$/;
// Stage 2-only: not a Stage 1 catalog rule, so declared locally rather than
// imported.
const modelIdPattern = /^[A-Za-z0-9_.:/@-]{1,128}$/;
const sourceValues = ["turn", "compaction", "tool", "export"] as const;

const envelopeKeys = [
  "schema_version",
  "installation_id",
  "app_version",
  "build",
  "records",
];
const recordRequiredKeys = [
  "record_id",
  "occurred_at",
  "source",
  "failure_site",
  "errors",
];
const recordOptionalKeys = [
  "error_class",
  "http_status",
  "native_error_domain",
  "native_error_code",
  "code_site",
  "woven_job_id",
  "chat_id",
  "turn_id",
  "operation_id",
  "model_id",
];
const errorRequiredKeys = ["name", "message"];
const errorOptionalKeys = ["response_body", "detail"];

// Free text on purpose: Stage 2 is the scrubbed-error-text channel that
// Stage 1's ASCII/enum-only telemetry validator forbids by design, so this
// intentionally does not reuse telemetry's isBoundedString (which enforces
// an ASCII-printable charset meant for closed taxonomy values, not prose).
//
// Still rejects two things jsonb itself cannot store: a NUL byte ("\u0000",
// which Postgres text/jsonb refuses outright) and an unpaired UTF-16
// surrogate (produces invalid UTF-8 once encoded, which jsonb also refuses).
// Both would otherwise pass this check, reach the DB, and turn one bad
// record into a request-level error instead of a per-record rejection.
function isBoundedText(
  value: unknown,
  maxLength: number,
  minLength = 1,
): boolean {
  return typeof value === "string" && value.length >= minLength &&
    value.length <= maxLength && !value.includes("\0") &&
    value.isWellFormed();
}

function isBoundedAppField(value: unknown, maxLength: number, pattern: RegExp) {
  return isBoundedText(value, maxLength) && pattern.test(value as string);
}

function validateErrorEntry(value: unknown): value is DiagnosticErrorEntryV1 {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, errorRequiredKeys, errorOptionalKeys)) return false;
  // name: 1-128 (must say something). message/response_body/detail: 0-2000
  // -- the sidecar sends message: "" for a bare `new Error()`, and that
  // record should not be silently dropped.
  if (!isBoundedText(value.name, DIAGNOSTIC_MAX_NAME_LENGTH, 1)) return false;
  if (!isBoundedText(value.message, DIAGNOSTIC_MAX_TEXT_LENGTH, 0)) return false;
  if (
    Object.hasOwn(value, "response_body") &&
    !isBoundedText(value.response_body, DIAGNOSTIC_MAX_TEXT_LENGTH, 0)
  ) {
    return false;
  }
  if (
    Object.hasOwn(value, "detail") &&
    !isBoundedText(value.detail, DIAGNOSTIC_MAX_TEXT_LENGTH, 0)
  ) {
    return false;
  }
  return true;
}

function optionalUuidOk(value: Record<string, unknown>, key: string): boolean {
  if (!Object.hasOwn(value, key)) return true;
  return typeof value[key] === "string" && uuidPattern.test(value[key] as string);
}

export function validateDiagnosticRecord(
  value: unknown,
):
  | { ok: true; record: DiagnosticRecordV1 }
  | { ok: false; reason: DiagnosticRejectionReason } {
  if (!isRecord(value)) return { ok: false, reason: "invalid_schema" };
  if (!hasExactKeys(value, recordRequiredKeys, recordOptionalKeys)) {
    return { ok: false, reason: "invalid_schema" };
  }
  if (
    typeof value.record_id !== "string" || !uuidPattern.test(value.record_id)
  ) {
    return { ok: false, reason: "invalid_schema" };
  }
  if (
    typeof value.occurred_at !== "string" ||
    !isValidTimestamp(value.occurred_at)
  ) {
    return { ok: false, reason: "invalid_schema" };
  }
  if (!sourceValues.includes(value.source as typeof sourceValues[number])) {
    return { ok: false, reason: "invalid_schema" };
  }
  if (
    typeof value.failure_site !== "string" ||
    !FAILURE_SITE_VALUES.includes(
      value.failure_site as typeof FAILURE_SITE_VALUES[number],
    )
  ) {
    return { ok: false, reason: "invalid_schema" };
  }
  if (
    Object.hasOwn(value, "error_class") &&
    (typeof value.error_class !== "string" ||
      !ERROR_CLASS_VALUES.includes(
        value.error_class as typeof ERROR_CLASS_VALUES[number],
      ))
  ) {
    return { ok: false, reason: "invalid_schema" };
  }
  if (Object.hasOwn(value, "http_status")) {
    const status = value.http_status;
    if (
      typeof status !== "number" || !Number.isInteger(status) ||
      status < 100 || status > 599
    ) {
      return { ok: false, reason: "invalid_schema" };
    }
  }
  if (
    Object.hasOwn(value, "native_error_domain") &&
    (typeof value.native_error_domain !== "string" ||
      !NATIVE_ERROR_DOMAIN_VALUES.includes(
        value.native_error_domain as typeof NATIVE_ERROR_DOMAIN_VALUES[number],
      ))
  ) {
    return { ok: false, reason: "invalid_schema" };
  }
  if (Object.hasOwn(value, "native_error_code")) {
    const code = value.native_error_code;
    if (
      typeof code !== "number" || !Number.isInteger(code) ||
      code < -2_147_483_648 || code > 2_147_483_647
    ) {
      return { ok: false, reason: "invalid_schema" };
    }
  }
  if (Object.hasOwn(value, "code_site") && !isValidSite(value.code_site)) {
    return { ok: false, reason: "invalid_schema" };
  }
  for (const key of ["woven_job_id", "chat_id", "turn_id", "operation_id"]) {
    if (!optionalUuidOk(value, key)) return { ok: false, reason: "invalid_schema" };
  }
  if (
    Object.hasOwn(value, "model_id") &&
    (typeof value.model_id !== "string" || !modelIdPattern.test(value.model_id))
  ) {
    return { ok: false, reason: "invalid_schema" };
  }
  if (
    !Array.isArray(value.errors) || value.errors.length < 1 ||
    value.errors.length > DIAGNOSTIC_MAX_ERRORS ||
    !value.errors.every(validateErrorEntry)
  ) {
    return { ok: false, reason: "invalid_schema" };
  }

  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
      DIAGNOSTIC_MAX_RECORD_BYTES
  ) {
    return { ok: false, reason: "payload_too_large" };
  }

  return { ok: true, record: value as unknown as DiagnosticRecordV1 };
}

export type DiagnosticBatchValidation =
  | { ok: false; status: 400 | 413; response: DiagnosticReportResponseV1 }
  | {
    ok: true;
    installation_id: string;
    app_version: string;
    build: string;
    accepted: DiagnosticRecordV1[];
    rejected: Array<{ record_id: string; reason: DiagnosticRejectionReason }>;
  };

const emptyResponse: DiagnosticReportResponseV1 = {
  accepted: [],
  rejected: [],
  retry_after_ms: null,
};

export function validateDiagnosticReportBatch(
  value: unknown,
  encodedBytes: number,
): DiagnosticBatchValidation {
  if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 0) {
    return { ok: false, status: 400, response: emptyResponse };
  }
  if (encodedBytes > DIAGNOSTIC_MAX_BATCH_BYTES) {
    return { ok: false, status: 413, response: emptyResponse };
  }
  if (
    !isRecord(value) || !hasExactKeys(value, envelopeKeys) ||
    value.schema_version !== 1 ||
    typeof value.installation_id !== "string" ||
    !uuidPattern.test(value.installation_id) ||
    !isBoundedAppField(value.app_version, 64, appVersionPattern) ||
    !isBoundedAppField(value.build, 32, appBuildPattern) ||
    !Array.isArray(value.records) || value.records.length < 1 ||
    value.records.length > DIAGNOSTIC_MAX_RECORDS
  ) {
    return { ok: false, status: 400, response: emptyResponse };
  }

  const accepted: DiagnosticRecordV1[] = [];
  const rejected: Array<{ record_id: string; reason: DiagnosticRejectionReason }> =
    [];
  const seenIds = new Set<string>();

  for (const candidate of value.records) {
    const rawId = isRecord(candidate) && typeof candidate.record_id === "string"
      ? candidate.record_id
      : null;
    const validId = rawId !== null && uuidPattern.test(rawId);
    // Lowercase before comparing/tracking: uuidPattern is case-insensitive,
    // so an uppercase and lowercase spelling of the same UUID are the same
    // id and must dedupe against each other, not be treated as two records.
    const recordId = validId
      ? rawId!.toLowerCase()
      : "00000000-0000-4000-8000-000000000000";

    if (validId && seenIds.has(recordId)) {
      rejected.push({ record_id: recordId, reason: "invalid_schema" });
      continue;
    }

    const result = validateDiagnosticRecord(candidate);
    if (result.ok) {
      if (validId) seenIds.add(recordId);
      accepted.push(result.record);
    } else {
      rejected.push({ record_id: recordId, reason: result.reason });
    }
  }

  return {
    ok: true,
    installation_id: value.installation_id,
    app_version: value.app_version as string,
    build: value.build as string,
    accepted,
    rejected,
  };
}
