# Media Pricing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the public `/pricing` page so Woven credits clearly publish curated hosted image, video, and ElevenLabs music generation rates.

**Architecture:** Keep `/pricing` static and SEO-friendly by moving the published rate card into a typed local data module. The page imports that module and renders separate chat, media, and feature tables; backend job pricing remains owned by `model_pricing_rules` and `/api/v1/media/models`.

**Tech Stack:** Next.js App Router `16.2.3`, React `19.2.4`, TypeScript, Tailwind CSS, Vitest.

**Docs digest:** `docs/superpowers/research/2026-07-01-pricing-page-next-docs.md` and `docs/superpowers/research/2026-07-01-hosted-media-models-docs.md`

---

## Scope

Implement only the approved public pricing-page work from `docs/superpowers/specs/2026-07-01-media-pricing-page-design.md`.

In scope:
- Move existing chat and feature pricing data out of `app/pricing/page.tsx`.
- Add a static curated media model rate table under the existing "Hosted model rates" section.
- Include GPT Image 2, Nano Banana Pro, Gemini Omni Flash, Veo 3.1, Veo 3.1 Fast, Seedance 2.0, Seedance 2.0 Fast, Kling v3 Pro, Kling v3 Standard, and Eleven Music v2.
- Keep auto captions at `$0.10/min` with `$0.10 minimum`.
- Add tests that protect the public rate rows and the static rendering contract.

Out of scope:
- Homepage pricing preview.
- Dynamic fetches from Supabase or `/api/v1/media/models`.
- Public estimate calculator.
- Backend seed migration.
- Harness UI.

## File Structure

- Create `lib/pricing-page-rates.ts`
  - Owns static public pricing-page data.
  - Exports `ChatModelRate`, `FeatureRate`, `MediaModelRate`, `chatModelRates`, `featureRates`, and `mediaModelRates`.
  - Includes a short drift-prevention comment tying public rates to backend `model_pricing_rules`.
- Create `tests/pricing-page-rates.test.ts`
  - Verifies the expected chat rows remain present.
  - Verifies the existing feature rows remain present, including the new auto-caption minimum.
  - Verifies all curated media rows and key endpoint IDs/rates.
- Create `tests/pricing-page-source.test.ts`
  - Verifies `/pricing` imports the static data module.
  - Verifies `/pricing` does not fetch runtime pricing data.
- Modify `app/pricing/page.tsx`
  - Remove inline `ModelRate`, `FeatureRate`, `models`, and `otherFeatures`.
  - Import pricing arrays from `@/lib/pricing-page-rates`.
  - Render chat and media tables in `ModelsTable`.
  - Keep `ToolsTable` as the "Other features" table, backed by `featureRates`.

## Task 1: Extract Static Pricing Data

**Files:**
- Create: `tests/pricing-page-rates.test.ts`
- Create: `lib/pricing-page-rates.ts`

- [ ] **Step 1: Write the failing pricing data test**

Create `tests/pricing-page-rates.test.ts` with this complete content:

