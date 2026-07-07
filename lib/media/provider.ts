import type { MediaModel } from "@/lib/media/types";

export type ProviderInputAsset = {
  assetId: string;
  role: string;
  url: string;
  contentType: string;
};

export type ProviderOutput = {
  url?: string;
  data?: Uint8Array;
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
      status: "provider_failed";
      metadata?: Record<string, unknown>;
    }
  | {
      status: "succeeded";
      outputs: ProviderOutput[];
      rawCostUsd: number | string;
      metadata?: Record<string, unknown>;
    };

export type MediaProviderAdapter = {
  outputUrlAllowlist: string[];
  run(input: {
    model: MediaModel;
    parameters: Record<string, unknown>;
    inputUrls: string[];
    inputAssets?: ProviderInputAsset[];
    providerJobId?: string | null;
    webhookUrl?: string | null;
    signal?: AbortSignal;
  }): Promise<ProviderRunResult>;
};
