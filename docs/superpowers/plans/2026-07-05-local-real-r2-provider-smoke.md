# Local Real R2 Provider Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let local Harness run uploaded-input media generations end to end against local Supabase and Trigger.dev dev while storing media bytes in real dev Cloudflare R2 behind `https://media-dev.woven.video`.

**Architecture:** Keep the existing Woven API, media Worker, and R2 upload/download contract. Add an explicit upload-completion mode split: production Worker deployments use callback completion, while the local provider-smoke profile uses manual completion through an authenticated local API route after the dev Worker PUT succeeds.

**Tech Stack:** Next.js 16.2.3 App Router route handlers, TypeScript, Vitest, Cloudflare Workers/R2/Wrangler, Supabase, Trigger.dev, Fal.

**Docs digest:** `docs/superpowers/research/2026-07-05-local-real-r2-smoke-docs.md`; existing Next.js route-handler notes in `docs/superpowers/research/2026-07-01-hosted-generations-docs.md`.

## Global Constraints

- Use real Cloudflare R2 only for opt-in local provider smoke media bytes.
- Use separate dev R2 bucket `woven-media-dev`.
- Use separate public dev Worker domain `https://media-dev.woven.video`.
- Keep production storage isolated on `media.woven.video` and `woven-media`.
- Keep automated tests off real R2/Fal by default.
- Keep `media:edge:local` for Worker route development, not for real provider smoke tests involving uploaded inputs.
- Do not use a public tunnel as the normal local provider-smoke path.
- Do not reuse the production Worker/bucket for local smoke tests.
- Do not give Harness `MEDIA_WORKER_SHARED_SECRET`.
- Production upload completion remains Worker-owned callback mode.
- Manual completion is enabled only in the local/provider-smoke profile and uses the user's normal bearer token.
- Route handlers live in `app/**/route.ts`, use Web `Request`/`Response`, and dynamic route params are promises in this Next.js version.

---

## File Structure

| Path | Change | Responsibility |
| --- | --- | --- |
| `lib/media/env.ts` | Modify | Parse upload completion mode and expose localhost media-base-url detection without requiring callers to duplicate env parsing. |
| `tests/media/env.test.ts` | Modify | Cover completion-mode parsing and localhost detection. |
| `workers/media/index.ts` | Modify | Respect `UPLOAD_COMPLETION_MODE=callback|manual` for input uploads while keeping output uploads unchanged. |
| `tests/media/media-worker.test.ts` | Modify | Cover manual Worker mode and invalid mode failure. |
| `workers/media/wrangler.jsonc` | Modify | Add dev Worker environment with `media-dev.woven.video`, `woven-media-dev`, and manual completion mode. |
| `workers/media/r2-dev-lifecycle.json` | Create | Document/apply dev R2 lifecycle cleanup for smoke-test objects. |
| `package.json` | Modify | Add dev Worker deploy and local provider-smoke scripts. |
| `lib/media/assets.ts` | Modify | Add authenticated-user manual completion helper that never accepts client-provided storage keys. |
| `app/api/v1/media/uploads/route.ts` | Modify | Include local manual completion instructions in upload responses only when manual mode is active. |
| `app/api/v1/media/uploads/[assetId]/complete/route.ts` | Create | Authenticated local-smoke completion endpoint. |
| `tests/media/assets.test.ts` | Modify | Cover manual completion helper, upload response contract, and local completion route. |
| `lib/media/provider-input-urls.ts` | Create | Keep the provider-fetchable base URL guard out of job creation internals. |
| `app/api/v1/media/jobs/route.ts` | Modify | Reject uploaded-input provider jobs early when `MEDIA_BASE_URL` is localhost. |
| `tests/media/job-routes.test.ts` | Modify | Cover local misconfiguration guard without blocking text-only jobs. |
| `.env.example` | Modify | Document `MEDIA_UPLOAD_COMPLETION_MODE` and the local smoke profile values. |
| `docs/media-worker-deploy.md` | Modify | Update deployment/local runbook with dev Worker/R2 provisioning and local smoke commands. |

---

### Task 1: Media Env Completion Mode

**Files:**
- Modify: `lib/media/env.ts`
- Modify: `tests/media/env.test.ts`

**Interfaces:**
- Produces: `type MediaUploadCompletionMode = "callback" | "manual"`
- Produces: `MediaEnv.uploadCompletionMode: MediaUploadCompletionMode`
- Produces: `isLoopbackMediaBaseUrl(baseUrl: string): boolean`
- Consumes: no new interfaces from earlier tasks

- [ ] **Step 1: Write failing env tests**

Add these tests to `tests/media/env.test.ts` inside `describe("media env", ...)`:

```ts
  it("defaults upload completion mode to callback and parses manual mode", () => {
    setMediaEnv();
    expect(getMediaEnv().uploadCompletionMode).toBe("callback");

    setMediaEnv({
      MEDIA_UPLOAD_COMPLETION_MODE: "manual",
    });
    expect(getMediaEnv().uploadCompletionMode).toBe("manual");
  });

  it("rejects unknown upload completion modes", () => {
    setMediaEnv({
      MEDIA_UPLOAD_COMPLETION_MODE: "client",
    });

    expect(() => getMediaEnv()).toThrow(
      "MEDIA_UPLOAD_COMPLETION_MODE must be callback or manual.",
    );
  });
```

Update the import at the top of `tests/media/env.test.ts`:

