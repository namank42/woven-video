const EXPECTED_CONTENT_TYPE_PREFIX = {
  image: "image/",
  video: "video/",
  audio: "audio/",
  json: "application/json",
} as const;

export function isAllowedOutputHost(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();

  return allowlist.some((entry) => {
    const pattern = entry.toLowerCase();
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }

    return host === pattern;
  });
}

export async function fetchProviderOutput({
  url,
  allowlist,
  expectedType,
  maxBytes,
  timeoutMs = 120_000,
}: {
  url: string;
  allowlist: string[];
  expectedType: keyof typeof EXPECTED_CONTENT_TYPE_PREFIX;
  maxBytes: number;
  timeoutMs?: number;
}): Promise<{ bytes: Buffer; contentType: string | null }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("media_output_url_not_allowed");
  }

  if (parsed.protocol !== "https:" || !isAllowedOutputHost(parsed.hostname, allowlist)) {
    throw new Error("media_output_url_not_allowed");
  }

  let response: Response;
  try {
    response = await fetch(parsed, {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("media_output_download_timeout");
    }

    throw new Error("media_output_url_not_allowed");
  }

  if (!response.ok) {
    throw new Error(`provider_output_download_failed:${response.status}`);
  }

  const contentType = response.headers.get("content-type");
  const prefix = EXPECTED_CONTENT_TYPE_PREFIX[expectedType];
  if (!contentType || !contentType.toLowerCase().startsWith(prefix)) {
    throw new Error("media_output_content_type_mismatch");
  }

  const contentLength = parsePositiveInteger(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > maxBytes) {
    throw new Error("media_output_too_large");
  }

  const bytes = await readResponseBytes(response, maxBytes);
  return { bytes, contentType };
}

export async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    assertWithinMaxBytes(bytes.byteLength, maxBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error("media_output_too_large");
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, totalBytes);
}

function assertWithinMaxBytes(sizeBytes: number, maxBytes: number): void {
  if (sizeBytes > maxBytes) {
    throw new Error("media_output_too_large");
  }
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^[0-9]+$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
