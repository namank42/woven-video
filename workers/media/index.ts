type Env = {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_TOKEN_SECRET: string;
  MEDIA_WORKER_SHARED_SECRET: string;
  WOVEN_API_BASE_URL: string;
  MEDIA_MAX_UPLOAD_BYTES: string;
  UPLOAD_COMPLETION_MODE?: string;
};

type UploadCompletionMode = "callback" | "manual";

type UploadTokenPayload = {
  kind: "upload";
  sub: string;
  key: string;
  assetId: string;
  jobId?: string;
  contentType: string;
  sizeBytes: number;
  exp: number;
};

type DownloadTokenPayload = {
  kind: "download";
  sub: string;
  key: string;
  assetId?: string;
  jobId?: string;
  contentType?: string;
  sizeBytes?: number;
  exp: number;
};

type TokenPayload = UploadTokenPayload | DownloadTokenPayload;

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_DELETE_KEY_LENGTH = 512;
const SAFE_DELETE_KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const mediaWorker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const uploadAssetId = getSingleRouteValue(url.pathname, "/uploads/");

    if (request.method === "PUT" && uploadAssetId) {
      return handleUpload(request, env, url, uploadAssetId);
    }

    if (request.method === "POST" && url.pathname === "/internal/delete") {
      return handleInternalDelete(request, env);
    }

    const downloadAssetId = getSingleRouteValue(url.pathname, "/objects/");
    if (request.method === "GET" && downloadAssetId) {
      return handleDownload(env, url, downloadAssetId);
    }

    return textResponse("Not found", 404);
  },
};

export default mediaWorker;

async function handleUpload(
  request: Request,
  env: Env,
  url: URL,
  routeAssetId: string,
): Promise<Response> {
  const payload = await verifyToken(
    url.searchParams.get("token") ?? "",
    env.MEDIA_TOKEN_SECRET,
  );
  if (!isValidUploadPayload(payload, routeAssetId)) {
    return textResponse("Unauthorized", 401);
  }

  const contentType = request.headers.get("content-type")?.trim() ?? "";
  if (contentType !== payload.contentType) {
    return textResponse("Content-Type mismatch", 400);
  }

  const contentLength = parsePositiveInteger(request.headers.get("content-length"));
  if (contentLength === null) {
    return textResponse("Content-Length required", 411);
  }

  const maxUploadBytes = parsePositiveInteger(env.MEDIA_MAX_UPLOAD_BYTES)
    ?? DEFAULT_MAX_UPLOAD_BYTES;
  if (contentLength > maxUploadBytes) {
    return textResponse("Upload too large", 413);
  }
  if (contentLength > payload.sizeBytes) {
    return textResponse("Upload too large", 413);
  }

  if (!request.body) {
    return textResponse("Missing body", 400);
  }

  const uploadCompletionMode = parseUploadCompletionMode(env.UPLOAD_COMPLETION_MODE);
  if (!uploadCompletionMode) {
    return textResponse("Invalid upload completion mode", 500);
  }

  await env.MEDIA_BUCKET.put(payload.key, request.body, {
    httpMetadata: { contentType },
    customMetadata: {
      "user-id": payload.sub,
      "asset-id": payload.assetId,
      ...(payload.jobId ? { "job-id": payload.jobId } : {}),
    },
  });

  if (payload.jobId || uploadCompletionMode === "manual") {
    return jsonResponse({ ok: true });
  }

  try {
    const completionResponse = await fetch(
      `${env.WOVEN_API_BASE_URL.replace(/\/$/, "")}/api/internal/media/uploads/complete`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-woven-media-worker-secret": env.MEDIA_WORKER_SHARED_SECRET,
        },
        body: JSON.stringify({
          asset_id: payload.assetId,
          storage_key: payload.key,
          size_bytes: contentLength,
        }),
      },
    );
    if (!completionResponse.ok) {
      await rollbackUploadedObject(env, payload.key);
      return textResponse("Upload completion failed", 502);
    }
  } catch {
    await rollbackUploadedObject(env, payload.key);
    return textResponse("Upload completion failed", 502);
  }

  return jsonResponse({ ok: true });
}

async function handleInternalDelete(request: Request, env: Env): Promise<Response> {
  const provided = request.headers.get("x-woven-media-worker-secret") ?? "";
  if (!timingSafeEqual(provided, env.MEDIA_WORKER_SHARED_SECRET)) {
    return textResponse("Unauthorized", 401);
  }

  const payload = await request.json().catch(() => null);
  if (!isDeletePayload(payload)) {
    return textResponse("Invalid delete payload", 400);
  }

  await env.MEDIA_BUCKET.delete(payload.keys);
  return jsonResponse({ deleted_count: payload.keys.length });
}