```ts
import {
  getMediaEnv,
  getMediaJobTimeoutSeconds,
  isLoopbackMediaBaseUrl,
} from "@/lib/media/env";
```

Add this test near the base URL test:

```ts
  it("detects media base URLs that cloud providers cannot fetch", () => {
    expect(isLoopbackMediaBaseUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackMediaBaseUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackMediaBaseUrl("http://dev.localhost:8787")).toBe(true);
    expect(isLoopbackMediaBaseUrl("http://[::1]:8787")).toBe(true);

    expect(isLoopbackMediaBaseUrl("https://media-dev.woven.video")).toBe(false);
    expect(isLoopbackMediaBaseUrl("https://media.woven.video")).toBe(false);
    expect(isLoopbackMediaBaseUrl("not a url")).toBe(false);
  });
```

- [ ] **Step 2: Run env tests and verify failure**

Run:

```bash
pnpm test tests/media/env.test.ts
```

Expected: FAIL because `uploadCompletionMode` and `isLoopbackMediaBaseUrl` do not exist yet.

- [ ] **Step 3: Implement env parsing**

Update `lib/media/env.ts` with these exact additions:

```ts
export type MediaUploadCompletionMode = "callback" | "manual";

export type MediaEnv = {
  baseUrl: string;
  tokenSecret: string;
  workerSharedSecret: string;
  maxUploadBytes: number;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
  outputRetentionSeconds: number;
  jobTimeoutSeconds: number;
  uploadCompletionMode: MediaUploadCompletionMode;
  falWebhookBaseUrl: string | null;
  falWebhookJwksUrl: string | null;
};
```

Add this helper after `optionalUrlEnv`:

```ts
function uploadCompletionModeEnv(): MediaUploadCompletionMode {
  const raw = process.env.MEDIA_UPLOAD_COMPLETION_MODE?.trim() || "callback";
  if (raw === "callback" || raw === "manual") {
    return raw;
  }
  throw new Error("MEDIA_UPLOAD_COMPLETION_MODE must be callback or manual.");
}

export function isLoopbackMediaBaseUrl(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}
```

Add the field to the object returned by `getMediaEnv()`:

```ts
    uploadCompletionMode: uploadCompletionModeEnv(),
```

- [ ] **Step 4: Run env tests and verify pass**

Run:

```bash
pnpm test tests/media/env.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/media/env.ts tests/media/env.test.ts
git commit -m "feat(media): parse upload completion mode"
```

---

### Task 2: Media Worker Manual Completion Mode

**Files:**
- Modify: `workers/media/index.ts`
- Modify: `tests/media/media-worker.test.ts`
- Modify: `workers/media/wrangler.jsonc`
- Modify: `package.json`
- Create: `workers/media/r2-dev-lifecycle.json`

**Interfaces:**
- Consumes: `UPLOAD_COMPLETION_MODE=callback|manual` Worker var
- Produces: Worker input uploads return `{ ok: true }` without app callback when `UPLOAD_COMPLETION_MODE=manual`
- Produces: `pnpm run media:edge:deploy:dev`
- Produces: `pnpm run media:dev:smoke`

- [ ] **Step 1: Write failing Worker tests**

Update the `WorkerEnv` type in `tests/media/media-worker.test.ts`:

```ts
type WorkerEnv = {
  MEDIA_BUCKET: FakeBucket;
  MEDIA_TOKEN_SECRET: string;
  MEDIA_WORKER_SHARED_SECRET: string;
  WOVEN_API_BASE_URL: string;
  MEDIA_MAX_UPLOAD_BYTES: string;
  UPLOAD_COMPLETION_MODE?: string;
};
```

Add these tests after `"writes valid uploads to R2 and calls the completion endpoint"`:

```ts
  it("writes valid input uploads in manual mode without calling the completion endpoint", async () => {
    const env = testEnv({ uploadCompletionMode: "manual" });
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 14,
    });
    const completionFetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/uploads/asset_1?token=${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          "content-length": "14",
        },
        body: "uploaded bytes",
      },
    ), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(env.MEDIA_BUCKET.puts).toEqual([{
      key: "users/user_1/media/tmp/asset_1/input.png",
      text: "uploaded bytes",
      options: {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { "user-id": "user_1", "asset-id": "asset_1" },
      },
    }]);
    expect(completionFetch).not.toHaveBeenCalled();
  });

  it("rejects unknown upload completion modes before storing the upload", async () => {
    const env = testEnv({ uploadCompletionMode: "client" });
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 5,
    });
    const completionFetch = vi.fn();
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(uploadRequest("asset_1", token, {
      body: "hello",
      contentLength: "5",
    }), env);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("Invalid upload completion mode");
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
    expect(completionFetch).not.toHaveBeenCalled();
  });
```

Update `testEnv`:

```ts
function testEnv(options: {
  maxUploadBytes?: string;
  uploadCompletionMode?: string;
} = {}): WorkerEnv {
  return {
    MEDIA_BUCKET: new FakeBucket(),
    MEDIA_TOKEN_SECRET: "token-secret",
    MEDIA_WORKER_SHARED_SECRET: "worker-secret",
    WOVEN_API_BASE_URL: "https://app.example.test/",
    MEDIA_MAX_UPLOAD_BYTES: options.maxUploadBytes ?? "1000",
    UPLOAD_COMPLETION_MODE: options.uploadCompletionMode,
  };
}
```