```ts
import { describe, expect, it } from "vitest";

import {
  chatModelRates,
  featureRates,
  mediaModelRates,
} from "@/lib/pricing-page-rates";

describe("pricing page rates", () => {
  const mediaByName = new Map(mediaModelRates.map((rate) => [rate.name, rate]));

  it("keeps the hosted chat model rate rows available", () => {
    expect(chatModelRates.map((rate) => rate.name)).toEqual([
      "Claude Sonnet 4.6",
      "Claude Opus 4.8",
      "Claude Haiku 4.5",
      "GPT-5.5",
      "Kimi K2.6",
      "Grok 4.3",
    ]);

    expect(chatModelRates.find((rate) => rate.name === "GPT-5.5")).toMatchObject(
      {
        modelId: "openai/gpt-5.5",
        input: "$6.00/M",
        output: "$36.00/M",
        cacheRead: "$0.60/M",
        cacheWrite: "—",
      },
    );
  });

  it("keeps feature rates available for the other features table", () => {
    expect(featureRates).toEqual([
      {
        name: "Auto captions",
        description: "Generates word-timed captions from a reel voiceover.",
        rate: "$0.10/min",
        reference: "$0.10 minimum",
      },
      {
        name: "Web Search",
        description: "Searches the web for current info.",
        rate: "$0.012/call",
        reference: "$12.00 / 1K calls",
      },
      {
        name: "Web Fetch",
        description: "Reads a webpage.",
        rate: "$0.006/call",
        reference: "$6.00 / 1K calls",
      },
    ]);
  });

  it("publishes the curated hosted media model rows", () => {
    expect(mediaModelRates.map((rate) => rate.name)).toEqual([
      "GPT Image 2",
      "Nano Banana Pro",
      "Gemini Omni Flash",
      "Veo 3.1",
      "Veo 3.1 Fast",
      "Seedance 2.0",
      "Seedance 2.0 Fast",
      "Kling v3 Pro",
      "Kling v3 Standard",
      "Eleven Music v2",
    ]);

    expect(mediaByName.get("GPT Image 2")).toMatchObject({
      capability: "Image generation and editing",
      rate:
        "Text: $6.00/M input, $1.50/M cached, $12.00/M output · Image: $9.60/M input, $2.40/M cached, $36.00/M output",
      notes: "Actual request cost varies by image size and quality.",
    });

    expect(mediaByName.get("Nano Banana Pro")).toMatchObject({
      capability: "Image generation and editing",
      rate: "$0.18/image",
      notes: "4K: $0.36/image · Web search: +$0.018/request",
    });

    expect(mediaByName.get("Gemini Omni Flash")).toMatchObject({
      capability: "Video generation and editing",
      rate: "$1.20/generation",
      notes:
        "3-10 seconds. Treats Fal's $1 unit as one generation unit.",
    });

    expect(mediaByName.get("Veo 3.1")).toMatchObject({
      capability: "Video generation",
      rate: "$0.24/sec no audio · $0.48/sec audio",
      notes: "720p/1080p. 4K: $0.48/sec no audio, $0.72/sec audio.",
    });

    expect(mediaByName.get("Veo 3.1 Fast")).toMatchObject({
      capability: "Video generation",
      rate: "$0.12/sec no audio · $0.18/sec audio",
      notes: "720p/1080p. 4K: $0.36/sec no audio, $0.42/sec audio.",
    });

    expect(mediaByName.get("Seedance 2.0")).toMatchObject({
      capability: "Video generation",
      rate: "From $0.36/sec",
      notes:
        "720p. 1080p: $0.82/sec. Exact estimates shown before job submission.",
    });

    expect(mediaByName.get("Seedance 2.0 Fast")).toMatchObject({
      capability: "Video generation",
      rate: "From $0.29/sec",
      notes: "720p. Exact estimates shown before job submission.",
    });

    expect(mediaByName.get("Kling v3 Pro")).toMatchObject({
      capability: "Video generation",
      rate: "$0.13/sec audio off · $0.20/sec audio on",
      notes: "Voice control: $0.24/sec.",
    });

    expect(mediaByName.get("Kling v3 Standard")).toMatchObject({
      capability: "Video generation",
      rate: "$0.10/sec audio off · $0.15/sec audio on",
      notes: "Voice control: $0.18/sec.",
    });

    expect(mediaByName.get("Eleven Music v2")).toMatchObject({
      capability: "Music generation",
      modelIds: ["music_v2"],
      rate: "$0.20/min",
      notes: "$0.20 minimum. Up to 5 minutes.",
    });
  });

  it("lists provider endpoint IDs for endpoint-backed media rows", () => {
    expect(mediaByName.get("GPT Image 2")?.modelIds).toEqual([
      "openai/gpt-image-2",
      "openai/gpt-image-2/edit",
    ]);
    expect(mediaByName.get("Nano Banana Pro")?.modelIds).toEqual([
      "fal-ai/nano-banana-pro",
    ]);
    expect(mediaByName.get("Gemini Omni Flash")?.modelIds).toEqual([
      "fal-ai/gemini-omni-flash",
      "fal-ai/gemini-omni-flash/image-to-video",
      "fal-ai/gemini-omni-flash/reference-to-video",
      "fal-ai/gemini-omni-flash/edit",
    ]);
    expect(mediaByName.get("Kling v3 Pro")?.modelIds).toEqual([
      "fal-ai/kling-video/v3/pro/text-to-video",
      "fal-ai/kling-video/v3/pro/image-to-video",
    ]);
    expect(mediaByName.get("Kling v3 Standard")?.modelIds).toEqual([
      "fal-ai/kling-video/v3/standard/text-to-video",
      "fal-ai/kling-video/v3/standard/image-to-video",
    ]);
  });
});
```

- [ ] **Step 2: Run the failing pricing data test**

Run:

```bash
pnpm test tests/pricing-page-rates.test.ts
```