async function handleDownload(env: Env, url: URL, routeAssetId: string): Promise<Response> {
  const payload = await verifyToken(
    url.searchParams.get("token") ?? "",
    env.MEDIA_TOKEN_SECRET,
  );
  if (
    !payload ||
    payload.kind !== "download" ||
    !payload.assetId ||
    payload.assetId !== routeAssetId
  ) {
    return textResponse("Unauthorized", 401);
  }

  const object = await env.MEDIA_BUCKET.get(payload.key);
  if (!object) {
    return textResponse("Not found", 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=60");

  return new Response(object.body, { headers });
}

async function verifyToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TokenPayload | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;

  const expected = await hmacSha256(body, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  const decoded = base64UrlDecode(body);
  if (decoded === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return null;
  }

  if (!isTokenPayload(payload, nowSeconds)) return null;
  return payload;
}

function isDeletePayload(value: unknown): value is { keys: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const keys = (value as { keys?: unknown }).keys;
  return (
    Array.isArray(keys) &&
    keys.length > 0 &&
    keys.length <= 1000 &&
    keys.every(isValidDeleteKey)
  );
}

function isValidDeleteKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_DELETE_KEY_LENGTH) {
    return false;
  }

  const segments = key.split("/");
  if (!segments.every(isSafeDeleteKeySegment)) return false;

  return isValidTempMediaDeleteKey(segments) || isValidOutputMediaDeleteKey(segments);
}

function isValidTempMediaDeleteKey(segments: string[]): boolean {
  return (
    segments.length === 6 &&
    segments[0] === "users" &&
    segments[2] === "media" &&
    segments[3] === "tmp" &&
    /^input\.[A-Za-z0-9]+$/.test(segments[5])
  );
}

function isValidOutputMediaDeleteKey(segments: string[]): boolean {
  return (
    segments.length === 9 &&
    segments[0] === "users" &&
    segments[2] === "media" &&
    segments[3] === "outputs" &&
    segments[6] === "attempts" &&
    /^output\.[A-Za-z0-9]+$/.test(segments[8])
  );
}

function isSafeDeleteKeySegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    SAFE_DELETE_KEY_SEGMENT.test(segment)
  );
}

async function hmacSha256(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    return null;
  }

  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function timingSafeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function isTokenPayload(
  payload: unknown,
  nowSeconds: number,
): payload is TokenPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const token = payload as Record<string, unknown>;
  if (token.kind !== "upload" && token.kind !== "download") return false;
  if (!isNonEmptyString(token.sub)) return false;
  if (!isNonEmptyString(token.key)) return false;
  if (
    typeof token.exp !== "number" ||
    !Number.isInteger(token.exp) ||
    token.exp < nowSeconds
  ) {
    return false;
  }
  if (!isOptionalString(token.assetId)) return false;
  if (!isOptionalString(token.jobId)) return false;
  if (!isOptionalString(token.contentType)) return false;

  const sizeBytes = token.sizeBytes;
  if (token.kind === "upload") {
    return (
      isNonEmptyString(token.assetId) &&
      isNonEmptyString(token.contentType) &&
      typeof sizeBytes === "number" &&
      Number.isInteger(sizeBytes) &&
      sizeBytes > 0
    );
  }

  return (
    sizeBytes === undefined ||
    (typeof sizeBytes === "number" && Number.isInteger(sizeBytes) && sizeBytes > 0)
  );
}

function isValidUploadPayload(
  payload: TokenPayload | null,
  routeAssetId: string,
): payload is UploadTokenPayload {
  if (!payload || payload.kind !== "upload") return false;
  if (!isNonEmptyString(payload.assetId)) return false;
  if (routeAssetId !== payload.assetId) return false;
  if (!isNonEmptyString(payload.contentType)) return false;
  if (!Number.isInteger(payload.sizeBytes) || payload.sizeBytes <= 0) {
    return false;
  }
  if (!isSafeKeySegment(payload.sub) || !isSafeKeySegment(payload.assetId)) {
    return false;
  }

  return isValidInputUploadKey(payload) || isValidOutputUploadKey(payload);
}

function isValidInputUploadKey(payload: UploadTokenPayload): boolean {
  if (payload.jobId !== undefined) return false;
  return payload.key.startsWith(
    `users/${payload.sub}/media/tmp/${payload.assetId}/`,
  );
}

function isValidOutputUploadKey(payload: UploadTokenPayload): boolean {
  if (!isNonEmptyString(payload.jobId) || !isSafeKeySegment(payload.jobId)) {
    return false;
  }

  const outputPrefix = `users/${payload.sub}/media/outputs/${payload.jobId}/${payload.assetId}/attempts/`;
  if (!payload.key.startsWith(outputPrefix)) {
    return false;
  }

  const rest = payload.key.slice(outputPrefix.length);
  const parts = rest.split("/");
  if (parts.length !== 2) return false;

  const [attemptId, filename] = parts;
  return /^[A-Za-z0-9_-]+$/.test(attemptId) && /^output\.[A-Za-z0-9]+$/.test(filename);
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseUploadCompletionMode(raw: string | undefined): UploadCompletionMode | null {
  const value = raw?.trim() || "callback";
  if (value === "callback" || value === "manual") {
    return value;
  }
  return null;
}

async function rollbackUploadedObject(env: Env, key: string): Promise<void> {
  try {
    await env.MEDIA_BUCKET.delete(key);
  } catch {
    // Best-effort compensation. The client still receives the completion failure.
  }
}

function getSingleRouteValue(pathname: string, prefix: string): string | null {
  if (!hasRouteKey(pathname, prefix)) return null;
  const value = pathname.slice(prefix.length);
  if (!value || value.includes("/")) return null;
  return value;
}

function hasRouteKey(pathname: string, prefix: string): boolean {
  return pathname.startsWith(prefix) && pathname.length > prefix.length;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isSafeKeySegment(value: string): boolean {
  return value.length > 0 && !value.includes("/");
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}