- [ ] **Step 2: Run Worker tests and verify failure**

Run:

```bash
pnpm test tests/media/media-worker.test.ts
```

Expected: FAIL because the Worker always performs callback completion for input uploads and does not validate `UPLOAD_COMPLETION_MODE`.

- [ ] **Step 3: Implement Worker mode split**

In `workers/media/index.ts`, update `Env`:

```ts
type Env = {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_TOKEN_SECRET: string;
  MEDIA_WORKER_SHARED_SECRET: string;
  WOVEN_API_BASE_URL: string;
  MEDIA_MAX_UPLOAD_BYTES: string;
  UPLOAD_COMPLETION_MODE?: string;
};
```

Add this helper near the other small parsing helpers:

```ts
type UploadCompletionMode = "callback" | "manual";

function parseUploadCompletionMode(raw: string | undefined): UploadCompletionMode | null {
  const value = raw?.trim() || "callback";
  if (value === "callback" || value === "manual") {
    return value;
  }
  return null;
}
```

In `handleUpload`, after validating `request.body` and before `env.MEDIA_BUCKET.put(...)`, add:

```ts
  const uploadCompletionMode = parseUploadCompletionMode(env.UPLOAD_COMPLETION_MODE);
  if (!uploadCompletionMode) {
    return textResponse("Invalid upload completion mode", 500);
  }
```

Replace the existing callback skip block:

```ts
  if (payload.jobId) {
    return jsonResponse({ ok: true });
  }
```

with:

```ts
  if (payload.jobId || uploadCompletionMode === "manual") {
    return jsonResponse({ ok: true });
  }
```

- [ ] **Step 4: Run Worker tests and verify pass**

Run:

```bash
pnpm test tests/media/media-worker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add dev Worker config and scripts**

In `workers/media/wrangler.jsonc`, add `UPLOAD_COMPLETION_MODE` to production vars:

```jsonc
  "vars": {
    "WOVEN_API_BASE_URL": "https://www.woven.video",
    "MEDIA_MAX_UPLOAD_BYTES": "104857600",
    "UPLOAD_COMPLETION_MODE": "callback"
  },
```

Then add this top-level `env` block after `vars`:

```jsonc
  "env": {
    "dev": {
      "name": "woven-media-dev",
      "routes": [
        {
          "pattern": "media-dev.woven.video/uploads/*",
          "zone_name": "woven.video"
        },
        {
          "pattern": "media-dev.woven.video/objects/*",
          "zone_name": "woven.video"
        },
        {
          "pattern": "media-dev.woven.video/internal/*",
          "zone_name": "woven.video"
        }
      ],
      "r2_buckets": [
        {
          "binding": "MEDIA_BUCKET",
          "bucket_name": "woven-media-dev",
          "remote": true
        }
      ],
      "vars": {
        "WOVEN_API_BASE_URL": "https://www.woven.video",
        "MEDIA_MAX_UPLOAD_BYTES": "104857600",
        "UPLOAD_COMPLETION_MODE": "manual"
      }
    }
  }
```

Create `workers/media/r2-dev-lifecycle.json`:

```json
{
  "Rules": [
    {
      "ID": "delete-local-smoke-media-after-7-days",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "users/"
      },
      "Expiration": {
        "Days": 7
      }
    },
    {
      "ID": "abort-incomplete-dev-media-uploads-after-1-day",
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 1
      }
    }
  ]
}
```

In `package.json`, add scripts next to the existing media scripts:

```json
    "media:edge:deploy:dev": "npx wrangler deploy --config workers/media/wrangler.jsonc --env dev",
    "media:dev:smoke": "sh -c 'cleanup(){ trap - INT TERM EXIT; kill $(jobs -p) 2>/dev/null; }; trap cleanup INT TERM EXIT; pnpm run dev & pnpm run trigger:dev & wait'",
```

- [ ] **Step 6: Validate JSON and run focused tests**

Run:

```bash
node --check scripts/trigger-dev.mjs
pnpm test tests/media/media-worker.test.ts
```

Expected: `node --check` prints no syntax errors; Worker tests PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add workers/media/index.ts tests/media/media-worker.test.ts workers/media/wrangler.jsonc workers/media/r2-dev-lifecycle.json package.json
git commit -m "feat(media): support manual upload completion at edge"
```

---

### Task 3: Authenticated Local Upload Completion Contract

**Files:**
- Modify: `lib/media/assets.ts`
- Modify: `app/api/v1/media/uploads/route.ts`
- Create: `app/api/v1/media/uploads/[assetId]/complete/route.ts`
- Modify: `tests/media/assets.test.ts`

**Interfaces:**
- Consumes: `MediaEnv.uploadCompletionMode`
- Produces: `completeInputAssetUploadForUser({ userId, assetId }): Promise<void>`
- Produces: upload response field when manual mode is active:
  `{ completion: { method: "POST"; url: "/api/v1/media/uploads/<assetId>/complete" } }`
- Produces: `POST /api/v1/media/uploads/[assetId]/complete`

- [ ] **Step 1: Write failing asset helper test**

Update the import in `tests/media/assets.test.ts`:

```ts
import {
  completeInputAssetUploadForUser,
  createInputAssetUpload,
  isSupportedInputContentType,
  markInputAssetUploaded,
  type MediaAssetRow,
} from "@/lib/media/assets";
```

Update `mediaEnv` to include completion mode:

```ts
  uploadCompletionMode: "callback",
```