Expected: FAIL with an import error for `@/lib/pricing-page-rates`.

- [ ] **Step 3: Create the pricing data module**

Create `lib/pricing-page-rates.ts` with this complete content:

```ts
export type ChatModelRate = {
  name: string;
  modelId: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

export type FeatureRate = {
  name: string;
  description: string;
  rate: string;
  reference: string;
};

export type MediaModelRate = {
  name: string;
  capability: string;
  modelIds: string[];
  rate: string;
  notes: string;
};

// Public Woven rates after hosted markup. Keep this aligned with model_pricing_rules.
export const chatModelRates: ChatModelRate[] = [
  {
    name: "Claude Sonnet 4.6",
    modelId: "anthropic/claude-sonnet-4.6",
    input: "$3.60/M",
    output: "$18.00/M",
    cacheRead: "$0.36/M",
    cacheWrite: "$4.50/M",
  },
  {
    name: "Claude Opus 4.8",
    modelId: "anthropic/claude-opus-4.8",
    input: "$6.00/M",
    output: "$30.00/M",
    cacheRead: "$0.60/M",
    cacheWrite: "$7.50/M",
  },
  {
    name: "Claude Haiku 4.5",
    modelId: "anthropic/claude-haiku-4.5",
    input: "$1.20/M",
    output: "$6.00/M",
    cacheRead: "$0.12/M",
    cacheWrite: "$1.50/M",
  },
  {
    name: "GPT-5.5",
    modelId: "openai/gpt-5.5",
    input: "$6.00/M",
    output: "$36.00/M",
    cacheRead: "$0.60/M",
    cacheWrite: "—",
  },
  {
    name: "Kimi K2.6",
    modelId: "moonshotai/kimi-k2.6",
    input: "$1.14/M",
    output: "$4.80/M",
    cacheRead: "$0.19/M",
    cacheWrite: "—",
  },
  {
    name: "Grok 4.3",
    modelId: "xai/grok-4.3",
    input: "$1.50/M",
    output: "$3.00/M",
    cacheRead: "$0.24/M",
    cacheWrite: "—",
  },
];

export const mediaModelRates: MediaModelRate[] = [
  {
    name: "GPT Image 2",
    capability: "Image generation and editing",
    modelIds: ["openai/gpt-image-2", "openai/gpt-image-2/edit"],
    rate:
      "Text: $6.00/M input, $1.50/M cached, $12.00/M output · Image: $9.60/M input, $2.40/M cached, $36.00/M output",
    notes: "Actual request cost varies by image size and quality.",
  },
  {
    name: "Nano Banana Pro",
    capability: "Image generation and editing",
    modelIds: ["fal-ai/nano-banana-pro"],
    rate: "$0.18/image",
    notes: "4K: $0.36/image · Web search: +$0.018/request",
  },
  {
    name: "Gemini Omni Flash",
    capability: "Video generation and editing",
    modelIds: [
      "fal-ai/gemini-omni-flash",
      "fal-ai/gemini-omni-flash/image-to-video",
      "fal-ai/gemini-omni-flash/reference-to-video",
      "fal-ai/gemini-omni-flash/edit",
    ],
    rate: "$1.20/generation",
    notes: "3-10 seconds. Treats Fal's $1 unit as one generation unit.",
  },
  {
    name: "Veo 3.1",
    capability: "Video generation",
    modelIds: [
      "fal-ai/veo3.1",
      "fal-ai/veo3.1/image-to-video",
      "fal-ai/veo3.1/first-last-frame-to-video",
      "fal-ai/veo3.1/reference-to-video",
    ],
    rate: "$0.24/sec no audio · $0.48/sec audio",
    notes: "720p/1080p. 4K: $0.48/sec no audio, $0.72/sec audio.",
  },
  {
    name: "Veo 3.1 Fast",
    capability: "Video generation",
    modelIds: [
      "fal-ai/veo3.1/fast",
      "fal-ai/veo3.1/fast/image-to-video",
      "fal-ai/veo3.1/fast/first-last-frame-to-video",
    ],
    rate: "$0.12/sec no audio · $0.18/sec audio",
    notes: "720p/1080p. 4K: $0.36/sec no audio, $0.42/sec audio.",
  },
  {
    name: "Seedance 2.0",
    capability: "Video generation",
    modelIds: [
      "bytedance/seedance-2.0/text-to-video",
      "bytedance/seedance-2.0/image-to-video",
      "bytedance/seedance-2.0/reference-to-video",
    ],
    rate: "From $0.36/sec",
    notes: "720p. 1080p: $0.82/sec. Exact estimates shown before job submission.",
  },
  {
    name: "Seedance 2.0 Fast",
    capability: "Video generation",
    modelIds: [
      "bytedance/seedance-2.0/fast/text-to-video",
      "bytedance/seedance-2.0/fast/image-to-video",
      "bytedance/seedance-2.0/fast/reference-to-video",
    ],
    rate: "From $0.29/sec",
    notes: "720p. Exact estimates shown before job submission.",
  },
  {
    name: "Kling v3 Pro",
    capability: "Video generation",
    modelIds: [
      "fal-ai/kling-video/v3/pro/text-to-video",
      "fal-ai/kling-video/v3/pro/image-to-video",
    ],
    rate: "$0.13/sec audio off · $0.20/sec audio on",
    notes: "Voice control: $0.24/sec.",
  },
  {
    name: "Kling v3 Standard",
    capability: "Video generation",
    modelIds: [
      "fal-ai/kling-video/v3/standard/text-to-video",
      "fal-ai/kling-video/v3/standard/image-to-video",
    ],
    rate: "$0.10/sec audio off · $0.15/sec audio on",
    notes: "Voice control: $0.18/sec.",
  },
  {
    name: "Eleven Music v2",
    capability: "Music generation",
    modelIds: ["music_v2"],
    rate: "$0.20/min",
    notes: "$0.20 minimum. Up to 5 minutes.",
  },
];

export const featureRates: FeatureRate[] = [
  {
    name: "Auto captions",
    description: "Generates word-timed captions from a reel voiceover.",
    rate: "$0.10/min",
    reference: "$0.10 minimum",
  },
  {
    name: "Web Search",
    description: "Searches the web for current info.",
    rate: "$0.012/call",
    reference: "$12.00 / 1K calls",
  },
  {
    name: "Web Fetch",
    description: "Reads a webpage.",
    rate: "$0.006/call",
    reference: "$6.00 / 1K calls",
  },
];
```

