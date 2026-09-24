import type { DiagnosticIngestDependencies } from "../_shared/diagnostics/types.ts";
import {
  DIAGNOSTIC_MAX_BATCH_BYTES,
  validateDiagnosticReportBatch,
} from "../_shared/diagnostics/validation.ts";

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
    Number(contentLength) > DIAGNOSTIC_MAX_BATCH_BYTES
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
    if (totalBytes > DIAGNOSTIC_MAX_BATCH_BYTES) {
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

export async function handleDiagnosticReport(
  request: Request,
  dependencies: DiagnosticIngestDependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const encoded = await readBoundedBody(request);
  if (encoded === null) {
    return json({ accepted: [], rejected: [], retry_after_ms: null }, 413);
  }

  const authorization = request.headers.get("Authorization");
  if (
    (authorization !== null && !/^Bearer\s+\S+$/i.test(authorization)) ||
    (!authorization && !request.headers.get("apikey"))
  ) {
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

  const validation = validateDiagnosticReportBatch(parsed, encoded.byteLength);
  if (!validation.ok) return json(validation.response, validation.status);

  try {
    const dbResult = validation.accepted.length > 0
      ? await dependencies.admitAndInsert(
        {
          installation_id: validation.installation_id,
          app_version: validation.app_version,
          build: validation.build,
          records: validation.accepted,
        },
        userId,
        dependencies.now(),
      )
      : { accepted: [], rejected: [], retry_after_ms: null };

    // Whole-batch rate limit: nothing was admitted, TS-level rejections are
    // discarded too -- the client should just retry the identical batch.
    if (dbResult.retry_after_ms !== null) {
      return json(
        { accepted: [], rejected: [], retry_after_ms: dbResult.retry_after_ms },
        429,
        {
          "Retry-After": String(
            Math.max(1, Math.ceil(dbResult.retry_after_ms / 1_000)),
          ),
        },
      );
    }

    return json(
      {
        accepted: dbResult.accepted,
        rejected: [...validation.rejected, ...dbResult.rejected],
        retry_after_ms: null,
      },
      200,
    );
  } catch {
    return json({ error: "ingestion_unavailable" }, 500);
  }
}