Add `selectMaybeQuery` helper near the existing query helpers:

```ts
function selectMaybeQuery<T>(result: SupabaseResult<T>): QueryStep {
  const step: QueryStep = { root: {}, filters: [] };
  const maybeSingle = vi.fn(async () => result);
  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      step.filters.push([column, value]);
      return chain;
    }),
    maybeSingle,
  };

  step.root.select = vi.fn((columns: string) => {
    step.selected = columns;
    return chain;
  });

  return step;
}
```

Add `select?: ReturnType<typeof vi.fn>;` to `QueryRoot`:

```ts
type QueryRoot = {
  insert?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  select?: ReturnType<typeof vi.fn>;
};
```

Add this test inside `describe("media assets", ...)`:

```ts
  it("manual-completes only the authenticated user's pending input asset using stored metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));

    const selectStep = selectMaybeQuery({
      data: {
        id: "asset_1",
        user_id: "user_1",
        job_id: null,
        kind: "input",
        status: "pending",
        content_type: "image/png",
        size_bytes: 123,
        original_filename: "input.png",
        storage_key: "users/user_1/media/tmp/asset_1/input.png",
        upload_expires_at: "2026-07-05T12:15:00.000Z",
        metadata: {},
      },
      error: null,
    });
    const updateStep = updateQuery({ data: { id: "asset_1" }, error: null });
    mockAdminWith(selectStep, updateStep);

    await expect(completeInputAssetUploadForUser({
      userId: "user_1",
      assetId: "asset_1",
    })).resolves.toBeUndefined();

    expect(selectStep.selected).toBe(
      "id, user_id, job_id, kind, status, content_type, size_bytes, original_filename, storage_key, upload_expires_at, metadata",
    );
    expect(selectStep.filters).toEqual([
      ["id", "asset_1"],
      ["user_id", "user_1"],
      ["kind", "input"],
      ["status", "pending"],
    ]);
    expect(updateStep.updated).toEqual({
      status: "uploaded",
      size_bytes: 123,
      metadata: { uploaded_at: "2026-07-05T12:00:00.000Z" },
    });
    expect(updateStep.filters).toEqual([
      ["id", "asset_1"],
      ["storage_key", "users/user_1/media/tmp/asset_1/input.png"],
      ["status", "pending"],
    ]);
  });
```

Add this test after it:

```ts
  it("rejects manual completion when no matching pending user asset exists", async () => {
    const selectStep = selectMaybeQuery({
      data: null,
      error: null,
    });
    mockAdminWith(selectStep);

    await expect(completeInputAssetUploadForUser({
      userId: "user_1",
      assetId: "asset_2",
    })).rejects.toThrow("media_asset_not_found");
  });
```

- [ ] **Step 2: Run asset tests and verify failure**

Run:

```bash
pnpm test tests/media/assets.test.ts
```

Expected: FAIL because `completeInputAssetUploadForUser` is not implemented.

- [ ] **Step 3: Implement manual completion helper**

In `lib/media/assets.ts`, add this exported helper after `markInputAssetUploaded`:

```ts
export async function completeInputAssetUploadForUser({
  userId,
  assetId,
}: {
  userId: string;
  assetId: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("media_assets")
    .select(MEDIA_ASSET_SELECT)
    .eq("id", assetId)
    .eq("user_id", userId)
    .eq("kind", "input")
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("media_asset_not_found");
  }

  const asset = data as MediaAssetRow;
  const sizeBytes = Number(asset.size_bytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error("media_asset_invalid_size");
  }

  await markInputAssetUploadedWithAdmin(admin, {
    assetId: asset.id,
    storageKey: asset.storage_key,
    sizeBytes,
  });
}
```

Refactor `markInputAssetUploaded` to call a shared internal helper:

```ts
export async function markInputAssetUploaded({
  assetId,
  storageKey,
  sizeBytes,
}: {
  assetId: string;
  storageKey: string;
  sizeBytes: number;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  await markInputAssetUploadedWithAdmin(admin, { assetId, storageKey, sizeBytes });
}

async function markInputAssetUploadedWithAdmin(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  {
    assetId,
    storageKey,
    sizeBytes,
  }: {
    assetId: string;
    storageKey: string;
    sizeBytes: number;
  },
): Promise<void> {
  const { data, error } = await admin
    .from("media_assets")
    .update({
      status: "uploaded",
      size_bytes: sizeBytes,
      metadata: { uploaded_at: new Date().toISOString() },
    })
    .eq("id", assetId)
    .eq("storage_key", storageKey)
    .eq("status", "pending")
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "media_asset_upload_complete_failed");
  }
}
```

- [ ] **Step 4: Write failing upload response and route tests**

In `tests/media/assets.test.ts`, update route mocks in `afterEach`:

```ts
    vi.doUnmock("@/lib/media/env");
```

Add this test inside `describe("media upload routes", ...)`:

