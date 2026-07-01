import { fal } from "@fal-ai/client";

import type { MediaProviderAdapter, ProviderOutput } from "@/lib/media/provider";

type FalResultPayload = {
  data?: unknown;
};

const URL_PATTERN = /^https?:\/\//i;

export const falMediaAdapter: MediaProviderAdapter = {
  async run({ model, parameters, inputUrls, providerJobId, signal }) {
    const endpoint = model.providerEndpoint;
    const input: Record<string, unknown> = {
      ...model.defaultParameters,
      ...parameters,
    };

    if (inputUrls.length > 0) {
      input.input_urls = inputUrls;
    }

    if (!providerJobId) {
      const submitted = await fal.queue.submit(endpoint, {
        input,
        abortSignal: signal,
      });
      const requestId = submitted.request_id;
      return {
        status: "waiting_provider",
        providerJobId: requestId,
        metadata: {
          endpoint,
          fal_request_id: requestId,
        },
      };
    }

    const status = await fal.queue.status(endpoint, {
      requestId: providerJobId,
      logs: true,
      abortSignal: signal,
    });
    const statusText = stringValue((status as unknown as Record<string, unknown>).status) ?? "";

    if (!/completed|succeeded/i.test(statusText)) {
      return {
        status: "waiting_provider",
        providerJobId,
        metadata: {
          endpoint,
          fal_request_id: providerJobId,
          fal_status: statusText,
        },
      };
    }

    const result = await fal.queue.result(endpoint, {
      requestId: providerJobId,
      abortSignal: signal,
    });
    const payload = resultPayload(result);

    return {
      status: "succeeded",
      outputs: extractFalOutputs(payload, model.outputTypes),
      rawCostUsd: providerCostUsd(model.metadata),
      metadata: {
        endpoint,
        fal_request_id: providerJobId,
        fal_status: statusText,
      },
    };
  },
};

export function extractFalOutputs(payload: unknown, outputTypes: string[]): ProviderOutput[] {
  const outputs: ProviderOutput[] = [];
  collectFalUrls(payload, outputs, outputTypes, new Set());
  return outputs;
}

function collectFalUrls(
  value: unknown,
  outputs: ProviderOutput[],
  outputTypes: string[],
  seenUrls: Set<string>,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFalUrls(item, outputs, outputTypes, seenUrls);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const url = stringValue(value.url);
  if (url && URL_PATTERN.test(url) && !seenUrls.has(url)) {
    seenUrls.add(url);
    const type = outputTypeFor(value, outputTypes);
    outputs.push({
      url,
      type,
      contentType: contentTypeFor(value, type),
    });
  }

  for (const child of Object.values(value)) {
    collectFalUrls(child, outputs, outputTypes, seenUrls);
  }
}

function outputTypeFor(
  object: Record<string, unknown>,
  outputTypes: string[],
): ProviderOutput["type"] {
  const explicitContentType = contentTypeValue(object);
  if (explicitContentType?.startsWith("video/") && outputTypes.includes("video")) {
    return "video";
  }
  if (explicitContentType?.startsWith("audio/") && outputTypes.includes("audio")) {
    return "audio";
  }
  if (explicitContentType?.startsWith("image/") && outputTypes.includes("image")) {
    return "image";
  }
  if (explicitContentType === "application/json" && outputTypes.includes("json")) {
    return "json";
  }

  if (outputTypes.includes("video")) return "video";
  if (outputTypes.includes("audio")) return "audio";
  if (outputTypes.includes("image")) return "image";
  if (outputTypes.includes("json")) return "json";

  return "image";
}

function contentTypeFor(object: Record<string, unknown>, type: ProviderOutput["type"]) {
  return contentTypeValue(object) ?? defaultContentType(type);
}

function contentTypeValue(object: Record<string, unknown>) {
  return (
    stringValue(object.content_type) ??
    stringValue(object.contentType) ??
    stringValue(object.mime_type) ??
    stringValue(object.mimeType)
  );
}

function defaultContentType(type: ProviderOutput["type"]) {
  if (type === "video") return "video/mp4";
  if (type === "audio") return "audio/mpeg";
  if (type === "json") return "application/json";
  return "image/png";
}

function resultPayload(result: unknown) {
  return isRecord(result) && "data" in result
    ? (result as FalResultPayload).data
    : result;
}

function providerCostUsd(metadata: Record<string, unknown>) {
  const cost = Number(metadata.provider_cost_usd ?? 0);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
