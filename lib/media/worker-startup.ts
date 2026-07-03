import { execFileSync } from "node:child_process";

import { getMediaModel, listMediaModels } from "@/lib/media/model-registry";
import type { MediaModel } from "@/lib/media/types";

const SAMPLE_MODEL_ID = "fal-ai/nano-banana-lite";

export type MediaWorkerStartupDiagnostics = {
  timestamp: string;
  gitSha: string;
  supabaseUrl: string;
  enabledModelCount: number;
  sampleModelId: string;
  sampleModelOk: boolean;
};

export async function collectMediaWorkerStartupDiagnostics({
  env = process.env,
  now = () => new Date(),
  gitSha = currentGitSha,
  listMediaModels: listModels = listMediaModels,
  getMediaModel: getModel = getMediaModel,
}: {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  gitSha?: () => string;
  listMediaModels?: () => Promise<MediaModel[]>;
  getMediaModel?: (id: string) => Promise<MediaModel | null>;
} = {}): Promise<MediaWorkerStartupDiagnostics> {
  const models = await listModels();
  const sampleModel = await getModel(SAMPLE_MODEL_ID);

  return {
    timestamp: now().toISOString(),
    gitSha: shortGitSha(env.VERCEL_GIT_COMMIT_SHA ?? gitSha()),
    supabaseUrl: env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "unknown",
    enabledModelCount: models.length,
    sampleModelId: SAMPLE_MODEL_ID,
    sampleModelOk: sampleModel !== null,
  };
}

export function formatMediaWorkerStartupDiagnostics(diagnostics: MediaWorkerStartupDiagnostics) {
  return [
    "Media worker startup diagnostics:",
    `timestamp=${diagnostics.timestamp}`,
    `git=${diagnostics.gitSha}`,
    `supabase=${diagnostics.supabaseUrl}`,
    `enabled_models=${diagnostics.enabledModelCount}`,
    `sample=${diagnostics.sampleModelId}:${diagnostics.sampleModelOk ? "ok" : "missing"}`,
  ].join(" ");
}

function currentGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function shortGitSha(value: string) {
  return value === "unknown" ? value : value.slice(0, 7);
}