```ts
  it("returns local completion instructions when manual upload completion mode is active", async () => {
    const createInputAssetUpload = vi.fn(async () => ({
      asset: { id: "asset_1" },
      uploadUrl: "https://media-dev.woven.video/uploads/asset_1?token=token",
      expiresAt: "2026-07-05T12:15:00.000Z",
    }));

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/media/assets", () => ({
      createInputAssetUpload,
    }));
    vi.doMock("@/lib/media/env", () => ({
      getMediaEnv: vi.fn(() => ({
        ...mediaEnv,
        uploadCompletionMode: "manual",
      })),
    }));

    const { POST } = await import("@/app/api/v1/media/uploads/route");
    const response = await POST(jsonRequest("/api/v1/media/uploads", {
      purpose: "media_input",
      filename: "input.png",
      content_type: "image/png",
      size_bytes: 12,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      upload_id: "asset_1",
      asset_id: "asset_1",
      method: "PUT",
      upload_url: "https://media-dev.woven.video/uploads/asset_1?token=token",
      completion: {
        method: "POST",
        url: "/api/v1/media/uploads/asset_1/complete",
      },
    });
  });
```

Add this test after it:

```ts
  it("omits local completion instructions in callback mode", async () => {
    const createInputAssetUpload = vi.fn(async () => ({
      asset: { id: "asset_1" },
      uploadUrl: "https://media.woven.video/uploads/asset_1?token=token",
      expiresAt: "2026-07-05T12:15:00.000Z",
    }));

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/media/assets", () => ({
      createInputAssetUpload,
    }));
    vi.doMock("@/lib/media/env", () => ({
      getMediaEnv: vi.fn(() => ({
        ...mediaEnv,
        uploadCompletionMode: "callback",
      })),
    }));

    const { POST } = await import("@/app/api/v1/media/uploads/route");
    const response = await POST(jsonRequest("/api/v1/media/uploads", {
      purpose: "media_input",
      filename: "input.png",
      content_type: "image/png",
      size_bytes: 12,
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.completion).toBeUndefined();
  });
```

Add this test for the new route:

```ts
  it("manual-completes an upload through the authenticated local completion route", async () => {
    const completeInputAssetUploadForUser = vi.fn(async () => undefined);

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/media/env", () => ({
      getMediaEnv: vi.fn(() => ({
        ...mediaEnv,
        uploadCompletionMode: "manual",
      })),
    }));
    vi.doMock("@/lib/media/assets", () => ({
      completeInputAssetUploadForUser,
    }));

    const { POST, dynamic, runtime } = await import(
      "@/app/api/v1/media/uploads/[assetId]/complete/route"
    );
    const response = await POST(
      jsonRequest("/api/v1/media/uploads/asset_1/complete", {}),
      { params: Promise.resolve({ assetId: "asset_1" }) } as RouteContext<
        "/api/v1/media/uploads/[assetId]/complete"
      >,
    );

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      asset_id: "asset_1",
    });
    expect(completeInputAssetUploadForUser).toHaveBeenCalledWith({
      userId: "user_1",
      assetId: "asset_1",
    });
  });
```

Add this test after it:

```ts
  it("disables the local completion route outside manual mode", async () => {
    const completeInputAssetUploadForUser = vi.fn(async () => undefined);

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/media/env", () => ({
      getMediaEnv: vi.fn(() => ({
        ...mediaEnv,
        uploadCompletionMode: "callback",
      })),
    }));
    vi.doMock("@/lib/media/assets", () => ({
      completeInputAssetUploadForUser,
    }));

    const { POST } = await import("@/app/api/v1/media/uploads/[assetId]/complete/route");
    const response = await POST(
      jsonRequest("/api/v1/media/uploads/asset_1/complete", {}),
      { params: Promise.resolve({ assetId: "asset_1" }) } as RouteContext<
        "/api/v1/media/uploads/[assetId]/complete"
      >,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(completeInputAssetUploadForUser).not.toHaveBeenCalled();
  });
```

- [ ] **Step 5: Run asset route tests and verify failure**

Run:

```bash
pnpm test tests/media/assets.test.ts
```

Expected: FAIL because upload responses do not include `completion` and the local completion route does not exist.

- [ ] **Step 6: Implement upload response contract**

In `app/api/v1/media/uploads/route.ts`, add:

```ts
import { getMediaEnv } from "@/lib/media/env";
```

Inside the success path, before `return Response.json(...)`, add:

```ts
    const completion = getMediaEnv().uploadCompletionMode === "manual"
      ? {
          method: "POST",
          url: `/api/v1/media/uploads/${upload.asset.id}/complete`,
        }
      : undefined;
```

Replace the JSON body with:

```ts
        upload_id: upload.asset.id,
        asset_id: upload.asset.id,
        method: "PUT",
        upload_url: upload.uploadUrl,
        expires_at: upload.expiresAt,
        ...(completion ? { completion } : {}),
```

- [ ] **Step 7: Implement local completion route**

Create `app/api/v1/media/uploads/[assetId]/complete/route.ts`:

```ts
import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { completeInputAssetUploadForUser } from "@/lib/media/assets";
import { getMediaEnv } from "@/lib/media/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/media/uploads/[assetId]/complete">,
) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  if (getMediaEnv().uploadCompletionMode !== "manual") {
    return apiError("Not found.", 404, "not_found");
  }

  const { assetId } = await context.params;
  if (!assetId) {
    return apiError("asset_id is required.", 400, "invalid_media_input");
  }

  try {
    await completeInputAssetUploadForUser({
      userId: authResult.auth.user.id,
      assetId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "media_upload_complete_failed";
    if (message === "media_asset_not_found") {
      return apiError("Upload asset was not found.", 404, "media_asset_not_found");
    }
    console.error("Failed to manually complete media upload", error);
    return apiError(
      "Unable to mark media upload complete.",
      500,
      "media_upload_complete_failed",
    );
  }

  return Response.json(
    { ok: true, asset_id: assetId },
    { headers: { "cache-control": "no-store" } },
  );
}
```

