import { fal } from "@fal-ai/client";

import { getMediaEnv } from "@/lib/media/env";
import type { MediaProviderAdapter, ProviderOutput } from "@/lib/media/provider";
import type { MediaParameterSchema } from "@/lib/media/types";

type FalResultPayload = {
  data?: unknown;
};

type FalOutputPath = {
  path: string;
  type?: ProviderOutput["type"];
};

type FalOutputExtractionOptions = {
  outputPaths?: FalOutputPath[];
  allowGenericUrlFallback?: boolean;
};

const URL_PATTERN = /^https?:\/\//i;

export const falMediaAdapter: MediaProviderAdapter = {
  async run({ model, parameters, inputUrls, providerJobId, signal }) {
    const endpoint = model.providerEndpoint;
    const input: Record<string, unknown> = {
      ...model.defaultParameters,
      ...declaredParameters(parameters, model.parameterSchema),
    };

    if (inputUrls.length > 0) {
      input.input_urls = inputUrls;
    }

    if (!providerJobId) {
      const submitOptions: {
        input: Record<string, unknown>;
        abortSignal?: AbortSignal;
        webhookUrl?: string;
      } = {
        input,
        abortSignal: signal,
      };
      const webhookBaseUrl = getMediaEnv().falWebhookBaseUrl;
      if (webhookBaseUrl) {
        submitOptions.webhookUrl = `${webhookBaseUrl}/api/v1/media/webhooks/fal`;
      }

      const submitted = await fal.queue.submit(endpoint, submitOptions);
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
    const outputs = extractFalOutputs(payload, model.outputTypes, {
      outputPaths: falOutputPaths(model.metadata.fal_output_paths),
      allowGenericUrlFallback: model.metadata.fal_allow_generic_url_fallback === true,
    });
    if (outputs.length === 0) {
      throw new Error("provider_no_outputs");
    }

    return {
      status: "succeeded",
      outputs,
      rawCostUsd: providerCostUsd(model.metadata),
      metadata: {
        endpoint,
        fal_request_id: providerJobId,
        fal_status: statusText,
      },
    };
  },
};

export function extractFalOutputs(
  payload: unknown,
  outputTypes: string[],
  options: FalOutputExtractionOptions = {},
): ProviderOutput[] {
  const outputs: ProviderOutput[] = [];
  const seenUrls = new Set<string>();

  if (options.outputPaths && options.outputPaths.length > 0) {
    for (const selector of options.outputPaths) {
      for (const value of valuesAtPath(payload, selector.path)) {
        collectFalUrls(value, outputs, outputTypes, seenUrls, selector.type);
      }
    }
    if (outputs.length > 0) {
      return outputs;
    }
  }

  if (options.allowGenericUrlFallback === true) {
    collectFalUrls(payload, outputs, outputTypes, seenUrls);
  }

  return outputs;
}

function declaredParameters(
  parameters: Record<string, unknown>,
  schema: MediaParameterSchema,
): Record<string, unknown> {
  const declared = new Set([
    ...Object.keys(schema.properties ?? {}),
    ...(schema.required ?? []),
  ]);
  return Object.fromEntries(
    Object.entries(parameters).filter(([key]) => declared.has(key)),
  );
}

function collectFalUrls(
  value: unknown,
  outputs: ProviderOutput[],
  outputTypes: string[],
  seenUrls: Set<string>,
  typeOverride?: ProviderOutput["type"],
) {
  const directUrl = stringValue(value);
  if (directUrl && URL_PATTERN.test(directUrl) && !seenUrls.has(directUrl)) {
    seenUrls.add(directUrl);
    const type = typeOverride ?? firstOutputType(outputTypes);
    outputs.push({
      url: directUrl,
      type,
      contentType: defaultContentType(type),
    });
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFalUrls(item, outputs, outputTypes, seenUrls, typeOverride);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const url = stringValue(value.url);
  if (url && URL_PATTERN.test(url) && !seenUrls.has(url)) {
    seenUrls.add(url);
    const type = typeOverride ?? outputTypeFor(value, outputTypes);
    outputs.push({
      url,
      type,
      contentType: contentTypeFor(value, type),
    });
  }

  for (const child of Object.values(value)) {
    collectFalUrls(child, outputs, outputTypes, seenUrls, typeOverride);
  }
}

function valuesAtPath(value: unknown, path: string): unknown[] {
  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return [];

  let current: unknown[] = [value];
  for (const segment of segments) {
    const next: unknown[] = [];
    for (const item of current) {
      if (Array.isArray(item)) {
        for (const child of item) {
          if (isRecord(child) && segment in child) {
            next.push(child[segment]);
          }
        }
        continue;
      }
      if (isRecord(item) && segment in item) {
        next.push(item[segment]);
      }
    }
    current = next;
  }

  return current;
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

function firstOutputType(outputTypes: string[]): ProviderOutput["type"] {
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

function falOutputPaths(value: unknown): FalOutputPath[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): FalOutputPath[] => {
    if (!isRecord(item)) return [];
    const path = stringValue(item.path);
    if (!path) return [];

    const type = mediaOutputType(item.type);
    return [{ path, ...(type ? { type } : {}) }];
  });
}

function mediaOutputType(value: unknown): ProviderOutput["type"] | null {
  return value === "image" || value === "video" || value === "audio" || value === "json"
    ? value
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
