import { isLoopbackMediaBaseUrl } from "@/lib/media/env";

export type ProviderFetchableMediaBaseUrlResult =
  | { ok: true }
  | { ok: false; error: "media_storage_misconfigured" };

export function validateProviderFetchableMediaBaseUrl({
  inputAssetIds,
  baseUrl = process.env.MEDIA_BASE_URL ?? "https://media.woven.video",
}: {
  inputAssetIds: readonly string[];
  baseUrl?: string;
}): ProviderFetchableMediaBaseUrlResult {
  if (inputAssetIds.length === 0) {
    return { ok: true };
  }

  if (isLoopbackMediaBaseUrl(baseUrl)) {
    return { ok: false, error: "media_storage_misconfigured" };
  }

  return { ok: true };
}