- [ ] **Step 8: Run asset tests and verify pass**

Run:

```bash
pnpm test tests/media/assets.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add lib/media/assets.ts app/api/v1/media/uploads/route.ts app/api/v1/media/uploads/[assetId]/complete/route.ts tests/media/assets.test.ts
git commit -m "feat(media): add local upload completion endpoint"
```

---

### Task 4: Provider-Fetchable Media URL Guard

**Files:**
- Create: `lib/media/provider-input-urls.ts`
- Modify: `app/api/v1/media/jobs/route.ts`
- Modify: `tests/media/job-routes.test.ts`

**Interfaces:**
- Consumes: `isLoopbackMediaBaseUrl(baseUrl: string): boolean`
- Produces: `validateProviderFetchableMediaBaseUrl({ inputAssetIds, baseUrl }): { ok: true } | { ok: false; error: "media_storage_misconfigured" }`

- [ ] **Step 1: Write failing job route tests**

At the top of `tests/media/job-routes.test.ts`, add:

```ts
const originalEnv = process.env;
```

Inside the existing `afterEach`, add:

```ts
    process.env = originalEnv;
```

Add this test before `"returns the queued job response without caching"`:

```ts
  it("rejects uploaded-input provider jobs when MEDIA_BASE_URL points at localhost", async () => {
    process.env = {
      ...originalEnv,
      MEDIA_BASE_URL: "http://127.0.0.1:8787",
    } as NodeJS.ProcessEnv;
    const createReservedMediaJob = vi.fn();
    const dispatchMediaJob = vi.fn();

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal-ai/gemini-omni-flash/image-to-video",
        kind: "video",
        parameterSchema: { type: "object" },
        inputAssetSchema: { roles: [] },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({
        ok: true,
        value: { prompt: "animate this" },
      })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
      failReservedMediaJobDispatch: vi.fn(),
    }));
    mockTriggerDispatch(dispatchMediaJob);

    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal-ai/gemini-omni-flash/image-to-video",
      parameters: { prompt: "animate this" },
      input_asset_ids: ["asset_1"],
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "media_storage_misconfigured",
        message: "Uploaded-input media jobs require MEDIA_BASE_URL to be publicly reachable.",
      },
    });
    expect(createReservedMediaJob).not.toHaveBeenCalled();
    expect(dispatchMediaJob).not.toHaveBeenCalled();
  });
```

Add this test after it:

```ts
  it("allows text-only provider jobs when MEDIA_BASE_URL points at localhost", async () => {
    process.env = {
      ...originalEnv,
      MEDIA_BASE_URL: "http://127.0.0.1:8787",
    } as NodeJS.ProcessEnv;
    const createReservedMediaJob = vi.fn(async () => ({
      id: "job_1",
      status: "queued",
      model: "fal-ai/nano-banana-lite",
      estimatedCostUsdMicros: 100_000,
      reservedCreditsUsdMicros: 100_000,
      createdAt: "2026-07-05T12:00:00.000Z",
      expiresAt: "2026-07-05T13:00:00.000Z",
    }));
    const dispatchMediaJob = vi.fn(async () => ({ runId: "run_123" }));

    vi.doMock("@/lib/api/auth", () => ({
      requireApiAuth: vi.fn(async () => ({
        ok: true,
        auth: { user: { id: "user_1" } },
      })),
    }));
    vi.doMock("@/lib/api/license", () => ({
      licenseGateResponse: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/media/model-registry", () => ({
      getMediaModel: vi.fn(async () => ({
        id: "fal-ai/nano-banana-lite",
        kind: "image",
        parameterSchema: { type: "object" },
        inputAssetSchema: { roles: [] },
      })),
    }));
    vi.doMock("@/lib/media/schema", () => ({
      validateMediaParameters: vi.fn(() => ({
        ok: true,
        value: { prompt: "a banana" },
      })),
    }));
    vi.doMock("@/lib/media/jobs", () => ({
      createReservedMediaJob,
      failReservedMediaJobDispatch: vi.fn(),
    }));
    mockTriggerDispatch(dispatchMediaJob);

    const { POST } = await import("@/app/api/v1/media/jobs/route");
    const response = await POST(jsonRequest("/api/v1/media/jobs", {
      model: "fal-ai/nano-banana-lite",
      parameters: { prompt: "a banana" },
    }));

    expect(response.status).toBe(200);
    expect(createReservedMediaJob).toHaveBeenCalledWith(expect.objectContaining({
      inputAssetIds: [],
    }));
    expect(dispatchMediaJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job_1",
    }));
  });
```

- [ ] **Step 2: Run job route tests and verify failure**

Run:

```bash
pnpm test tests/media/job-routes.test.ts
```

Expected: FAIL because uploaded-input jobs are not guarded against localhost `MEDIA_BASE_URL`.

- [ ] **Step 3: Implement provider input URL guard**

Create `lib/media/provider-input-urls.ts`:

```ts
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
```

In `app/api/v1/media/jobs/route.ts`, add:

```ts
import { validateProviderFetchableMediaBaseUrl } from "@/lib/media/provider-input-urls";
```

After `parseMediaJobInputAssets` succeeds and before `createReservedMediaJob`, add:

