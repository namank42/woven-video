export type MediaTokenPayload = {
  kind: "upload" | "download";
  sub: string;
  key: string;
  assetId?: string;
  jobId?: string;
  contentType?: string;
  sizeBytes?: number;
  exp: number;
};

const encoder = new TextEncoder();

export async function signMediaToken(
  payload: MediaTokenPayload,
  secret: string,
): Promise<string> {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(body, secret);
  return `${body}.${signature}`;
}

export async function verifyMediaToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<MediaTokenPayload | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = await hmacSha256(body, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  let payload: MediaTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as MediaTokenPayload;
  } catch {
    return null;
  }

  if (payload.exp < nowSeconds) return null;
  if (payload.kind !== "upload" && payload.kind !== "download") return null;
  if (!payload.sub || !payload.key) return null;
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

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
