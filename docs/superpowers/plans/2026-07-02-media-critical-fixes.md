# Media Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two critical defects from the hosted-media-jobs code review: (1) undeclared job parameters pass validation and flow into the fal provider request, letting users multiply Woven's provider cost while paying a flat price; (2) output download URLs are signed once at settle time with a 15-minute TTL and the same timestamp drives asset deletion, so paid outputs become permanently unreachable ~15 minutes after completion.

**Architecture:** Parameter fix: reject unknown keys at validation (`lib/media/schema.ts`) and, as defense-in-depth, drop undeclared keys in the fal adapter before merging over curated defaults. Output fix: split the single 15-minute timestamp into two — `media_assets.download_expires_at` becomes a 30-day **retention deadline** (written at settle, consumed unchanged by `markExpiredMediaForDeletion`), and download URLs are **re-minted on every status read** by a new `lib/media/output-urls.ts` presenter. `job.output.outputs` stops storing URLs entirely; it stores descriptors (`{id, type, content_type}`) and the status route composes fresh signed URLs from `media_assets` rows.

**Not needed:** No SQL migration — `mark_claimed_media_output_asset_ready(p_download_expires_at)` takes the timestamp as a parameter and the value is computed in TypeScript. No change to `lib/media/cleanup.ts` — its `download_expires_at < now` logic is unchanged; it now simply fires at 30 days instead of 15 minutes.

**Tech Stack:** Next.js route handlers, supabase-js admin client, WebCrypto HMAC tokens (`lib/media/tokens.ts`), vitest with `vi.hoisted`/`vi.doMock` module mocks. All patterns already exist in the repo.

**Docs digest:** `docs/superpowers/research/2026-07-01-hosted-generations-docs.md` (from the original hosted-media-jobs build). No new external APIs are introduced by this plan — every supabase-js call shape, token helper, and vitest pattern is copied from existing code in this repo.

**Verification commands (used throughout):**
- Tests: `pnpm test` (runs `vitest run`) or `pnpm exec vitest run <file>` for one file
- Types: `pnpm exec tsc --noEmit`
- Lint: `pnpm lint`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/media/schema.ts` | Modify | Reject parameter keys not declared in the model schema |
| `tests/media/schema.test.ts` | Modify | Cover unknown-key rejection |
| `lib/media/providers/fal.ts` | Modify | Drop undeclared keys before merging over `defaultParameters` |
| `tests/media/provider-adapters.test.ts` | Modify | Declare schema in merge test; cover undeclared-key dropping |
| `lib/media/env.ts` | Modify | Add `outputRetentionSeconds` (`MEDIA_OUTPUT_RETENTION_SECONDS`, default 30 days) |
| `tests/media/env.test.ts` | Modify | Cover parsing + default |
| `tests/media/assets.test.ts`, `tests/media/output-assets.test.ts` | Modify | Add new field to the two `MediaEnv`-typed fixtures |
| `.env.example` | Modify | Document the new env var |
| `lib/media/output-assets.ts` | Modify | Write retention deadline at settle; return descriptors, not signed URLs |
| `tests/media/worker.test.ts` | Modify | `wovenOutput()` helper drops url/expires_at |
| `lib/media/output-urls.ts` | **Create** | Read-time presenter: mint fresh download URLs from `media_assets` rows |
| `tests/media/output-urls.test.ts` | **Create** | Presenter behavior incl. retention cap and dead assets |
| `app/api/v1/media/jobs/[jobId]/route.ts` | Modify | Present outputs via the presenter on every read |
| `tests/media/job-routes.test.ts` | Modify | Status test mocks the presenter |

---

### Task 1: Reject undeclared parameters in `validateMediaParameters`

**Files:**
- Modify: `lib/media/schema.ts`
- Test: `tests/media/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `describe("validateMediaParameters")` block in `tests/media/schema.test.ts`:

```ts
  it("rejects parameters not declared in the schema", () => {
    expect(validateMediaParameters(
      { prompt: "a cat", num_images: 10 },
      {
        type: "object",
        required: ["prompt"],
        properties: { prompt: { type: "string" } },
      },
    )).toEqual({
      ok: false,
      error: "Unknown parameter: num_images.",
    });
  });

  it("accepts required keys that have no properties entry", () => {
    expect(validateMediaParameters(
      { prompt: "a cat" },
      { type: "object", required: ["prompt"] },
    )).toEqual({
      ok: true,
      value: { prompt: "a cat" },
    });
  });
```

