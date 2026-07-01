type Env = {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_TOKEN_SECRET: string;
  MEDIA_WORKER_SHARED_SECRET: string;
  WOVEN_API_BASE_URL: string;
  MEDIA_MAX_UPLOAD_BYTES: string;
};

type TokenPayload = {
  kind: "upload" | "download";
  sub: string;
  key: string;
  assetId?: string;
  jobId?: string;
  contentType?: string;
  sizeBytes?: number;
  exp: number;
};

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "PUT" && hasRouteKey(url.pathname, "/uploads/")) {
      return handleUpload(request, env, url);
    }

    if (request.method === "GET" && hasRouteKey(url.pathname, "/objects/")) {
      return handleDownload(env, url);
    }

    return textResponse("Not found", 404);
  },
};

async function handleUpload(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const payload = await verifyToken(
    url.searchParams.get("token") ?? "",
    env.MEDIA_TOKEN_SECRET,
  );
  if (!payload || payload.kind !== "upload" || !payload.assetId) {
    return textResponse("Unauthorized", 401);
  }

  const expectedContentType = payload.contentType?.trim().toLowerCase();
  const contentType = request.headers.get("content-type")?.trim().toLowerCase() ?? "";
  if (!contentType || (expectedContentType && contentType !== expectedContentType)) {
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
  if (payload.sizeBytes !== undefined && contentLength !== payload.sizeBytes) {
    return textResponse("Content-Length mismatch", 400);
  }

  if (!request.body) {
    return textResponse("Missing body", 400);
  }

  await env.MEDIA_BUCKET.put(payload.key, request.body, {
    httpMetadata: { contentType },
    customMetadata: {
      user_id: payload.sub,
      asset_id: payload.assetId,
    },
  });

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
    return textResponse("Upload completion failed", 502);
  }

  return jsonResponse({ ok: true });
}

async function handleDownload(env: Env, url: URL): Promise<Response> {
  const payload = await verifyToken(
    url.searchParams.get("token") ?? "",
    env.MEDIA_TOKEN_SECRET,
  );
  if (!payload || payload.kind !== "download") {
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
  if (
    sizeBytes !== undefined &&
    (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes <= 0)
  ) {
    return false;
  }

  return true;
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
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