- [ ] **Step 4: Run the pricing data test**

Run:

```bash
pnpm test tests/pricing-page-rates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the extracted pricing data**

Run:

```bash
git add lib/pricing-page-rates.ts tests/pricing-page-rates.test.ts
git commit -m "feat(pricing): centralize public rate data"
```

Expected: Commit succeeds.

## Task 2: Render Media Rates On Pricing Page

**Files:**
- Create: `tests/pricing-page-source.test.ts`
- Modify: `app/pricing/page.tsx`

- [ ] **Step 1: Write the failing static-source test**

Create `tests/pricing-page-source.test.ts` with this complete content:

```ts
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("pricing page source", () => {
  it("uses static pricing data instead of runtime model fetches", async () => {
    const source = await readFile("app/pricing/page.tsx", "utf8");

    expect(source).toContain("@/lib/pricing-page-rates");
    expect(source).toContain("mediaModelRates");
    expect(source).not.toMatch(
      /createSupabase|api\/v1\/media\/models|fetch\(|listMediaModels/,
    );
  });
});
```

- [ ] **Step 2: Run the failing static-source test**

Run:

```bash
pnpm test tests/pricing-page-source.test.ts
```

Expected: FAIL because `app/pricing/page.tsx` has not imported `@/lib/pricing-page-rates` yet.

- [ ] **Step 3: Import the pricing data module**

In `app/pricing/page.tsx`, add this import below the component imports:

```ts
import {
  chatModelRates,
  featureRates,
  mediaModelRates,
} from "@/lib/pricing-page-rates";
```

Remove these existing inline declarations from `app/pricing/page.tsx`:

```ts
type ModelRate = {
  name: string;
  modelId: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

type FeatureRate = {
  name: string;
  description: string;
  rate: string;
  reference: string;
};

const models: ModelRate[] = [
  {
    name: "Claude Sonnet 4.6",
    modelId: "anthropic/claude-sonnet-4.6",
    input: "$3.60/M",
    output: "$18.00/M",
    cacheRead: "$0.36/M",
    cacheWrite: "$4.50/M",
  },
  {
    name: "Claude Opus 4.8",
    modelId: "anthropic/claude-opus-4.8",
    input: "$6.00/M",
    output: "$30.00/M",
    cacheRead: "$0.60/M",
    cacheWrite: "$7.50/M",
  },
  {
    name: "Claude Haiku 4.5",
    modelId: "anthropic/claude-haiku-4.5",
    input: "$1.20/M",
    output: "$6.00/M",
    cacheRead: "$0.12/M",
    cacheWrite: "$1.50/M",
  },
  {
    name: "GPT-5.5",
    modelId: "openai/gpt-5.5",
    input: "$6.00/M",
    output: "$36.00/M",
    cacheRead: "$0.60/M",
    cacheWrite: "—",
  },
  {
    name: "Kimi K2.6",
    modelId: "moonshotai/kimi-k2.6",
    input: "$1.14/M",
    output: "$4.80/M",
    cacheRead: "$0.19/M",
    cacheWrite: "—",
  },
  {
    name: "Grok 4.3",
    modelId: "xai/grok-4.3",
    input: "$1.50/M",
    output: "$3.00/M",
    cacheRead: "$0.24/M",
    cacheWrite: "—",
  },
];

const otherFeatures: FeatureRate[] = [
  {
    name: "Auto captions",
    description: "Generates word-timed captions from a reel voiceover.",
    rate: "$0.10/min",
    reference: "$0.10 minimum",
  },
  {
    name: "Web Search",
    description: "Searches the web for current info.",
    rate: "$0.012/call",
    reference: "$12.00 / 1K calls",
  },
  {
    name: "Web Fetch",
    description: "Reads a webpage.",
    rate: "$0.006/call",
    reference: "$6.00 / 1K calls",
  },
];
```

- [ ] **Step 4: Replace `ModelsTable` with grouped chat and media tables**

Replace the entire existing `ModelsTable` function in `app/pricing/page.tsx` with this implementation:

```tsx
function ModelsTable() {
  return (
    <section id="models" className="pb-16">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="flex flex-col gap-2 pb-8">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Hosted model rates
          </h2>
          <p className="text-sm text-muted-foreground md:text-base">
            All prices in USD. Charges are deducted from your prepaid balance.
          </p>
        </div>

        <RateGroupHeader
          title="Chat models"
          description="Token pricing for hosted text models."
        />
        <ChatModelsTable />

        <div className="mt-10">
          <RateGroupHeader
            title="Media models"
            description="Image, video, and music generation pricing for Woven-hosted credits."
          />
        </div>
        <MediaModelsTable />
      </div>
    </section>
  );
}
```

Add these helper functions immediately after `ModelsTable`:

```tsx
function RateGroupHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1 pb-4">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ChatModelsTable() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl ring-1 ring-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-6 py-4 font-medium">Model</th>
              <th className="px-6 py-4 text-right font-medium">Input</th>
              <th className="px-6 py-4 text-right font-medium">Output</th>
              <th className="px-6 py-4 text-right font-medium">Cache read</th>
              <th className="px-6 py-4 text-right font-medium">Cache write</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {chatModelRates.map((model) => (
              <tr key={model.modelId}>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {model.name}
                    </span>
                    <code className="font-mono text-xs text-muted-foreground">
                      {model.modelId}
                    </code>
                  </div>
                </td>
                <td className="px-6 py-4 text-right tabular-nums">
                  {model.input}
                </td>
                <td className="px-6 py-4 text-right tabular-nums">
                  {model.output}
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                  {model.cacheRead}
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                  {model.cacheWrite}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {chatModelRates.map((model) => (
          <div
            key={model.modelId}
            className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{model.name}</span>
              <code className="font-mono text-xs text-muted-foreground">
                {model.modelId}
              </code>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Input</dt>
              <dd className="text-right tabular-nums">{model.input}</dd>
              <dt className="text-muted-foreground">Output</dt>
              <dd className="text-right tabular-nums">{model.output}</dd>
              <dt className="text-muted-foreground">Cache read</dt>
              <dd className="text-right tabular-nums">{model.cacheRead}</dd>
              <dt className="text-muted-foreground">Cache write</dt>
              <dd className="text-right tabular-nums">{model.cacheWrite}</dd>
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

function MediaModelsTable() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl ring-1 ring-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-[28%] px-6 py-4 font-medium">Model</th>
              <th className="w-[18%] px-6 py-4 font-medium">Capability</th>
              <th className="w-[28%] px-6 py-4 text-right font-medium">Rate</th>
              <th className="w-[26%] px-6 py-4 text-right font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {mediaModelRates.map((model) => (
              <tr key={model.name}>
                <td className="px-6 py-4 align-top">
                  <div className="flex flex-col gap-1.5">
                    <span className="font-medium text-foreground">
                      {model.name}
                    </span>
                    <div className="flex flex-col gap-1">
                      {model.modelIds.map((modelId) => (
                        <code
                          key={modelId}
                          className="break-all font-mono text-xs leading-relaxed text-muted-foreground"
                        >
                          {modelId}
                        </code>
                      ))}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 align-top text-muted-foreground">
                  {model.capability}
                </td>
                <td className="px-6 py-4 text-right align-top tabular-nums">
                  {model.rate}
                </td>
                <td className="px-6 py-4 text-right align-top text-muted-foreground">
                  {model.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {mediaModelRates.map((model) => (
          <div
            key={model.name}
            className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border"
          >
            <div className="flex flex-col gap-1.5">
              <span className="font-medium">{model.name}</span>
              <div className="flex flex-col gap-1">
                {model.modelIds.map((modelId) => (
                  <code
                    key={modelId}
                    className="break-all font-mono text-xs leading-relaxed text-muted-foreground"
                  >
                    {modelId}
                  </code>
                ))}
              </div>
            </div>
            <dl className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Capability</dt>
              <dd className="text-right">{model.capability}</dd>
              <dt className="text-muted-foreground">Rate</dt>
              <dd className="text-right tabular-nums">{model.rate}</dd>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="text-right text-muted-foreground">{model.notes}</dd>
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Update `ToolsTable` to use `featureRates`**

In `app/pricing/page.tsx`, replace both `otherFeatures.map` calls inside `ToolsTable` with `featureRates.map`.

The desktop table body should contain:

```tsx
<tbody className="divide-y divide-border bg-background">
  {featureRates.map((feature) => (
    <tr key={feature.name}>
      <td className="px-6 py-4">
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{feature.name}</span>
          <span className="text-xs text-muted-foreground">
            {feature.description}
          </span>
        </div>
      </td>
      <td className="px-6 py-4 text-right tabular-nums">{feature.rate}</td>
      <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
        {feature.reference}
      </td>
    </tr>
  ))}
</tbody>
```

The mobile card list should start with:

```tsx
<div className="flex flex-col gap-3 md:hidden">
  {featureRates.map((feature) => (
    <div
      key={feature.name}
      className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border"
    >
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
pnpm test tests/pricing-page-rates.test.ts tests/pricing-page-source.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the pricing page rendering change**

Run:

```bash
git add app/pricing/page.tsx tests/pricing-page-source.test.ts
git commit -m "feat(pricing): show hosted media model rates"
```

Expected: Commit succeeds.

## Task 3: Final Verification

**Files:**
- Verify: `lib/pricing-page-rates.ts`
- Verify: `app/pricing/page.tsx`
- Verify: `tests/pricing-page-rates.test.ts`
- Verify: `tests/pricing-page-source.test.ts`

- [ ] **Step 1: Run targeted pricing tests**

Run:

```bash
pnpm test tests/pricing-page-rates.test.ts tests/pricing-page-source.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat HEAD~2..HEAD
```

Expected: `git status --short` is clean after the two commits, and the diff stat includes only:
- `app/pricing/page.tsx`
- `lib/pricing-page-rates.ts`
- `tests/pricing-page-rates.test.ts`
- `tests/pricing-page-source.test.ts`

## Self-Review

- Spec coverage:
  - Static `/pricing` page: Task 2 source test rejects runtime fetches and Supabase access.
  - Typed module: Task 1 creates `lib/pricing-page-rates.ts`.
  - Separate chat, media, feature groups: Task 2 splits `ModelsTable` into chat and media helpers, leaving `ToolsTable` for feature rows.
  - Curated media rows: Task 1 test asserts the exact approved list and key rates.
  - Eleven Music v2: Task 1 includes `music_v2` at `$0.20/min` with `$0.20 minimum`.
  - Auto captions markup: Task 1 keeps `$0.10/min` and `$0.10 minimum`.
  - Backend route untouched: no task edits `app/api/v1/media/models` or `lib/media`.
- Placeholder scan:
  - No placeholder implementation text remains.
  - Each code-writing step includes exact code or exact replacement snippets.
- Type consistency:
  - `MediaModelRate` defines `name`, `capability`, `modelIds`, `rate`, and `notes`.
  - `MediaModelsTable` reads the same fields.
  - Tests import the exact exported identifiers from `lib/pricing-page-rates.ts`.
