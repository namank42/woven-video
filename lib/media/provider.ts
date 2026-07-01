import type { MediaModel } from "@/lib/media/types";

export type ProviderOutput = {
  url: string;
  contentType: string;
  type: "image" | "video" | "audio" | "json";
};

export type ProviderRunResult =
  | {
      status: "waiting_provider";
      providerJobId: string;
      rawCostUsd?: number | string;
      metadata?: Record<string, unknown>;
    }
  | {
      status: "succeeded";
      outputs: ProviderOutput[];
      rawCostUsd: number | string;
      metadata?: Record<string, unknown>;
    };

export type MediaProviderAdapter = {
  run(input: {
    model: MediaModel;
    parameters: Record<string, unknown>;
    inputUrls: string[];
    providerJobId?: string | null;
    signal?: AbortSignal;
  }): Promise<ProviderRunResult>;
};
