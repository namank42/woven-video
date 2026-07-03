import { describe, expect, it } from "vitest";
import {
  collectMediaWorkerStartupDiagnostics,
  formatMediaWorkerStartupDiagnostics,
} from "@/lib/media/worker-startup";
import type { MediaModel } from "@/lib/media/types";

describe("media worker startup diagnostics", () => {
  it("reports build, Supabase, catalog count, and sample model resolution", async () => {
    const diagnostics = await collectMediaWorkerStartupDiagnostics({
      env: {
        SUPABASE_URL: "http://127.0.0.1:54321",
        VERCEL_GIT_COMMIT_SHA: "abcdef1234567890",
      },
      now: () => new Date("2026-07-03T12:00:00.000Z"),
      gitSha: () => "ignored",
      listMediaModels: async () => [
        { id: "fal-ai/nano-banana-lite" } as MediaModel,
        { id: "music_v2" } as MediaModel,
      ],
      getMediaModel: async (id) => id === "fal-ai/nano-banana-lite"
        ? { id } as MediaModel
        : null,
    });

    expect(diagnostics).toEqual({
      timestamp: "2026-07-03T12:00:00.000Z",
      gitSha: "abcdef1",
      supabaseUrl: "http://127.0.0.1:54321",
      enabledModelCount: 2,
      sampleModelId: "fal-ai/nano-banana-lite",
      sampleModelOk: true,
    });
    expect(formatMediaWorkerStartupDiagnostics(diagnostics)).toContain("sample=fal-ai/nano-banana-lite:ok");
  });
});
