/** Public-key admission is not user identity. Only Auth can resolve a user JWT. */
export async function resolveTelemetryIdentity(
  request: Request,
  options: {
    anonKey: string;
    publishableKeysJSON?: string;
    verifyUser: (request: Request) => Promise<{ id: string }>;
  },
): Promise<string | null> {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (authorization !== null && !token) throw new Error("unauthorized");

  const legacyKey = options.anonKey && !options.anonKey.startsWith("sb_")
    ? options.anonKey : null;
  // Do not let a bad or expired user token fall back to anonymous admission.
  if (token && token !== legacyKey) return (await options.verifyUser(request)).id;
  if (token === legacyKey && legacyKey) return null;

  const apiKey = request.headers.get("apikey");
  if (legacyKey && apiKey === legacyKey) return null;
  if (!apiKey?.startsWith("sb_publishable_")) throw new Error("unauthorized");
  const configured: unknown = JSON.parse(options.publishableKeysJSON ?? "{}");
  if (!configured || typeof configured !== "object" || Array.isArray(configured) ||
    !Object.values(configured).some((key) => typeof key === "string" && key === apiKey)) {
    throw new Error("unauthorized");
  }
  return null;
}