The second test pins the allowlist rule: allowed keys = `properties` keys ∪ `required` keys, so a registry row that lists a key only under `required` still works.

- [ ] **Step 2: Run tests to verify the first fails**

Run: `pnpm exec vitest run tests/media/schema.test.ts`
Expected: `rejects parameters not declared in the schema` FAILS (currently returns `ok: true`); the other tests pass.

- [ ] **Step 3: Implement the unknown-key check**

In `lib/media/schema.ts`, insert between the `required` loop and the type-check loop (i.e. after line 14's closing of the `for (const key of schema.required ?? [])` loop):

```ts
  const declared = new Set([
    ...Object.keys(schema.properties ?? {}),
    ...(schema.required ?? []),
  ]);
  for (const key of Object.keys(value)) {
    if (!declared.has(key)) {
      return { ok: false, error: `Unknown parameter: ${key}.` };
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/media/schema.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/media/schema.ts tests/media/schema.test.ts
git commit -m "fix: reject undeclared media job parameters"
```

---

### Task 2: Drop undeclared parameters in the fal adapter (defense-in-depth)

Validation at job creation is the primary gate; this protects the provider call if a queued job row predates a schema narrowing or was written by any other path.

**Files:**
- Modify: `lib/media/providers/fal.ts`
- Test: `tests/media/provider-adapters.test.ts`

- [ ] **Step 1: Update the existing merge test to declare its schema**

In `tests/media/provider-adapters.test.ts`, the test `"submits a queued job with merged parameters and input urls"` passes `parameters: { prompt: "a mountain", guidance_scale: 5 }` against a model whose `parameterSchema` is the bare default `{ type: "object" }`. After this task those keys would be dropped, so declare them. Change the `model:` argument of that test from:

```ts
      model: mediaModel({
        defaultParameters: { guidance_scale: 3, safety_checker: true },
      }),
```

to:

```ts
      model: mediaModel({
        defaultParameters: { guidance_scale: 3, safety_checker: true },
        parameterSchema: {
          type: "object",
          required: ["prompt"],
          properties: { prompt: { type: "string" }, guidance_scale: { type: "number" } },
        },
      }),
```

The test's existing expectation (`guidance_scale: 5` overriding the default of `3`) is unchanged — declared keys are intentionally user-settable.

- [ ] **Step 2: Write the failing test**

Add to the `describe("falMediaAdapter")` block:

```ts
  it("drops parameters not declared in the model schema", async () => {
    const { falMediaAdapter } = await import("@/lib/media/providers/fal");
    mocks.falSubmit.mockResolvedValue({ request_id: "fal_req_2" });

    await falMediaAdapter.run({
      model: mediaModel({
        defaultParameters: { num_images: 1 },
        parameterSchema: {
          type: "object",
          required: ["prompt"],
          properties: { prompt: { type: "string" } },
        },
      }),
      parameters: { prompt: "a mountain", num_images: 10, resolution: "4k" },
      inputUrls: [],
    });

    expect(mocks.falSubmit).toHaveBeenCalledWith("fal-ai/frontier-video", {
      input: { num_images: 1, prompt: "a mountain" },
      abortSignal: undefined,
    });
  });
```

- [ ] **Step 3: Run tests to verify it fails**

Run: `pnpm exec vitest run tests/media/provider-adapters.test.ts`
Expected: the new test FAILS — `input` currently contains `num_images: 10` and `resolution: "4k"`.

- [ ] **Step 4: Implement the filter**

In `lib/media/providers/fal.ts`:

Add the type import at the top:

```ts
import type { MediaParameterSchema } from "@/lib/media/types";
```

Change the input merge (currently lines 14–17) from:

```ts
    const input: Record<string, unknown> = {
      ...model.defaultParameters,
      ...parameters,
    };
```

to:

```ts
    const input: Record<string, unknown> = {
      ...model.defaultParameters,
      ...declaredParameters(parameters, model.parameterSchema),
    };
```

Add the helper next to the other module-level helpers (e.g. after `extractFalOutputs`):

```ts
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
```

(The ElevenLabs adapter needs no change — it reads specific keys explicitly and never spreads user parameters.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/media/provider-adapters.test.ts`
Expected: all tests PASS, including the updated merge test.

- [ ] **Step 6: Commit**

```bash
git add lib/media/providers/fal.ts tests/media/provider-adapters.test.ts
git commit -m "fix: drop undeclared parameters in fal adapter"
```

---

### Task 3: Add `outputRetentionSeconds` to media env

**Files:**
- Modify: `lib/media/env.ts`
- Modify: `tests/media/env.test.ts`
- Modify: `tests/media/output-assets.test.ts` (typed fixture, line ~25)
- Modify: `tests/media/assets.test.ts` (typed fixture, line ~24)
- Modify: `.env.example`

- [ ] **Step 1: Write the failing tests**

In `tests/media/env.test.ts`, extend the `"parses positive integer settings"` test:

```ts
  it("parses positive integer settings", () => {
    setMediaEnv({
      MEDIA_MAX_UPLOAD_BYTES: "123",
      MEDIA_UPLOAD_URL_TTL_SECONDS: "456",
      MEDIA_DOWNLOAD_URL_TTL_SECONDS: "789",
      MEDIA_OUTPUT_RETENTION_SECONDS: "3600",
    });

    expect(getMediaEnv()).toMatchObject({
      maxUploadBytes: 123,
      uploadUrlTtlSeconds: 456,
      downloadUrlTtlSeconds: 789,
      outputRetentionSeconds: 3600,
    });
  });
```

And add a new test after it:

```ts
  it("defaults output retention to 30 days", () => {
    setMediaEnv();

    expect(getMediaEnv().outputRetentionSeconds).toBe(2_592_000);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/media/env.test.ts`
Expected: both new assertions FAIL (`outputRetentionSeconds` is `undefined`).

- [ ] **Step 3: Implement**

In `lib/media/env.ts`, add to the `MediaEnv` type after `downloadUrlTtlSeconds: number;`:

```ts
  outputRetentionSeconds: number;
```

And to the object returned by `getMediaEnv()` after the `downloadUrlTtlSeconds` line:

```ts
    outputRetentionSeconds: integerEnv("MEDIA_OUTPUT_RETENTION_SECONDS", 30 * 24 * 60 * 60),
```

- [ ] **Step 4: Fix the two `MediaEnv`-typed test fixtures**

The `MediaEnv` type now requires the new field, which breaks typechecking in exactly two fixtures (`const mediaEnv: MediaEnv = {...}`); the other env mocks in the test suite are untyped object literals and need no change.

In `tests/media/output-assets.test.ts` (fixture at line ~25) add after `downloadUrlTtlSeconds: 120,`:

```ts
  outputRetentionSeconds: 2_592_000,
```

In `tests/media/assets.test.ts` (fixture at line ~24) add after `downloadUrlTtlSeconds: 60,`:

```ts
  outputRetentionSeconds: 2_592_000,
```

- [ ] **Step 5: Document in `.env.example`**

Add after the `MEDIA_DOWNLOAD_URL_TTL_SECONDS=900` line:

```
# How long finished job outputs remain downloadable (seconds; default 30 days).
# The cleanup route marks assets past this deadline as deleted. Download links
# themselves are short-lived and re-signed on every job status read.
MEDIA_OUTPUT_RETENTION_SECONDS=2592000
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm exec vitest run tests/media/env.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/media/env.ts tests/media/env.test.ts tests/media/output-assets.test.ts tests/media/assets.test.ts .env.example
git commit -m "feat: add media output retention env setting"
```

---

### Task 4: Settle path writes the retention deadline and stores descriptors, not URLs

**Files:**
- Modify: `lib/media/output-assets.ts`
- Test: `tests/media/output-assets.test.ts`
- Modify: `tests/media/worker.test.ts` (helper only)

- [ ] **Step 1: Update the primary settle-path test to the new contract**

In `tests/media/output-assets.test.ts`, test `"uses inline bytes without fetching the provider URL, claim-fences mutations, and returns a Woven download URL"`:

1. Rename it to `"uses inline bytes without fetching the provider URL, claim-fences mutations, and returns output descriptors"`.
2. In the `mark_claimed_media_output_asset_ready` expectation, change `p_download_expires_at` from `"2026-07-01T12:02:00.000Z"` to `"2026-07-31T12:00:00.000Z"` (fake time 2026-07-01T12:00Z + the fixture's `outputRetentionSeconds: 2_592_000`).
3. Replace the output-shape assertions — everything from `expect(result.outputs).toHaveLength(1);` through the final `verifyMediaToken(downloadToken, ...)` block at the end of the test — with:

```ts
    expect(result.outputs).toEqual([{
      id: outputId,
      type: "audio",
      content_type: "audio/mpeg",
    }]);
```

- [ ] **Step 2: Sweep the rest of the file for the same two contract changes**

Run: `pnpm exec vitest run tests/media/output-assets.test.ts` — it passes today; the goal of this step is to locate every other assertion that pins the old contract before changing the implementation. Search the file for these two patterns and update each occurrence:

- Every `p_download_expires_at:` expectation asserts fake-time + 120s (the old `downloadUrlTtlSeconds`); change each to fake-time + 2_592_000s. For tests frozen at `2026-07-01T12:00:00.000Z` that is `"2026-07-31T12:00:00.000Z"`.
- Every assertion on entries of `result.outputs` that expects `url` and/or `expires_at` keys (including any `verifyMediaToken(...)` verification of a download token extracted from `result.outputs[n].url`): the entry is now exactly `{ id, type, content_type }`. Replace with a `toEqual`/`toMatchObject` on those three keys and delete the URL/token verification lines. The reuse-path test asserts `result.outputs` for a reused asset — its descriptor is built from the provider output the same way, so the same replacement applies.

Do not touch assertions about `attemptAssets`, `p_metadata`, upload tokens (`kind: "upload"`), or the `fetch` upload call — those are unchanged.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/media/output-assets.test.ts`
Expected: FAIL — implementation still signs URLs at settle and uses the 120s TTL for `p_download_expires_at`.

- [ ] **Step 4: Implement in `lib/media/output-assets.ts`**

**(a)** In `markOutputAssetReady` (line ~427), replace:

```ts
  const downloadExp = Math.floor(Date.now() / 1000) + env.downloadUrlTtlSeconds;
```

with:

```ts
  // download_expires_at is the retention deadline consumed by
  // markExpiredMediaForDeletion, not a URL TTL — download links are minted
  // per status read in lib/media/output-urls.ts.
  const retentionExp = Math.floor(Date.now() / 1000) + env.outputRetentionSeconds;
```

and update the RPC argument from `new Date(downloadExp * 1000).toISOString()` to `new Date(retentionExp * 1000).toISOString()`.

**(b)** Replace the entire `publicOutputObject` function (lines ~463–495) with a synchronous descriptor builder:

```ts
function outputDescriptor(outputId: string, output: ProviderOutput) {
  return {
    id: outputId,
    type: output.type,
    content_type: output.contentType,
  };
}
```

**(c)** Update both call sites in `materializeOutputAsset`:

Reuse path (line ~170) — replace:

```ts
      output: await publicOutputObject({
        env,
        userId,
        jobId,
        outputId,
        storageKey: existing.storage_key,
        output,
      }),
```

with:

```ts
      output: outputDescriptor(outputId, output),
```

Fresh path (line ~234) — replace:

```ts
    output: await publicOutputObject({ env, userId, jobId, outputId, storageKey, output }),
```

with:

```ts
    output: outputDescriptor(outputId, output),
```

- [ ] **Step 5: Update the worker test helper to the descriptor shape**

Worker tests mock `createOutputAssetRows` and pass its return value through to the settle RPC, so they pass either way — but the fixture should model reality. In `tests/media/worker.test.ts`, `wovenOutput()` (line ~803), delete the `url:` and `expires_at:` lines so it returns:

```ts
function wovenOutput() {
  return {
    id: "output_asset_1",
    type: "video",
    content_type: "video/mp4",
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/media/output-assets.test.ts tests/media/worker.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, no type errors (if `tsc` reports unused imports/variables in `output-assets.ts` — e.g. `env` destructuring at a call site — remove exactly those).

- [ ] **Step 7: Commit**

```bash
git add lib/media/output-assets.ts tests/media/output-assets.test.ts tests/media/worker.test.ts
git commit -m "fix: store retention deadline and output descriptors at settle"
```

---

### Task 5: Read-time URL presenter (`lib/media/output-urls.ts`)

**Files:**
- Create: `lib/media/output-urls.ts`
- Create: `tests/media/output-urls.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/media/output-urls.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaEnv } from "@/lib/media/env";
import { presentJobOutputs } from "@/lib/media/output-urls";
import { verifyMediaToken } from "@/lib/media/tokens";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  getMediaEnv: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

vi.mock("@/lib/media/env", () => ({
  getMediaEnv: mocks.getMediaEnv,
}));

const mediaEnv: MediaEnv = {
  baseUrl: "https://media.example.test",
  tokenSecret: "test-token-secret",
  workerSharedSecret: "test-worker-secret",
  maxUploadBytes: 1_000,
  uploadUrlTtlSeconds: 60,
  downloadUrlTtlSeconds: 120,
  outputRetentionSeconds: 2_592_000,
};
const nowSeconds = Math.floor(Date.parse("2026-07-01T12:00:00.000Z") / 1000);

function mockAdminWith(rows: unknown[], error: { message: string } | null = null) {
  const chain = {
    eq: vi.fn(() => chain),
    in: vi.fn(async () => ({ data: rows, error })),
  };
  const select = vi.fn(() => chain);
  const from = vi.fn(() => ({ select }));
  mocks.createSupabaseAdminClient.mockReturnValue({ from });
  return { from, select, chain };
}

describe("presentJobOutputs", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    mocks.getMediaEnv.mockReset();
    mocks.getMediaEnv.mockReturnValue(mediaEnv);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("mints a fresh scoped download URL for ready assets", async () => {
    const { from, chain } = mockAdminWith([{
      id: "out_1",
      storage_key: "users/user_1/media/outputs/job_1/out_1/attempts/attempt_1/output.mp4",
      status: "ready",
      download_expires_at: "2026-07-31T12:00:00.000Z",
    }]);

    const outputs = await presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ id: "out_1", type: "video", content_type: "video/mp4" }],
    });

    expect(from).toHaveBeenCalledWith("media_assets");
    expect(chain.eq.mock.calls).toEqual([
      ["user_id", "user_1"],
      ["job_id", "job_1"],
      ["kind", "output"],
    ]);
    expect(chain.in).toHaveBeenCalledWith("id", ["out_1"]);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      id: "out_1",
      type: "video",
      content_type: "video/mp4",
      expires_at: "2026-07-01T12:02:00.000Z",
    });
    const url = new URL(outputs[0].url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://media.example.test/objects/out_1");
    await expect(verifyMediaToken(url.searchParams.get("token") ?? "", mediaEnv.tokenSecret, nowSeconds))
      .resolves.toMatchObject({
        kind: "download",
        sub: "user_1",
        key: "users/user_1/media/outputs/job_1/out_1/attempts/attempt_1/output.mp4",
        assetId: "out_1",
        jobId: "job_1",
        exp: nowSeconds + mediaEnv.downloadUrlTtlSeconds,
      });
  });

  it("caps the URL expiry at the retention deadline", async () => {
    mockAdminWith([{
      id: "out_1",
      storage_key: "users/user_1/media/outputs/job_1/out_1/attempts/attempt_1/output.mp4",
      status: "ready",
      download_expires_at: "2026-07-01T12:01:00.000Z",
    }]);

    const outputs = await presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ id: "out_1", type: "video", content_type: "video/mp4" }],
    });

    expect(outputs[0].expires_at).toBe("2026-07-01T12:01:00.000Z");
    const token = new URL(outputs[0].url ?? "").searchParams.get("token") ?? "";
    await expect(verifyMediaToken(token, mediaEnv.tokenSecret, nowSeconds)).resolves.toMatchObject({
      exp: nowSeconds + 60,
    });
  });

  it("returns null urls for missing, deleted, and retention-expired assets", async () => {
    mockAdminWith([
      {
        id: "out_deleted",
        storage_key: "users/user_1/media/outputs/job_1/out_deleted/attempts/attempt_1/output.mp4",
        status: "deleted",
        download_expires_at: "2026-07-31T12:00:00.000Z",
      },
      {
        id: "out_expired",
        storage_key: "users/user_1/media/outputs/job_1/out_expired/attempts/attempt_1/output.mp4",
        status: "ready",
        download_expires_at: "2026-07-01T11:59:59.000Z",
      },
    ]);

    const outputs = await presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [
        { id: "out_deleted", type: "video", content_type: "video/mp4" },
        { id: "out_expired", type: "video", content_type: "video/mp4" },
        { id: "out_missing", type: "video", content_type: "video/mp4" },
      ],
    });

    expect(outputs).toEqual([
      { id: "out_deleted", type: "video", content_type: "video/mp4", url: null, expires_at: null },
      { id: "out_expired", type: "video", content_type: "video/mp4", url: null, expires_at: null },
      { id: "out_missing", type: "video", content_type: "video/mp4", url: null, expires_at: null },
    ]);
  });

  it("skips the query entirely when no stored outputs have usable ids", async () => {
    const { from } = mockAdminWith([]);

    await expect(presentJobOutputs({ userId: "user_1", jobId: "job_1", outputs: [] }))
      .resolves.toEqual([]);
    await expect(presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ type: "video" }, "not-an-object", null],
    })).resolves.toEqual([]);

    expect(from).not.toHaveBeenCalled();
  });

  it("throws when the asset lookup fails", async () => {
    mockAdminWith([], { message: "boom" });

    await expect(presentJobOutputs({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ id: "out_1", type: "video", content_type: "video/mp4" }],
    })).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/media/output-urls.test.ts`
Expected: FAIL — module `@/lib/media/output-urls` does not exist.

- [ ] **Step 3: Implement the presenter**

Create `lib/media/output-urls.ts`:

```ts
import { getMediaEnv } from "@/lib/media/env";
import { signMediaToken } from "@/lib/media/tokens";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type StoredOutput = {
  id: string;
  type: string | null;
  content_type: string | null;
};