```ts
  const providerInputUrlCheck = validateProviderFetchableMediaBaseUrl({
    inputAssetIds: inputAssets.inputAssetIds,
  });
  if (!providerInputUrlCheck.ok) {
    return apiError(
      "Uploaded-input media jobs require MEDIA_BASE_URL to be publicly reachable.",
      500,
      providerInputUrlCheck.error,
    );
  }
```

- [ ] **Step 4: Run job route tests and verify pass**

Run:

```bash
pnpm test tests/media/job-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add lib/media/provider-input-urls.ts app/api/v1/media/jobs/route.ts tests/media/job-routes.test.ts
git commit -m "fix(media): reject localhost uploaded provider inputs"
```

---

### Task 5: Local Smoke Runbook And Provisioning

**Files:**
- Modify: `.env.example`
- Modify: `docs/media-worker-deploy.md`

**Interfaces:**
- Consumes: `pnpm run media:edge:deploy:dev`
- Consumes: `pnpm run media:dev:smoke`
- Consumes: `workers/media/r2-dev-lifecycle.json`
- Produces: documented local provider-smoke profile and Cloudflare provisioning commands

- [ ] **Step 1: Update `.env.example`**

Add `MEDIA_UPLOAD_COMPLETION_MODE=callback` after `MEDIA_BASE_URL`:

```dotenv
MEDIA_BASE_URL=https://media.woven.video
MEDIA_UPLOAD_COMPLETION_MODE=callback
MEDIA_TOKEN_SECRET=replace_with_32_plus_random_bytes
```

Add this local smoke comment block after the Trigger env vars:

```dotenv
# Local provider smoke profile:
# - keep local Supabase and Trigger.dev dev
# - do not start media:edge:local
# - set these in .env.local only when testing uploaded-input provider jobs locally
# MEDIA_BASE_URL=https://media-dev.woven.video
# MEDIA_UPLOAD_COMPLETION_MODE=manual
```

- [ ] **Step 2: Update deploy runbook required infrastructure**

In `docs/media-worker-deploy.md`, replace the Required Infrastructure list with:

```md
## Required Infrastructure

Production:

- Cloudflare R2 bucket: `woven-media`
- Cloudflare Worker routes:
  - `https://media.woven.video/uploads/*`
  - `https://media.woven.video/objects/*`
  - `https://media.woven.video/internal/*`
- Vercel app route: `https://www.woven.video`

Local provider smoke:

- Cloudflare R2 bucket: `woven-media-dev`
- Cloudflare Worker routes:
  - `https://media-dev.woven.video/uploads/*`
  - `https://media-dev.woven.video/objects/*`
  - `https://media-dev.woven.video/internal/*`
- Local app route: `http://127.0.0.1:3000`
- Local Supabase: `http://127.0.0.1:54321`

