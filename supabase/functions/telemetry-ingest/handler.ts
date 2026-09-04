import type { TelemetryIngestDependencies } from "../_shared/telemetry/types.ts";
import {
  TELEMETRY_MAX_BATCH_BYTES,
  validateTelemetryBatch,
} from "../_shared/telemetry/validation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...headers },
  });
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const contentLength = request.headers.get("Content-Length");
  if (
    contentLength && /^\d+$/.test(contentLength) &&
    Number(contentLength) > TELEMETRY_MAX_BATCH_BYTES
  ) {
    return null;
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > TELEMETRY_MAX_BATCH_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function handleTelemetryIngest(
  request: Request,
  dependencies: TelemetryIngestDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const encoded = await readBoundedBody(request);
  if (encoded === null) {
    const validation = validateTelemetryBatch(
      undefined,
      TELEMETRY_MAX_BATCH_BYTES + 1,
    );
    if (!validation.ok) return json(validation.response, validation.status);
    return json({ error: "payload_too_large" }, 413);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    return json({ error: "unauthorized" }, 401);
  }

  let userId: string | null;
  try {
    userId = await dependencies.resolveVerifiedUserId(request);
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(encoded),
    );
  } catch {
    return json({ accepted: [], rejected: [], retry_after_ms: null }, 400);
  }

  const validation = validateTelemetryBatch(parsed, encoded.byteLength);
  if (!validation.ok) return json(validation.response, validation.status);

  try {
    const result = await dependencies.admitAndInsert(
      validation.batch,
      userId,
      dependencies.now(),
    );
    const fullyRateLimited = result.accepted.length === 0 &&
      result.rejected.length > 0 &&
      result.rejected.every((item) => item.reason === "rate_limited");
    if (fullyRateLimited) {
      const retryAfterMs = result.retry_after_ms ?? 1_000;
      return json(result, 429, {
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
      });
    }
    return json(result, 200);
  } catch {
    return json({ error: "ingestion_unavailable" }, 500);
  }
}