export type PresentedOutput = StoredOutput & {
  url: string | null;
  expires_at: string | null;
};

type OutputAssetRow = {
  id: string;
  storage_key: string | null;
  status: string;
  download_expires_at: string | null;
};

export async function presentJobOutputs({
  userId,
  jobId,
  outputs,
}: {
  userId: string;
  jobId: string;
  outputs: unknown[];
}): Promise<PresentedOutput[]> {
  const stored = outputs
    .map(storedOutput)
    .filter((output): output is StoredOutput => output !== null);
  if (stored.length === 0) {
    return [];
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("media_assets")
    .select("id, storage_key, status, download_expires_at")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("kind", "output")
    .in("id", stored.map((output) => output.id));

  if (error) {
    throw new Error(error.message);
  }

  const rows = new Map(((data ?? []) as OutputAssetRow[]).map((row) => [row.id, row]));
  const env = getMediaEnv();
  const nowSeconds = Math.floor(Date.now() / 1000);

  return Promise.all(stored.map(async (output) => {
    const row = rows.get(output.id);
    const retentionExp = retentionExpSeconds(row);
    if (!row || row.status !== "ready" || !row.storage_key || (retentionExp !== null && retentionExp <= nowSeconds)) {
      return { ...output, url: null, expires_at: null };
    }

    const exp = retentionExp === null
      ? nowSeconds + env.downloadUrlTtlSeconds
      : Math.min(nowSeconds + env.downloadUrlTtlSeconds, retentionExp);
    const token = await signMediaToken({
      kind: "download",
      sub: userId,
      key: row.storage_key,
      assetId: output.id,
      jobId,
      exp,
    }, env.tokenSecret);

    return {
      ...output,
      url: `${env.baseUrl}/objects/${output.id}?token=${encodeURIComponent(token)}`,
      expires_at: new Date(exp * 1000).toISOString(),
    };
  }));
}

function retentionExpSeconds(row: OutputAssetRow | undefined): number | null {
  if (!row?.download_expires_at) return null;
  const parsed = Date.parse(row.download_expires_at);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function storedOutput(value: unknown): StoredOutput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id : null;
  if (!id) return null;

  return {
    id,
    type: typeof record.type === "string" ? record.type : null,
    content_type: typeof record.content_type === "string" ? record.content_type : null,
  };
}
```

Note `storedOutput` deliberately rebuilds `{id, type, content_type}` and drops everything else — any legacy `job.output.outputs` entry that still carries a stale settle-time `url`/`expires_at` gets replaced, never echoed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/media/output-urls.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/media/output-urls.ts tests/media/output-urls.test.ts
git commit -m "feat: sign media output download urls on read"
```

---

### Task 6: Status route re-signs outputs on every read

**Files:**
- Modify: `app/api/v1/media/jobs/[jobId]/route.ts`
- Test: `tests/media/job-routes.test.ts`

- [ ] **Step 1: Update the status-route test**

In `tests/media/job-routes.test.ts`:

**(a)** Add to the `afterEach` unmock list:

```ts
    vi.doUnmock("@/lib/media/output-urls");
```

**(b)** Rewrite the test `"returns status outputs and a generic public provider error message"` — keep the auth and supabase mocks exactly as they are, and add a presenter mock; rename it to `"re-signs stored outputs on read and returns a generic public provider error message"`. After the existing `vi.doMock("@/lib/supabase/admin", ...)` call, add:

```ts
    const presentJobOutputs = vi.fn(async () => ([{
      id: "out_1",
      type: "video",
      content_type: "video/mp4",
      url: "https://media.example.test/objects/out_1?token=fresh",
      expires_at: "2026-07-01T12:17:00.000Z",
    }]));
    vi.doMock("@/lib/media/output-urls", () => ({ presentJobOutputs }));
```

Then extend the assertions at the end of the test:

```ts
    expect(presentJobOutputs).toHaveBeenCalledWith({
      userId: "user_1",
      jobId: "job_1",
      outputs: [{ id: "out_1", type: "video" }],
    });
    await expect(response.json()).resolves.toMatchObject({
      id: "job_1",
      status: "failed",
      model: "fal:output-model",
      outputs: [{
        id: "out_1",
        url: "https://media.example.test/objects/out_1?token=fresh",
        expires_at: "2026-07-01T12:17:00.000Z",
      }],
      error: { code: "provider_failed", message: "Generation failed." },
    });
```

(Replace the previous `outputs: [{ id: "out_1", type: "video" }]` expectation; note `response.json()` can only be read once, so fold both checks into the single `toMatchObject`.)

**(c)** Add a new test for presenter failure, using the same auth/supabase mock setup as (b) (copy those mocks verbatim):

```ts
  it("returns a 500 when output url signing fails", async () => {
    // ...same vi.doMock("@/lib/api/auth", ...) and vi.doMock("@/lib/supabase/admin", ...)
    // setup as the re-signing test above, with the same maybeSingle job row...
    vi.doMock("@/lib/media/output-urls", () => ({
      presentJobOutputs: vi.fn(async () => {
        throw new Error("MEDIA_TOKEN_SECRET missing");
      }),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/v1/media/jobs/[jobId]/route");
    const response = await GET(
      new Request("https://example.test/api/v1/media/jobs/job_1"),
      { params: Promise.resolve({ jobId: "job_1" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "media_job_lookup_failed" },
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/media/job-routes.test.ts`
Expected: both touched tests FAIL — the route neither calls the presenter nor handles its errors.

- [ ] **Step 3: Implement the route change**

In `app/api/v1/media/jobs/[jobId]/route.ts`:

Add the import:

```ts
import { presentJobOutputs } from "@/lib/media/output-urls";
```

Replace the line:

```ts
  const outputs = Array.isArray(output.outputs) ? output.outputs : [];
```

with:

```ts
  let outputs;
  try {
    outputs = await presentJobOutputs({
      userId: authResult.auth.user.id,
      jobId: job.id,
      outputs: Array.isArray(output.outputs) ? output.outputs : [],
    });
  } catch (presentError) {
    console.error("Failed to sign media job output urls", presentError);
    return apiError("Unable to look up media job.", 500, "media_job_lookup_failed");
  }
```

The `Response.json({ ..., outputs, ... })` usage below is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/media/job-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/v1/media/jobs/[jobId]/route.ts" tests/media/job-routes.test.ts
git commit -m "fix: re-sign media job output urls on status reads"
```

---

### Task 7: Full verification sweep

**Files:** none (verification only; fix anything that surfaces)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all test files pass (145 pre-existing tests plus the ones added by Tasks 1–6). If any test outside the files touched above fails on the output shape or `p_download_expires_at`, apply the Task 4 Step 2 transformation rules to it.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no type errors; no new lint errors (the pre-existing `import/no-anonymous-default-export` warning in `workers/media/index.ts` is out of scope).

- [ ] **Step 3: Commit any straggler fixes**

Only if Step 1 or 2 required changes:

```bash
git add -A
git commit -m "test: align remaining media tests with output descriptor contract"
```

---

## Out of scope (tracked separately from the review)

- Reserve-before-claim race (`claim_media_jobs` predicate) — Important #3.
- Fal webhook authentication/wiring — Important #5.
- Physical R2 deletion / lifecycle rules — Important #6.
- Real-database concurrency tests for the claim/settle RPCs — Important #9.
- A `GET /jobs` list endpoint (users must retain job IDs to re-fetch outputs).