Both environments require Supabase migrations through `20260703190000_trigger_media_executor.sql`.
```

Keep the existing warning that the Worker should own only `/uploads/*`, `/objects/*`, and `/internal/*`.

- [ ] **Step 3: Update Worker secrets section**

Replace the Worker Secrets section with:

````md
## Worker Secrets

Set production Worker secrets before deploying production:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc
```

Set dev Worker secrets before deploying the `dev` environment:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc --env dev
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc --env dev
```

For local provider smoke, `.env.local` must use the same `MEDIA_TOKEN_SECRET` value as the dev Worker.
Harness must never receive `MEDIA_WORKER_SHARED_SECRET`.
````

- [ ] **Step 4: Add dev provisioning section**

Add this section before Deployment Order:

````md
## Dev R2 And Worker Provisioning

Verify Wrangler is logged into the Cloudflare account that owns `woven.video`:

```bash
npx wrangler whoami
npx wrangler r2 bucket list
```

Create the dev bucket if it is missing:

```bash
npx wrangler r2 bucket create woven-media-dev
```

Apply lifecycle cleanup for local smoke objects:

```bash
npx wrangler r2 bucket lifecycle set woven-media-dev --file workers/media/r2-dev-lifecycle.json
```

Set dev Worker secrets:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc --env dev
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc --env dev
```

Deploy the dev Worker:

```bash
pnpm run media:edge:deploy:dev
```

Do not point local provider smoke at `https://media.woven.video`; that would write local test objects
to production storage and the production Worker would try to complete uploads against the production
app.
````

- [ ] **Step 5: Replace local development section**

Replace the Local Development section with:

````md
## Local Development

For Worker route development, run:

```bash
pnpm run media:dev:local
```

That starts:

- `pnpm run dev` for the Next.js API routes
- `pnpm run media:edge:local` for the Cloudflare media Worker on `127.0.0.1:8787`
- `pnpm run trigger:dev` for Trigger.dev local task execution

This localhost Worker path is not valid for real Fal provider smoke tests that include uploaded
inputs, because Fal cannot fetch `127.0.0.1` URLs.

For real local provider smoke with uploaded inputs, set `.env.local` to:

```dotenv
MEDIA_BASE_URL=https://media-dev.woven.video
MEDIA_UPLOAD_COMPLETION_MODE=manual
```

Then run:

```bash
pnpm run media:dev:smoke
```

That starts local Next and Trigger.dev dev only. It does not start `media:edge:local`; media bytes go
through the deployed dev Worker and `woven-media-dev`.

Trigger.dev is the supported executor in local and production. Do not run a separate polling worker.
````

- [ ] **Step 6: Update smoke test section**

Replace the first two smoke-test bullets with:

```md
1. Create a temp upload asset through `POST /api/v1/media/uploads`.
2. Confirm local provider-smoke upload responses include:
   - `upload_url` on `https://media-dev.woven.video/uploads/...`
   - `completion.method = "POST"`
   - `completion.url = "/api/v1/media/uploads/<assetId>/complete"`
3. PUT a small object to the returned `upload_url`.
4. POST to the returned `completion.url` with the same bearer token.
```

Keep the remaining job creation/status/output-download bullets and renumber them.

- [ ] **Step 7: Run docs and focused test checks**

Run:

```bash
pnpm test tests/media/env.test.ts tests/media/media-worker.test.ts tests/media/assets.test.ts tests/media/job-routes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add .env.example docs/media-worker-deploy.md
git commit -m "docs(media): document local real r2 smoke setup"
```

---

### Task 6: Provision Dev Cloudflare Resources And Verify

**Files:**
- No source changes expected

**Interfaces:**
- Consumes: Cloudflare account with access to the `woven.video` zone
- Consumes: `workers/media/wrangler.jsonc`
- Consumes: `workers/media/r2-dev-lifecycle.json`
- Produces: deployed dev Worker at `https://media-dev.woven.video`
- Produces: dev R2 bucket `woven-media-dev`

- [ ] **Step 1: Verify account and bucket state**

Run:

```bash
npx wrangler whoami
npx wrangler r2 bucket list
```

Expected: Wrangler is authenticated to the account that owns `woven.video`. If it is not, stop and ask the user to switch accounts or provide the right Cloudflare token.

- [ ] **Step 2: Create dev bucket if missing**

Run only if `woven-media-dev` is not in the bucket list:

```bash
npx wrangler r2 bucket create woven-media-dev
```

Expected: command succeeds or reports the bucket already exists.

- [ ] **Step 3: Apply dev lifecycle policy**

Run:

```bash
npx wrangler r2 bucket lifecycle set woven-media-dev --file workers/media/r2-dev-lifecycle.json
```

Expected: lifecycle policy is accepted.

- [ ] **Step 4: Set dev Worker secrets**

Run:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET --config workers/media/wrangler.jsonc --env dev
npx wrangler secret put MEDIA_WORKER_SHARED_SECRET --config workers/media/wrangler.jsonc --env dev
```

Expected: both secrets are stored for the `dev` environment. Use the same `MEDIA_TOKEN_SECRET` value that local `.env.local` uses for provider smoke. Do not paste secrets into source files or chat.

- [ ] **Step 5: Deploy dev Worker**

Run:

```bash
pnpm run media:edge:deploy:dev
```

Expected: Wrangler deploys the `woven-media-dev` Worker environment with routes for `media-dev.woven.video/uploads/*`, `/objects/*`, and `/internal/*`.

- [ ] **Step 6: Verify app-side local smoke config**

Check `.env.local` manually or with a non-printing grep that does not reveal secrets:

```bash
rg -n '^MEDIA_BASE_URL=|^MEDIA_UPLOAD_COMPLETION_MODE=' .env.local
```

Expected:

```text
MEDIA_BASE_URL=https://media-dev.woven.video
MEDIA_UPLOAD_COMPLETION_MODE=manual
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm test tests/media/env.test.ts tests/media/media-worker.test.ts tests/media/assets.test.ts tests/media/job-routes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS, allowing any pre-existing skipped tests.

- [ ] **Step 9: Run build**

Run:

```bash
pnpm run build
```

Expected: PASS. If this fails only because the sandbox cannot bind a Turbopack port, rerun outside the sandbox and record that the outside-sandbox build passed.

- [ ] **Step 10: Commit any verification doc updates**

If Task 6 reveals a runbook correction, commit only that doc correction:

```bash
git add docs/media-worker-deploy.md
git commit -m "docs(media): clarify dev worker provisioning"
```

If no files changed, do not create a commit for this task.

---

## Final Verification

Run after all tasks:

```bash
pnpm test tests/media/env.test.ts tests/media/media-worker.test.ts tests/media/assets.test.ts tests/media/job-routes.test.ts
pnpm test
pnpm run build
```

Then run one manual local provider-smoke check from Harness:

1. Start local Supabase.
2. Set `.env.local` to `MEDIA_BASE_URL=https://media-dev.woven.video` and `MEDIA_UPLOAD_COMPLETION_MODE=manual`.
3. Start local Woven Video with `pnpm run media:dev:smoke`.
4. Start local Harness.
5. Upload an image input through Harness.
6. Confirm `/api/v1/media/uploads` returns `upload_url` on `https://media-dev.woven.video` and a `completion` object.
7. Confirm Harness PUTs to the dev Worker, calls completion, creates the media job, and the job reaches Fal.
8. Confirm Fal no longer returns `file_download_error` for `127.0.0.1`.
9. Confirm output status reaches terminal success or a real provider error unrelated to localhost fetchability.

## Handoff Notes

- `pnpm-workspace.yaml` may already be untracked from earlier pnpm build-script approval work. Do not stage it unless the user explicitly asks.
- Any Cloudflare command may need approval or the user's account permissions. Stop if Wrangler is logged into the wrong account instead of falling back to production storage.
- Keep production `MEDIA_UPLOAD_COMPLETION_MODE=callback`.
- Keep local provider smoke `MEDIA_UPLOAD_COMPLETION_MODE=manual`.
- Harness changes are downstream: it should read the optional `completion` object from upload responses and call it after a successful PUT.
