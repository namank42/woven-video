# Hosted Media Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Woven-credit hosted media jobs for curated Fal image/video models, ElevenLabs audio models, and R2-backed auto captions so `woven-harness` can create jobs, poll status, and download outputs through Woven media URLs.

**Architecture:** Next.js API routes stay as the authenticated control plane for model catalog, upload slots, job creation, status reads, internal callbacks, and provider webhooks. Supabase stores metadata, job state, billing reservations, and usage events; Cloudflare R2 stores all media bytes behind `media.woven.video`; a separate worker process claims jobs and calls Fal or ElevenLabs with server-owned keys.

**Tech Stack:** Next.js 16.2.3 App Router route handlers, Supabase Postgres/RLS/RPCs, Cloudflare R2 Workers API, Fal `@fal-ai/client`, ElevenLabs `@elevenlabs/elevenlabs-js`, Vitest, TypeScript.

**Docs digest:** `docs/superpowers/research/2026-07-01-hosted-generations-docs.md`

**Spec:** `docs/superpowers/specs/2026-07-01-hosted-media-jobs-design.md`

---

## Implementation Assumptions

- The first production curated model list is supplied by editing `model_pricing_rules` rows. This plan builds the registry/parser and route behavior; it does not pick frontier model IDs on the user's behalf.
- Public media URLs use `MEDIA_BASE_URL`, defaulting to `https://media.woven.video`.
- V1 upload size is capped with `MEDIA_MAX_UPLOAD_BYTES`; set it to the active Cloudflare Worker request body limit.
- Fal server-side auth uses `FAL_KEY`, which the Fal docs say the Node client reads automatically.
- ElevenLabs uses the existing `ELEVENLABS_API_KEY`.
- The media worker is run as a separate process with `pnpm media:worker`. It calls shared library code and does not run inside a Next request.

## File Map

| Path | Responsibility |
|---|---|
| `package.json` | Add provider/test/worker dependencies and scripts |
| `vitest.config.ts` | Configure Vitest for TS tests and `@/*` alias |
| `.env.example` | Document Fal, media URL, token, worker, and upload limit env vars |
| `supabase/migrations/20260701120000_hosted_media_jobs.sql` | Add `media_assets`, extend job statuses, add worker claim RPC, seed caption pricing update |
| `lib/media/types.ts` | Shared media job, asset, model, provider, and response types |
| `lib/media/env.ts` | Read media env vars with stable defaults and explicit errors |
| `lib/media/tokens.ts` | HMAC-sign and verify short-lived media upload/download tokens |
| `lib/media/storage-keys.ts` | Build safe asset/output R2 keys |
| `lib/media/model-registry.ts` | Read curated enabled media model rows from `model_pricing_rules` metadata |
| `lib/media/schema.ts` | Minimal JSON parameter validation for registry schemas |
| `lib/media/pricing.ts` | Reservation/final charge helpers using USD micros and existing markup logic |
| `lib/media/assets.ts` | Service-role media asset create/read/update helpers |
| `lib/media/jobs.ts` | Job create/status formatting and reservation helpers |
| `lib/media/provider.ts` | Provider adapter interface and output normalization |
| `lib/media/providers/fal.ts` | Fal queue submit/status/result adapter |
| `lib/media/providers/elevenlabs.ts` | ElevenLabs TTS, sound effects, and music operation adapter |
| `lib/media/worker.ts` | Claim jobs, run provider adapters, copy outputs to R2/media assets, settle/release billing |
| `scripts/media-worker.ts` | Long-running worker loop entrypoint |
| `workers/media/index.ts` | Cloudflare Worker for `media.woven.video` upload/download URLs |
| `app/api/v1/media/models/route.ts` | Public media model catalog |
| `app/api/v1/media/uploads/route.ts` | Public upload slot creation |
| `app/api/v1/media/jobs/route.ts` | Public media job creation |
| `app/api/v1/media/jobs/[jobId]/route.ts` | Public media job status |
| `app/api/v1/media/jobs/[jobId]/cancel/route.ts` | Public queued-job cancellation |
| `app/api/v1/media/webhooks/fal/route.ts` | Fal webhook receiver |
| `app/api/internal/media/uploads/complete/route.ts` | Worker-authenticated upload completion callback |
| `app/api/internal/media/jobs/drain/route.ts` | Worker-authenticated single drain endpoint for cron/manual operations |
| `lib/reel-captions/pricing.ts` | Update defaults to `$0.10/min` and `$0.10` minimum |
| `app/api/v1/reel-captions/jobs/route.ts` | Move caption input upload slot to R2 media assets |
| `app/api/v1/reel-captions/jobs/[jobId]/process/route.ts` | Read caption input through Woven media URL and settle with updated pricing |
| `tests/media/*.test.ts` | Unit tests for pure media modules and worker behavior with fakes |
| `tests/reel-captions/pricing.test.ts` | Caption pricing regression tests |

## Task 1: Dependencies And Test Harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/media/smoke.test.ts`

- [ ] **Step 1: Install dependencies**

Run:

```bash
pnpm add @fal-ai/client @elevenlabs/elevenlabs-js
pnpm add -D vitest tsx
```

Expected: `package.json` and `pnpm-lock.yaml` update.

- [ ] **Step 2: Add scripts**

Modify `package.json` scripts to include:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "media:worker": "tsx scripts/media-worker.ts"
  }
}
```

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
```

- [ ] **Step 4: Add smoke test**

Create `tests/media/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("vitest setup", () => {
  it("runs TypeScript tests", () => {
    expect({ ok: true }).toEqual({ ok: true });
  });
});
```

- [ ] **Step 5: Verify tests**

Run:

```bash
pnpm test
```

Expected: one passing test.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json pnpm-lock.yaml vitest.config.ts tests/media/smoke.test.ts
git commit -m "test: add media job test harness"
```

## Task 2: Database Migration For Media Assets And Worker Claims

**Files:**
- Create: `supabase/migrations/20260701120000_hosted_media_jobs.sql`

- [ ] **Step 1: Create migration**

Create `supabase/migrations/20260701120000_hosted_media_jobs.sql`:

```sql
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete set null,
  kind text not null check (kind in ('input', 'output')),
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'attached', 'ready', 'deleted', 'failed')),
  content_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  original_filename text,
  storage_key text not null unique,
  upload_expires_at timestamptz,
  download_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index media_assets_user_created_idx
  on public.media_assets(user_id, created_at desc);
create index media_assets_job_idx
  on public.media_assets(job_id);
create index media_assets_status_expires_idx
  on public.media_assets(status, upload_expires_at);

create trigger set_media_assets_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

alter table public.generation_jobs
  drop constraint if exists generation_jobs_status_check;

alter table public.generation_jobs
  add constraint generation_jobs_status_check
  check (status in (
    'queued',
    'running',
    'waiting_provider',
    'downloading_outputs',
    'succeeded',
    'failed',
    'cancelled'
  ));

alter table public.generation_jobs
  add column if not exists progress jsonb not null default '{}'::jsonb,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists last_provider_poll_at timestamptz;

create index if not exists generation_jobs_media_claim_idx
  on public.generation_jobs(status, claim_expires_at, created_at)
  where type = 'media_job';

create or replace function public.claim_media_jobs(
  p_limit integer default 1,
  p_lease_seconds integer default 300
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_limit < 1 or p_limit > 25 then
    raise exception 'claim_media_jobs_limit_out_of_range';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'claim_media_jobs_lease_seconds_out_of_range';
  end if;

  return query
  with candidates as (
    select id
    from public.generation_jobs
    where type = 'media_job'
      and status in ('queued', 'running', 'waiting_provider')
      and (
        status = 'queued'
        or claim_expires_at is null
        or claim_expires_at < now()
      )
    order by created_at asc
    for update skip locked
    limit p_limit
  )
  update public.generation_jobs jobs
  set status = case
        when jobs.status = 'queued' then 'running'
        else jobs.status
      end,
      started_at = coalesce(jobs.started_at, now()),
      claim_expires_at = now() + make_interval(secs => p_lease_seconds),
      progress = coalesce(jobs.progress, '{}'::jsonb) || jsonb_build_object(
        'stage', case
          when jobs.status = 'queued' then 'claimed'
          else coalesce(jobs.progress->>'stage', jobs.status)
        end
      )
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

alter table public.media_assets enable row level security;

create policy "Users can read own media assets"
on public.media_assets
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.media_assets from anon, authenticated;
grant select on public.media_assets to authenticated;
grant all on public.media_assets to service_role;

revoke all on function public.claim_media_jobs(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_media_jobs(integer, integer)
  to service_role;

insert into public.model_pricing_rules (
  provider,
  model,
  operation,
  display_name,
  markup_bps,
  minimum_charge_usd_micros,
  reserve_amount_usd_micros,
  enabled,
  metadata
)
values (
  'elevenlabs',
  'scribe_v2',
  'reel_captions',
  'Auto captions',
  2000,
  100000,
  100000,
  true,
  '{
    "billing_unit": "audio_minute",
    "public_rate_usd_per_minute": 0.10,
    "provider_rate_usd_per_hour": 0.40,
    "provider": "ElevenLabs Scribe v2",
    "minimum_charge_usd": 0.10
  }'::jsonb
)
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    enabled = excluded.enabled,
    metadata = excluded.metadata,
    updated_at = now();
```

- [ ] **Step 2: Reset local database**

Run:

```bash
supabase db reset
```

Expected: migrations apply without SQL errors.

- [ ] **Step 3: Verify migration shape**

Run:

```bash
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -c "\d public.media_assets"
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -c "\df public.claim_media_jobs"
```

Expected: `media_assets` exists and `claim_media_jobs(integer, integer)` exists.

- [ ] **Step 4: Commit**

Run:

```bash
git add supabase/migrations/20260701120000_hosted_media_jobs.sql
git commit -m "feat: add hosted media job schema"
```

## Task 3: Media Env, Tokens, And Storage Keys

**Files:**
- Modify: `.env.example`
- Create: `lib/media/env.ts`
- Create: `lib/media/tokens.ts`
- Create: `lib/media/storage-keys.ts`
- Create: `tests/media/tokens.test.ts`
- Create: `tests/media/storage-keys.test.ts`

- [ ] **Step 1: Document env vars**

Append to `.env.example`:

```dotenv
FAL_KEY=fal_replace_me
MEDIA_BASE_URL=https://media.woven.video
MEDIA_TOKEN_SECRET=replace_with_32_plus_random_bytes
MEDIA_WORKER_SHARED_SECRET=replace_with_32_plus_random_bytes
MEDIA_MAX_UPLOAD_BYTES=104857600
MEDIA_UPLOAD_URL_TTL_SECONDS=900
MEDIA_DOWNLOAD_URL_TTL_SECONDS=900
```

- [ ] **Step 2: Create env reader**

Create `lib/media/env.ts`:

```ts
export type MediaEnv = {
  baseUrl: string;
  tokenSecret: string;
  workerSharedSecret: string;
  maxUploadBytes: number;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
};

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function getMediaEnv(): MediaEnv {
  const tokenSecret = process.env.MEDIA_TOKEN_SECRET;
  const workerSharedSecret = process.env.MEDIA_WORKER_SHARED_SECRET;
  if (!tokenSecret) throw new Error("Missing MEDIA_TOKEN_SECRET.");
  if (!workerSharedSecret) throw new Error("Missing MEDIA_WORKER_SHARED_SECRET.");

  return {
    baseUrl: (process.env.MEDIA_BASE_URL ?? "https://media.woven.video").replace(/\/$/, ""),
    tokenSecret,
    workerSharedSecret,
    maxUploadBytes: integerEnv("MEDIA_MAX_UPLOAD_BYTES", 100 * 1024 * 1024),
    uploadUrlTtlSeconds: integerEnv("MEDIA_UPLOAD_URL_TTL_SECONDS", 15 * 60),
    downloadUrlTtlSeconds: integerEnv("MEDIA_DOWNLOAD_URL_TTL_SECONDS", 15 * 60),
  };
}
```

- [ ] **Step 3: Create token helper**

Create `lib/media/tokens.ts`:

```ts
export type MediaTokenPayload = {
  kind: "upload" | "download";
  sub: string;
  key: string;
  assetId?: string;
  jobId?: string;
  contentType?: string;
  sizeBytes?: number;
  exp: number;
};

const encoder = new TextEncoder();

export async function signMediaToken(
  payload: MediaTokenPayload,
  secret: string,
): Promise<string> {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(body, secret);
  return `${body}.${signature}`;
}

export async function verifyMediaToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<MediaTokenPayload | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = await hmacSha256(body, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  let payload: MediaTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as MediaTokenPayload;
  } catch {
    return null;
  }

  if (payload.exp < nowSeconds) return null;
  if (payload.kind !== "upload" && payload.kind !== "download") return null;
  if (!payload.sub || !payload.key) return null;
  return payload;
}

async function hmacSha256(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
```

- [ ] **Step 4: Create storage key helper**

Create `lib/media/storage-keys.ts`:

```ts
const SAFE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
};

export function mediaInputKey({
  userId,
  assetId,
  filename,
  contentType,
}: {
  userId: string;
  assetId: string;
  filename: string;
  contentType: string;
}): string {
  const extension = extensionFor(filename, contentType);
  return `users/${userId}/media/tmp/${assetId}/input${extension}`;
}

export function mediaOutputKey({
  userId,
  jobId,
  outputId,
  contentType,
}: {
  userId: string;
  jobId: string;
  outputId: string;
  contentType: string;
}): string {
  return `users/${userId}/media/outputs/${jobId}/${outputId}${extensionFor("", contentType)}`;
}

export function extensionFor(filename: string, contentType: string): string {
  const lower = filename.toLowerCase();
  const match = lower.match(/\.[a-z0-9]{1,8}$/);
  if (match) return match[0];
  return SAFE_EXTENSIONS[contentType] ?? ".bin";
}
```

- [ ] **Step 5: Add token tests**

Create `tests/media/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { signMediaToken, verifyMediaToken } from "@/lib/media/tokens";

describe("media tokens", () => {
  it("round trips a valid upload token", async () => {
    const token = await signMediaToken({
      kind: "upload",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      assetId: "asset_1",
      contentType: "image/png",
      sizeBytes: 10,
      exp: 2_000,
    }, "secret");

    await expect(verifyMediaToken(token, "secret", 1_000)).resolves.toMatchObject({
      kind: "upload",
      sub: "user_1",
      assetId: "asset_1",
    });
  });

  it("rejects expired and tampered tokens", async () => {
    const token = await signMediaToken({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      exp: 1_000,
    }, "secret");

    await expect(verifyMediaToken(token, "secret", 1_001)).resolves.toBeNull();
    await expect(verifyMediaToken(`${token}x`, "secret", 999)).resolves.toBeNull();
  });
});
```

- [ ] **Step 6: Add key tests**

Create `tests/media/storage-keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mediaInputKey, mediaOutputKey } from "@/lib/media/storage-keys";

describe("media storage keys", () => {
  it("builds asset-scoped temp input keys", () => {
    expect(mediaInputKey({
      userId: "user_1",
      assetId: "asset_1",
      filename: "Clip.MOV",
      contentType: "video/quicktime",
    })).toBe("users/user_1/media/tmp/asset_1/input.mov");
  });

  it("builds job-scoped output keys", () => {
    expect(mediaOutputKey({
      userId: "user_1",
      jobId: "job_1",
      outputId: "out_1",
      contentType: "video/mp4",
    })).toBe("users/user_1/media/outputs/job_1/out_1.mp4");
  });
});
```

- [ ] **Step 7: Verify**

Run:

```bash
pnpm test -- tests/media/tokens.test.ts tests/media/storage-keys.test.ts
pnpm exec tsc --noEmit
```

Expected: tests and typecheck pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add .env.example lib/media/env.ts lib/media/tokens.ts lib/media/storage-keys.ts tests/media/tokens.test.ts tests/media/storage-keys.test.ts
git commit -m "feat: add media URL token helpers"
```

## Task 4: Curated Model Registry And Parameter Validation

**Files:**
- Create: `lib/media/types.ts`
- Create: `lib/media/model-registry.ts`
- Create: `lib/media/schema.ts`
- Create: `tests/media/model-registry.test.ts`
- Create: `tests/media/schema.test.ts`

- [ ] **Step 1: Create shared types**

Create `lib/media/types.ts`:

```ts
import type { ModelPricingRule } from "@/lib/billing/model-pricing";

export const MEDIA_OPERATIONS = [
  "image_generation",
  "video_generation",
  "text_to_speech",
  "sound_effects",
  "music_generation",
  "reel_captions",
] as const;

export type MediaOperation = (typeof MEDIA_OPERATIONS)[number];
export type MediaKind = "image" | "video" | "audio" | "captions";
export type MediaProvider = "fal" | "elevenlabs";

export type MediaParameterSchema = {
  type: "object";
  required?: string[];
  properties?: Record<string, { type: "string" | "number" | "boolean" | "object" | "array" }>;
};

export type MediaModel = {
  id: string;
  provider: MediaProvider;
  providerModel: string;
  providerEndpoint: string;
  operation: MediaOperation;
  kind: MediaKind;
  displayName: string;
  supportsUploadedInputs: boolean;
  supportedInputTypes: string[];
  outputTypes: string[];
  defaultParameters: Record<string, unknown>;
  parameterSchema: MediaParameterSchema;
  pricing: {
    unit: "job" | "second" | "minute";
    minimumUsdMicros: number;
    reserveUsdMicros: number;
    markupBps: number;
  };
  metadata: Record<string, unknown>;
  rule: ModelPricingRule;
};
```

- [ ] **Step 2: Create registry parser**

Create `lib/media/model-registry.ts`:

```ts
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ModelPricingRule } from "@/lib/billing/model-pricing";
import {
  MEDIA_OPERATIONS,
  type MediaKind,
  type MediaModel,
  type MediaOperation,
  type MediaParameterSchema,
  type MediaProvider,
} from "@/lib/media/types";

const SELECT_COLUMNS =
  "id, provider, model, operation, display_name, markup_bps, minimum_charge_usd_micros, reserve_amount_usd_micros, enabled, metadata";

export async function listMediaModels(): Promise<MediaModel[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("model_pricing_rules")
    .select(SELECT_COLUMNS)
    .in("operation", [...MEDIA_OPERATIONS])
    .eq("enabled", true)
    .order("display_name");

  if (error) throw new Error(error.message);
  return (data ?? []).map((rule) => parseMediaModel(rule as ModelPricingRule)).filter(Boolean);
}

export async function getMediaModel(id: string): Promise<MediaModel | null> {
  const models = await listMediaModels();
  return models.find((model) => model.id === id) ?? null;
}

export function parseMediaModel(rule: ModelPricingRule): MediaModel | null {
  const metadata = rule.metadata ?? {};
  const publicId = stringValue(metadata.public_id);
  const providerEndpoint = stringValue(metadata.provider_endpoint);
  const kind = mediaKind(metadata.kind);
  const provider = mediaProvider(rule.provider);
  const operation = mediaOperation(rule.operation);
  const parameterSchema = schemaValue(metadata.parameter_schema);

  if (!publicId || !providerEndpoint || !kind || !provider || !operation || !parameterSchema) {
    return null;
  }

  return {
    id: publicId,
    provider,
    providerModel: rule.model,
    providerEndpoint,
    operation,
    kind,
    displayName: rule.display_name,
    supportsUploadedInputs: Boolean(metadata.supports_uploaded_inputs),
    supportedInputTypes: stringArray(metadata.supported_input_types),
    outputTypes: stringArray(metadata.output_types),
    defaultParameters: objectValue(metadata.default_parameters),
    parameterSchema,
    pricing: {
      unit: pricingUnit(metadata.pricing_unit),
      minimumUsdMicros: Number(rule.minimum_charge_usd_micros),
      reserveUsdMicros: Number(rule.reserve_amount_usd_micros),
      markupBps: Number(rule.markup_bps),
    },
    metadata,
    rule,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim()) : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function schemaValue(value: unknown): MediaParameterSchema | null {
  const object = objectValue(value);
  return object.type === "object" ? object as MediaParameterSchema : { type: "object", properties: {} };
}

function mediaProvider(value: string): MediaProvider | null {
  return value === "fal" || value === "elevenlabs" ? value : null;
}

function mediaOperation(value: string): MediaOperation | null {
  return (MEDIA_OPERATIONS as readonly string[]).includes(value) ? value as MediaOperation : null;
}

function mediaKind(value: unknown): MediaKind | null {
  return value === "image" || value === "video" || value === "audio" || value === "captions" ? value : null;
}

function pricingUnit(value: unknown): "job" | "second" | "minute" {
  return value === "second" || value === "minute" ? value : "job";
}
```

- [ ] **Step 3: Create parameter validator**

Create `lib/media/schema.ts`:

```ts
import type { MediaParameterSchema } from "@/lib/media/types";

export function validateMediaParameters(
  parameters: unknown,
  schema: MediaParameterSchema,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    return { ok: false, error: "parameters must be a JSON object." };
  }

  const value = parameters as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!(key in value)) return { ok: false, error: `Missing required parameter: ${key}.` };
  }

  for (const [key, rule] of Object.entries(schema.properties ?? {})) {
    if (!(key in value)) continue;
    if (!matchesType(value[key], rule.type)) {
      return { ok: false, error: `Invalid parameter type for ${key}: expected ${rule.type}.` };
    }
  }

  return { ok: true, value };
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === type;
}
```

- [ ] **Step 4: Add tests**

Create `tests/media/schema.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { validateMediaParameters } from "@/lib/media/schema";

describe("validateMediaParameters", () => {
  it("accepts required typed parameters", () => {
    const result = validateMediaParameters(
      { prompt: "a cat", duration: 5 },
      {
        type: "object",
        required: ["prompt"],
        properties: { prompt: { type: "string" }, duration: { type: "number" } },
      },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects missing and mistyped parameters", () => {
    expect(validateMediaParameters({}, { type: "object", required: ["prompt"] })).toEqual({
      ok: false,
      error: "Missing required parameter: prompt.",
    });
    expect(validateMediaParameters({ prompt: 7 }, {
      type: "object",
      properties: { prompt: { type: "string" } },
    })).toEqual({
      ok: false,
      error: "Invalid parameter type for prompt: expected string.",
    });
  });
});
```

Create `tests/media/model-registry.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { parseMediaModel } from "@/lib/media/model-registry";
import type { ModelPricingRule } from "@/lib/billing/model-pricing";

describe("parseMediaModel", () => {
  it("normalizes curated pricing metadata into a public model", () => {
    const model = parseMediaModel({
      id: "rule_1",
      provider: "fal",
      model: "fal-ai/frontier-video",
      operation: "video_generation",
      display_name: "Frontier Video",
      markup_bps: 2000,
      minimum_charge_usd_micros: 100000,
      reserve_amount_usd_micros: 500000,
      enabled: true,
      metadata: {
        public_id: "fal:frontier-video",
        provider_endpoint: "fal-ai/frontier-video",
        kind: "video",
        supports_uploaded_inputs: true,
        supported_input_types: ["image"],
        output_types: ["video"],
        pricing_unit: "job",
        parameter_schema: { type: "object", required: ["prompt"] },
      },
    } satisfies ModelPricingRule);

    expect(model).toMatchObject({
      id: "fal:frontier-video",
      provider: "fal",
      kind: "video",
      pricing: { unit: "job", reserveUsdMicros: 500000, markupBps: 2000 },
    });
  });
});
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm test -- tests/media/model-registry.test.ts tests/media/schema.test.ts
pnpm exec tsc --noEmit
git add lib/media/types.ts lib/media/model-registry.ts lib/media/schema.ts tests/media/model-registry.test.ts tests/media/schema.test.ts
git commit -m "feat: add curated media model registry"
```

Expected: tests and typecheck pass before commit.

## Task 5: Media Asset Service And Upload Route

**Files:**
- Create: `lib/media/assets.ts`
- Create: `app/api/v1/media/uploads/route.ts`
- Create: `app/api/internal/media/uploads/complete/route.ts`
- Create: `tests/media/assets.test.ts`

- [ ] **Step 1: Create asset service**

Create `lib/media/assets.ts`:

```ts
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getMediaEnv } from "@/lib/media/env";
import { mediaInputKey } from "@/lib/media/storage-keys";
import { signMediaToken } from "@/lib/media/tokens";

export type MediaAssetRow = {
  id: string;
  user_id: string;
  job_id: string | null;
  kind: "input" | "output";
  status: string;
  content_type: string;
  size_bytes: number | string;
  original_filename: string | null;
  storage_key: string;
  upload_expires_at: string | null;
  metadata: Record<string, unknown>;
};

export function isSupportedInputContentType(contentType: string): boolean {
  return /^(image|video|audio)\//.test(contentType);
}

export async function createInputAssetUpload({
  userId,
  filename,
  contentType,
  sizeBytes,
}: {
  userId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}) {
  const env = getMediaEnv();
  if (!isSupportedInputContentType(contentType)) throw new Error("invalid_media_input");
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new Error("invalid_media_input");
  if (sizeBytes > env.maxUploadBytes) throw new Error("upload_too_large");

  const admin = createSupabaseAdminClient();
  const expiresAt = new Date(Date.now() + env.uploadUrlTtlSeconds * 1000).toISOString();
  const { data: initial, error: insertError } = await admin
    .from("media_assets")
    .insert({
      user_id: userId,
      kind: "input",
      status: "pending",
      content_type: contentType,
      size_bytes: sizeBytes,
      original_filename: filename.slice(0, 180),
      storage_key: `pending/${crypto.randomUUID()}`,
      upload_expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !initial?.id) throw new Error(insertError?.message ?? "media_asset_create_failed");

  const storageKey = mediaInputKey({ userId, assetId: String(initial.id), filename, contentType });
  const { data, error: updateError } = await admin
    .from("media_assets")
    .update({ storage_key: storageKey })
    .eq("id", initial.id)
    .select("id, user_id, job_id, kind, status, content_type, size_bytes, original_filename, storage_key, upload_expires_at, metadata")
    .single();

  if (updateError || !data) throw new Error(updateError?.message ?? "media_asset_update_failed");

  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
  const token = await signMediaToken({
    kind: "upload",
    sub: userId,
    key: storageKey,
    assetId: String(initial.id),
    contentType,
    sizeBytes,
    exp,
  }, env.tokenSecret);

  return {
    asset: data as MediaAssetRow,
    uploadUrl: `${env.baseUrl}/uploads/${initial.id}?token=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

export async function markInputAssetUploaded({
  assetId,
  storageKey,
  sizeBytes,
}: {
  assetId: string;
  storageKey: string;
  sizeBytes: number;
}) {
  const admin = createSupabaseAdminClient();
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

  if (error || !data) throw new Error(error?.message ?? "media_asset_upload_complete_failed");
}
```

- [ ] **Step 2: Add upload route**

Create `app/api/v1/media/uploads/route.ts`:

```ts
import { requireApiAuth } from "@/lib/api/auth";
import { licenseGateResponse } from "@/lib/api/license";
import { apiError } from "@/lib/api/responses";
import { createInputAssetUpload } from "@/lib/media/assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UploadBody = {
  filename?: unknown;
  content_type?: unknown;
  size_bytes?: unknown;
  purpose?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;
  const licenseError = await licenseGateResponse(authResult.auth);
  if (licenseError) return licenseError;

  const payload = await request.json().catch(() => null);
  if (!isObject(payload)) return apiError("Request body must be a JSON object.");
  const body = payload as UploadBody;

  if (body.purpose !== "media_input") return apiError("purpose must be media_input.", 400, "invalid_media_input");
  if (typeof body.filename !== "string" || !body.filename.trim()) return apiError("filename is required.", 400, "invalid_media_input");
  if (typeof body.content_type !== "string" || !body.content_type.trim()) return apiError("content_type is required.", 400, "invalid_media_input");
  const sizeBytes = Number(body.size_bytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return apiError("size_bytes must be a positive integer.", 400, "invalid_media_input");

  try {
    const upload = await createInputAssetUpload({
      userId: authResult.auth.user.id,
      filename: body.filename,
      contentType: body.content_type,
      sizeBytes,
    });

    return Response.json({
      upload_id: upload.asset.id,
      asset_id: upload.asset.id,
      method: "PUT",
      upload_url: upload.uploadUrl,
      expires_at: upload.expiresAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create upload.";
    if (message === "upload_too_large") return apiError("Upload is too large.", 413, "upload_too_large");
    if (message === "invalid_media_input") return apiError("Invalid media input.", 400, "invalid_media_input");
    return apiError(message, 500, "media_upload_failed");
  }
}
```

- [ ] **Step 3: Add internal upload completion route**

Create `app/api/internal/media/uploads/complete/route.ts`:

```ts
import { apiError } from "@/lib/api/responses";
import { getMediaEnv } from "@/lib/media/env";
import { markInputAssetUploaded } from "@/lib/media/assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-woven-media-worker-secret");
  if (secret !== getMediaEnv().workerSharedSecret) {
    return apiError("Unauthorized.", 401, "unauthorized");
  }

  const payload = await request.json().catch(() => null);
  if (!isObject(payload)) return apiError("Request body must be a JSON object.");

  const assetId = typeof payload.asset_id === "string" ? payload.asset_id : "";
  const storageKey = typeof payload.storage_key === "string" ? payload.storage_key : "";
  const sizeBytes = Number(payload.size_bytes);
  if (!assetId || !storageKey || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    return apiError("Invalid upload completion payload.", 400, "invalid_media_input");
  }

  await markInputAssetUploaded({ assetId, storageKey, sizeBytes });
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: typecheck and lint pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/media/assets.ts app/api/v1/media/uploads/route.ts app/api/internal/media/uploads/complete/route.ts
git commit -m "feat: add media upload slots"
```

## Task 6: Public Model Catalog Route

**Files:**
- Create: `app/api/v1/media/models/route.ts`

- [ ] **Step 1: Create route**

Create `app/api/v1/media/models/route.ts`:

```ts
import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { listMediaModels } from "@/lib/media/model-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const models = await listMediaModels();
    return Response.json({
      models: models.map((model) => ({
        id: model.id,
        provider: model.provider,
        kind: model.kind,
        display_name: model.displayName,
        enabled: true,
        supports_uploaded_inputs: model.supportsUploadedInputs,
        supported_input_types: model.supportedInputTypes,
        output_types: model.outputTypes,
        estimated_price: {
          unit: model.pricing.unit,
          minimum_usd_micros: model.pricing.minimumUsdMicros,
          reserve_usd_micros: model.pricing.reserveUsdMicros,
          markup_bps: model.pricing.markupBps,
        },
        default_parameters: model.defaultParameters,
        parameter_schema: model.parameterSchema,
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Unable to list media models.",
      500,
      "internal_server_error",
    );
  }
}
```

- [ ] **Step 2: Verify**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: typecheck and lint pass.

- [ ] **Step 3: Commit**

Run:

```bash
git add app/api/v1/media/models/route.ts
git commit -m "feat: add media model catalog route"
```

## Task 7: Media Job Creation And Status Routes

**Files:**
- Create: `lib/media/pricing.ts`
- Create: `lib/media/jobs.ts`
- Create: `app/api/v1/media/jobs/route.ts`
- Create: `app/api/v1/media/jobs/[jobId]/route.ts`
- Create: `app/api/v1/media/jobs/[jobId]/cancel/route.ts`
- Create: `tests/media/pricing.test.ts`

- [ ] **Step 1: Create pricing helper**

Create `lib/media/pricing.ts`:

```ts
import { chargeWithMarkupUsdMicros } from "@/lib/billing/money";
import type { MediaModel } from "@/lib/media/types";

export function reservationUsdMicros(model: MediaModel): number {
  return model.pricing.reserveUsdMicros;
}

export function chargeMediaUsdMicros({
  model,
  rawCostUsd,
}: {
  model: MediaModel;
  rawCostUsd: number | string;
}) {
  return chargeWithMarkupUsdMicros({
    rawCostUsd,
    markupBps: model.pricing.markupBps,
    minimumChargeUsdMicros: model.pricing.minimumUsdMicros,
  });
}
```

- [ ] **Step 2: Create job helper**

Create `lib/media/jobs.ts`:

```ts
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MediaModel } from "@/lib/media/types";
import { reservationUsdMicros } from "@/lib/media/pricing";

export async function createReservedMediaJob({
  userId,
  model,
  parameters,
  inputAssetIds,
}: {
  userId: string;
  model: MediaModel;
  parameters: Record<string, unknown>;
  inputAssetIds: string[];
}) {
  const admin = createSupabaseAdminClient();
  const reserveAmount = reservationUsdMicros(model);

  if (inputAssetIds.length > 0) {
    const { data: assets, error: assetError } = await admin
      .from("media_assets")
      .select("id, status, content_type")
      .eq("user_id", userId)
      .in("id", inputAssetIds);
    if (assetError) throw new Error(assetError.message);
    if ((assets ?? []).length !== inputAssetIds.length) throw new Error("invalid_media_input");
    for (const asset of assets ?? []) {
      if (asset.status !== "uploaded") throw new Error("upload_not_complete");
      const family = String(asset.content_type).split("/")[0];
      if (!model.supportedInputTypes.includes(family)) throw new Error("invalid_media_input");
    }
  }

  if (inputAssetIds.length === 0 && model.supportsUploadedInputs && model.metadata.requires_uploaded_input === true) {
    throw new Error("invalid_media_input");
  }

  const { data: job, error: jobError } = await admin
    .from("generation_jobs")
    .insert({
      user_id: userId,
      type: "media_job",
      provider: model.provider,
      model: model.providerModel,
      status: "queued",
      estimated_cost_usd_micros: reserveAmount,
      input: {
        media_model_id: model.id,
        operation: model.operation,
        parameters,
        input_asset_ids: inputAssetIds,
      },
      progress: { stage: "queued", percent: null },
    })
    .select("id, status, estimated_cost_usd_micros, reserved_amount_usd_micros, created_at")
    .single();

  if (jobError || !job?.id) throw new Error(jobError?.message ?? "media_job_create_failed");

  const { error: reserveError } = await admin.rpc("reserve_balance", {
    p_user_id: userId,
    p_job_id: job.id,
    p_amount_usd_micros: reserveAmount,
    p_metadata: {
      provider: model.provider,
      model: model.providerModel,
      operation: model.operation,
      media_model_id: model.id,
    },
  });

  if (reserveError) {
    await admin.from("generation_jobs").update({
      status: "failed",
      error: reserveError.message,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    throw new Error(reserveError.message);
  }

  await admin
    .from("media_assets")
    .update({ job_id: job.id, status: "attached" })
    .in("id", inputAssetIds)
    .eq("user_id", userId)
    .eq("status", "uploaded");

  return {
    id: String(job.id),
    status: "queued",
    model: model.id,
    estimatedCostUsdMicros: reserveAmount,
    reservedCreditsUsdMicros: reserveAmount,
    createdAt: String(job.created_at),
  };
}
```

- [ ] **Step 3: Create job route**

Create `app/api/v1/media/jobs/route.ts`:

```ts
import { requireApiAuth } from "@/lib/api/auth";
import { licenseGateResponse } from "@/lib/api/license";
import { apiError } from "@/lib/api/responses";
import { createReservedMediaJob } from "@/lib/media/jobs";
import { getMediaModel } from "@/lib/media/model-registry";
import { validateMediaParameters } from "@/lib/media/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;
  const licenseError = await licenseGateResponse(authResult.auth);
  if (licenseError) return licenseError;

  const payload = await request.json().catch(() => null);
  if (!isObject(payload)) return apiError("Request body must be a JSON object.");
  const modelId = typeof payload.model === "string" ? payload.model : "";
  const model = modelId ? await getMediaModel(modelId) : null;
  if (!model) return apiError("Media model is not enabled.", 404, "model_not_enabled");

  const parameters = validateMediaParameters(payload.parameters ?? {}, model.parameterSchema);
  if (!parameters.ok) return apiError(parameters.error, 400, "invalid_media_input");

  const inputAssetIds = Array.isArray(payload.input_asset_ids)
    ? payload.input_asset_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

  try {
    const job = await createReservedMediaJob({
      userId: authResult.auth.user.id,
      model,
      parameters: parameters.value,
      inputAssetIds,
    });

    return Response.json({
      id: job.id,
      status: job.status,
      model: job.model,
      estimated_cost_usd_micros: job.estimatedCostUsdMicros,
      reserved_credits_usd_micros: job.reservedCreditsUsdMicros,
      created_at: job.createdAt,
      expires_at: null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create media job.";
    if (message === "insufficient_balance") {
      return apiError("Insufficient balance. Add funds before creating media jobs.", 402, "insufficient_balance");
    }
    if (message === "upload_not_complete") {
      return apiError("Upload is not complete.", 409, "upload_not_complete");
    }
    if (message === "invalid_media_input") {
      return apiError("Invalid media input.", 400, "invalid_media_input");
    }
    return apiError(message, 500, "media_job_create_failed");
  }
}
```

- [ ] **Step 4: Create status route**

Create `app/api/v1/media/jobs/[jobId]/route.ts`:

```ts
import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const { jobId } = await context.params;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("generation_jobs")
    .select("id, provider, model, status, estimated_cost_usd_micros, reserved_amount_usd_micros, final_cost_usd_micros, progress, output, error, created_at, started_at, completed_at")
    .eq("id", jobId)
    .eq("user_id", authResult.auth.user.id)
    .eq("type", "media_job")
    .maybeSingle();

  if (error) return apiError(error.message, 500, "media_job_lookup_failed");
  if (!data) return apiError("Media job not found.", 404, "job_not_found");

  return Response.json({
    id: data.id,
    status: data.status,
    model: data.output?.media_model_id ?? data.input?.media_model_id ?? null,
    progress: data.progress ?? { stage: data.status, percent: null },
    estimated_cost_usd_micros: data.estimated_cost_usd_micros,
    reserved_credits_usd_micros: data.reserved_amount_usd_micros,
    final_cost_usd_micros: data.final_cost_usd_micros,
    outputs: Array.isArray(data.output?.outputs) ? data.output.outputs : [],
    error: data.error ? { code: "provider_failed", message: data.error } : null,
    created_at: data.created_at,
    started_at: data.started_at,
    completed_at: data.completed_at,
  }, { headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 5: Create cancellation route**

Create `app/api/v1/media/jobs/[jobId]/cancel/route.ts`:

```ts
import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const { jobId } = await context.params;
  const admin = createSupabaseAdminClient();
  const { data: job, error: lookupError } = await admin
    .from("generation_jobs")
    .select("id, status")
    .eq("id", jobId)
    .eq("user_id", authResult.auth.user.id)
    .eq("type", "media_job")
    .maybeSingle();

  if (lookupError) return apiError(lookupError.message, 500, "media_job_lookup_failed");
  if (!job) return apiError("Media job not found.", 404, "job_not_found");
  if (job.status !== "queued") return apiError("Only queued jobs can be cancelled.", 409, "job_not_ready");

  const { data, error } = await admin.rpc("release_balance_reservation", {
    p_job_id: jobId,
    p_status: "cancelled",
    p_error: "Cancelled by user.",
    p_metadata: { reason: "user_cancelled" },
  });

  if (error) return apiError(error.message, 500, "media_job_cancel_failed");
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 6: Add pricing test**

Create `tests/media/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chargeMediaUsdMicros } from "@/lib/media/pricing";
import type { MediaModel } from "@/lib/media/types";

const model = {
  pricing: { markupBps: 2000, minimumUsdMicros: 100000, reserveUsdMicros: 500000, unit: "job" },
} as MediaModel;

describe("chargeMediaUsdMicros", () => {
  it("applies 20 percent markup over raw cost", () => {
    expect(chargeMediaUsdMicros({ model, rawCostUsd: "0.25" })).toMatchObject({
      rawCostUsdMicros: 250000,
      chargedAmountUsdMicros: 300000,
      markupAmountUsdMicros: 50000,
    });
  });

  it("honors minimum charge", () => {
    expect(chargeMediaUsdMicros({ model, rawCostUsd: "0.01" }).chargedAmountUsdMicros).toBe(100000);
  });
});
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm test -- tests/media/pricing.test.ts
pnpm exec tsc --noEmit
pnpm lint
git add lib/media/pricing.ts lib/media/jobs.ts app/api/v1/media/jobs app/api/v1/media/jobs/route.ts tests/media/pricing.test.ts
git commit -m "feat: add media job routes"
```

Expected: tests, typecheck, and lint pass before commit.

## Task 8: Cloudflare Media Worker

**Files:**
- Create: `workers/media/index.ts`
- Create: `workers/media/types.d.ts`
- Create: `tests/media/media-worker.test.ts`

- [ ] **Step 1: Create Worker**

Create `workers/media/index.ts`:

```ts
type Env = {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_TOKEN_SECRET: string;
  MEDIA_WORKER_SHARED_SECRET: string;
  WOVEN_API_BASE_URL: string;
  MEDIA_MAX_UPLOAD_BYTES: string;
};

type TokenPayload = {
  kind: "upload" | "download";
  sub: string;
  key: string;
  assetId?: string;
  contentType?: string;
  sizeBytes?: number;
  exp: number;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "PUT" && url.pathname.startsWith("/uploads/")) {
      return handleUpload(request, env, url);
    }
    if (request.method === "GET" && url.pathname.startsWith("/objects/")) {
      return handleDownload(request, env, url);
    }
    return new Response("Not found", { status: 404 });
  },
};

async function handleUpload(request: Request, env: Env, url: URL): Promise<Response> {
  const payload = await verifyToken(url.searchParams.get("token") ?? "", env.MEDIA_TOKEN_SECRET);
  if (!payload || payload.kind !== "upload" || !payload.assetId) return new Response("Unauthorized", { status: 401 });
  if (Date.now() / 1000 > payload.exp) return new Response("Expired", { status: 401 });

  const contentType = request.headers.get("content-type") ?? "";
  if (payload.contentType && contentType !== payload.contentType) return new Response("Content-Type mismatch", { status: 400 });

  const contentLength = Number(request.headers.get("content-length") ?? payload.sizeBytes ?? 0);
  const maxUploadBytes = Number(env.MEDIA_MAX_UPLOAD_BYTES || 104857600);
  if (!Number.isFinite(contentLength) || contentLength <= 0) return new Response("Content-Length required", { status: 411 });
  if (contentLength > maxUploadBytes || (payload.sizeBytes && contentLength > payload.sizeBytes)) return new Response("Upload too large", { status: 413 });
  if (!request.body) return new Response("Missing body", { status: 400 });

  await env.MEDIA_BUCKET.put(payload.key, request.body, {
    httpMetadata: { contentType },
    customMetadata: { user_id: payload.sub, asset_id: payload.assetId },
  });

  await fetch(`${env.WOVEN_API_BASE_URL.replace(/\/$/, "")}/api/internal/media/uploads/complete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-woven-media-worker-secret": env.MEDIA_WORKER_SHARED_SECRET,
    },
    body: JSON.stringify({
      asset_id: payload.assetId,
      storage_key: payload.key,
      size_bytes: contentLength,
    }),
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function handleDownload(request: Request, env: Env, url: URL): Promise<Response> {
  const payload = await verifyToken(url.searchParams.get("token") ?? "", env.MEDIA_TOKEN_SECRET);
  if (!payload || payload.kind !== "download") return new Response("Unauthorized", { status: 401 });
  if (Date.now() / 1000 > payload.exp) return new Response("Expired", { status: 401 });

  const object = await env.MEDIA_BUCKET.get(payload.key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=60");
  return new Response(object.body, { headers });
}

async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = await hmacSha256(body, secret);
  if (signature !== expected) return null;
  try {
    return JSON.parse(base64UrlDecode(body)) as TokenPayload;
  } catch {
    return null;
  }
}

async function hmacSha256(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}
```

- [ ] **Step 2: Verify TypeScript parse**

Create `workers/media/types.d.ts` so the repo can typecheck without adding Cloudflare Worker type packages:

```ts
type R2Object = {
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
};

type R2Bucket = {
  put(
    key: string,
    value: ReadableStream,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<void>;
  get(key: string): Promise<R2Object | null>;
};
```

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: typecheck passes.

- [ ] **Step 3: Commit**

Run:

```bash
git add workers/media
git commit -m "feat: add woven media worker"
```

## Task 9: Provider Adapter Interface And Worker Runner

**Files:**
- Create: `lib/media/provider.ts`
- Create: `lib/media/worker.ts`

- [ ] **Step 1: Create provider interface**

Create `lib/media/provider.ts`:

```ts
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
```

- [ ] **Step 2: Create worker library**

Create `lib/media/worker.ts` with these exported functions:

```ts
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getMediaModel } from "@/lib/media/model-registry";
import { chargeMediaUsdMicros } from "@/lib/media/pricing";
import type { MediaProviderAdapter, ProviderOutput } from "@/lib/media/provider";

export async function drainOneMediaJob({
  adapters,
}: {
  adapters: Record<string, MediaProviderAdapter>;
}): Promise<{ claimed: false } | { claimed: true; jobId: string; status: string }> {
  const admin = createSupabaseAdminClient();
  const { data: jobs, error } = await admin.rpc("claim_media_jobs", {
    p_limit: 1,
    p_lease_seconds: 300,
  });
  if (error) throw new Error(error.message);

  const job = Array.isArray(jobs) ? jobs[0] : null;
  if (!job) return { claimed: false };

  const input = job.input as Record<string, unknown>;
  const mediaModelId = typeof input.media_model_id === "string" ? input.media_model_id : "";
  const model = mediaModelId ? await getMediaModel(mediaModelId) : null;
  if (!model) {
    await releaseJob(job.id, "Media model is no longer enabled.");
    return { claimed: true, jobId: job.id, status: "failed" };
  }

  const adapter = adapters[model.provider];
  if (!adapter) {
    await releaseJob(job.id, "Provider is not configured.");
    return { claimed: true, jobId: job.id, status: "failed" };
  }

  const result = await adapter.run({
    model,
    parameters: objectValue(input.parameters),
    inputUrls: [],
    providerJobId: typeof job.provider_job_id === "string" ? job.provider_job_id : null,
  });

  if (result.status === "waiting_provider") {
    await admin.from("generation_jobs").update({
      status: "waiting_provider",
      provider_job_id: result.providerJobId,
      progress: { stage: "provider_wait", percent: null, message: "Waiting on provider" },
    }).eq("id", job.id);
    return { claimed: true, jobId: job.id, status: "waiting_provider" };
  }

  const charge = chargeMediaUsdMicros({ model, rawCostUsd: result.rawCostUsd });
  const outputPayload = {
    media_model_id: model.id,
    outputs: await materializeOutputs(job.user_id, job.id, result.outputs),
    provider_metadata: result.metadata ?? {},
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
  };

  const { error: usageError } = await admin.from("usage_events").insert({
    user_id: job.user_id,
    job_id: job.id,
    provider: model.provider,
    model: model.providerModel,
    operation: model.operation,
    raw_provider_cost: Number(result.rawCostUsd) || 0,
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
    markup_amount_usd_micros: charge.markupAmountUsdMicros,
    metadata: result.metadata ?? {},
  });
  if (usageError) throw new Error(usageError.message);

  const { error: settleError } = await admin.rpc("settle_balance_reservation", {
    p_job_id: job.id,
    p_final_cost_usd_micros: charge.chargedAmountUsdMicros,
    p_output: outputPayload,
    p_metadata: outputPayload,
  });
  if (settleError) throw new Error(settleError.message);

  return { claimed: true, jobId: job.id, status: "succeeded" };
}

async function releaseJob(jobId: string, error: string) {
  const admin = createSupabaseAdminClient();
  await admin.rpc("release_balance_reservation", {
    p_job_id: jobId,
    p_status: "failed",
    p_error: error,
    p_metadata: { reason: error },
  });
}

async function materializeOutputs(
  userId: string,
  jobId: string,
  outputs: ProviderOutput[],
) {
  return outputs.map((output, index) => ({
    id: `out_${index + 1}`,
    type: output.type,
    content_type: output.contentType,
    source_url: output.url,
    user_id: userId,
    job_id: jobId,
  }));
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
```

This first worker version records provider output source URLs in `output.outputs`. Task 11 replaces `source_url` with Woven download URLs after R2 copy helpers are in place.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: typecheck and lint pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add lib/media/provider.ts lib/media/worker.ts
git commit -m "feat: add media worker core"
```

## Task 10: Fal And ElevenLabs Adapters

**Files:**
- Create: `lib/media/providers/fal.ts`
- Create: `lib/media/providers/elevenlabs.ts`
- Create: `scripts/media-worker.ts`
- Create: `app/api/internal/media/jobs/drain/route.ts`

- [ ] **Step 1: Create Fal adapter**

Create `lib/media/providers/fal.ts`:

```ts
import { fal } from "@fal-ai/client";
import type { MediaProviderAdapter, ProviderOutput } from "@/lib/media/provider";

export const falMediaAdapter: MediaProviderAdapter = {
  async run({ model, parameters, inputUrls, providerJobId }) {
    const input = { ...model.defaultParameters, ...parameters };
    if (inputUrls.length > 0) {
      input.input_urls = inputUrls;
    }

    if (!providerJobId) {
      const submitted = await fal.queue.submit(model.providerEndpoint, { input });
      return { status: "waiting_provider", providerJobId: submitted.request_id };
    }

    const status = await fal.queue.status(model.providerEndpoint, {
      requestId: providerJobId,
      logs: true,
    });
    const statusText = String((status as Record<string, unknown>).status ?? "");
    if (!/completed|succeeded/i.test(statusText)) {
      return { status: "waiting_provider", providerJobId };
    }

    const result = await fal.queue.result(model.providerEndpoint, { requestId: providerJobId });
    return {
      status: "succeeded",
      outputs: extractFalOutputs(result, model.outputTypes),
      rawCostUsd: Number(model.metadata.provider_cost_usd ?? 0),
      metadata: { fal_request_id: providerJobId, fal_status: status },
    };
  },
};

export function extractFalOutputs(payload: unknown, outputTypes: string[]): ProviderOutput[] {
  const urls: ProviderOutput[] = [];
  collectUrls(payload, urls, outputTypes);
  return urls;
}

function collectUrls(value: unknown, outputs: ProviderOutput[], outputTypes: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, outputs, outputTypes);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const object = value as Record<string, unknown>;
  const url = object.url;
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    const type = outputTypes.includes("video") ? "video" : outputTypes.includes("audio") ? "audio" : "image";
    outputs.push({
      url,
      type,
      contentType: type === "video" ? "video/mp4" : type === "audio" ? "audio/mpeg" : "image/png",
    });
  }
  for (const child of Object.values(object)) collectUrls(child, outputs, outputTypes);
}
```

- [ ] **Step 2: Create ElevenLabs adapter**

Create `lib/media/providers/elevenlabs.ts`:

```ts
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { MediaProviderAdapter } from "@/lib/media/provider";

export const elevenLabsMediaAdapter: MediaProviderAdapter = {
  async run({ model, parameters }) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("provider_not_configured");
    const client = new ElevenLabsClient({ apiKey });

    if (model.operation === "text_to_speech") {
      return runTextToSpeech({ client, model, parameters });
    }

    if (model.operation === "sound_effects") {
      return runSoundEffects({ apiKey, model, parameters });
    }

    if (model.operation === "music_generation") {
      return runMusic({ apiKey, model, parameters });
    }

    throw new Error(`Unsupported ElevenLabs operation: ${model.operation}`);
  },
};

async function runTextToSpeech({
  client,
  model,
  parameters,
}: {
  client: ElevenLabsClient;
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
  parameters: Record<string, unknown>;
}) {
  const voiceId = stringValue(parameters.voice_id) ?? stringValue(model.metadata.voice_id);
  const text = stringValue(parameters.text);
  const modelId = stringValue(parameters.model_id) ?? model.providerModel;
  const outputFormat = stringValue(parameters.output_format) ?? "mp3_44100_128";
  if (!voiceId || !text) throw new Error("invalid_media_input");

  const audio = await client.textToSpeech.stream(voiceId, {
    text,
    modelId,
    outputFormat,
  });
  const bytes = await collectAsyncBytes(audio);
  return audioResult(bytes, model, { output_format: outputFormat });
}

async function runSoundEffects({
  apiKey,
  model,
  parameters,
}: {
  apiKey: string;
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
  parameters: Record<string, unknown>;
}) {
  const text = stringValue(parameters.text);
  if (!text) throw new Error("invalid_media_input");

  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: stringValue(parameters.model_id) ?? model.providerModel,
      duration_seconds: numberValue(parameters.duration_seconds),
      prompt_influence: numberValue(parameters.prompt_influence),
      loop: Boolean(parameters.loop),
    }),
  });
  if (!response.ok) throw new Error(`ElevenLabs sound effects failed: ${response.status}`);
  return audioResult(Buffer.from(await response.arrayBuffer()), model, { endpoint: "sound-generation" });
}

async function runMusic({
  apiKey,
  model,
  parameters,
}: {
  apiKey: string;
  model: Parameters<MediaProviderAdapter["run"]>[0]["model"];
  parameters: Record<string, unknown>;
}) {
  const response = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt: stringValue(parameters.prompt),
      composition_plan: objectValue(parameters.composition_plan),
      music_length_ms: numberValue(parameters.music_length_ms),
      model_id: stringValue(parameters.model_id) ?? model.providerModel,
      seed: numberValue(parameters.seed),
      force_instrumental: Boolean(parameters.force_instrumental),
    }),
  });
  if (!response.ok) throw new Error(`ElevenLabs music failed: ${response.status}`);
  return audioResult(Buffer.from(await response.arrayBuffer()), model, { endpoint: "music" });
}

function audioResult(bytes: Buffer, model: Parameters<MediaProviderAdapter["run"]>[0]["model"], metadata: Record<string, unknown>) {
  return {
    status: "succeeded" as const,
    outputs: [{ url: `data:audio/mpeg;base64,${bytes.toString("base64")}`, type: "audio" as const, contentType: "audio/mpeg" }],
    rawCostUsd: Number(model.metadata.provider_cost_usd ?? 0),
    metadata: { ...metadata, byte_length: bytes.byteLength },
  };
}

async function collectAsyncBytes(audio: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of audio) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
```

- [ ] **Step 3: Create process entrypoint**

Create `scripts/media-worker.ts`:

```ts
import { falMediaAdapter } from "@/lib/media/providers/fal";
import { elevenLabsMediaAdapter } from "@/lib/media/providers/elevenlabs";
import { drainOneMediaJob } from "@/lib/media/worker";

const pollMs = Number(process.env.MEDIA_WORKER_POLL_MS ?? 2000);

async function main() {
  for (;;) {
    const result = await drainOneMediaJob({
      adapters: {
        fal: falMediaAdapter,
        elevenlabs: elevenLabsMediaAdapter,
      },
    });
    if (!result.claimed) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Create internal drain route**

Create `app/api/internal/media/jobs/drain/route.ts`:

```ts
import { apiError } from "@/lib/api/responses";
import { getMediaEnv } from "@/lib/media/env";
import { falMediaAdapter } from "@/lib/media/providers/fal";
import { elevenLabsMediaAdapter } from "@/lib/media/providers/elevenlabs";
import { drainOneMediaJob } from "@/lib/media/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (request.headers.get("x-woven-media-worker-secret") !== getMediaEnv().workerSharedSecret) {
    return apiError("Unauthorized.", 401, "unauthorized");
  }

  const result = await drainOneMediaJob({
    adapters: {
      fal: falMediaAdapter,
      elevenlabs: elevenLabsMediaAdapter,
    },
  });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
git add lib/media/provider.ts lib/media/worker.ts lib/media/providers scripts/media-worker.ts app/api/internal/media/jobs/drain/route.ts
git commit -m "feat: add media worker provider adapters"
```

Expected: typecheck and lint pass before commit.

## Task 11: Copy Provider Outputs To R2 And Return Woven URLs

**Files:**
- Create: `lib/media/output-assets.ts`
- Modify: `lib/media/worker.ts`
- Modify: `tests/media/worker.test.ts`

- [ ] **Step 1: Create output helper**

Create `lib/media/output-assets.ts`:

```ts
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getMediaEnv } from "@/lib/media/env";
import { mediaOutputKey } from "@/lib/media/storage-keys";
import { signMediaToken } from "@/lib/media/tokens";
import type { ProviderOutput } from "@/lib/media/provider";

export async function createOutputAssetRows({
  userId,
  jobId,
  outputs,
}: {
  userId: string;
  jobId: string;
  outputs: ProviderOutput[];
}) {
  const admin = createSupabaseAdminClient();
  const env = getMediaEnv();

  return Promise.all(outputs.map(async (output) => {
    const outputId = crypto.randomUUID();
    const key = mediaOutputKey({
      userId,
      jobId,
      outputId,
      contentType: output.contentType,
    });
    const bytes = await readProviderOutput(output.url);

    const { data, error } = await admin
      .from("media_assets")
      .insert({
        id: outputId,
        user_id: userId,
        job_id: jobId,
        kind: "output",
        status: "pending",
        content_type: output.contentType,
        size_bytes: bytes.byteLength,
        storage_key: key,
        metadata: { provider_source_url: output.url },
      })
      .select("id, storage_key")
      .single();

    if (error || !data) throw new Error(error?.message ?? "media_output_create_failed");

    const uploadExp = Math.floor(Date.now() / 1000) + env.uploadUrlTtlSeconds;
    const uploadToken = await signMediaToken({
      kind: "upload",
      sub: userId,
      key,
      assetId: outputId,
      jobId,
      contentType: output.contentType,
      sizeBytes: bytes.byteLength,
      exp: uploadExp,
    }, env.tokenSecret);

    const uploadResponse = await fetch(`${env.baseUrl}/uploads/${outputId}?token=${encodeURIComponent(uploadToken)}`, {
      method: "PUT",
      headers: {
        "content-type": output.contentType,
        "content-length": String(bytes.byteLength),
      },
      body: bytes,
    });
    if (!uploadResponse.ok) {
      throw new Error(`media_output_upload_failed:${uploadResponse.status}`);
    }

    const { error: readyError } = await admin
      .from("media_assets")
      .update({
        status: "ready",
        metadata: {
          provider_source_url: output.url,
          copied_to_r2_at: new Date().toISOString(),
        },
      })
      .eq("id", outputId);
    if (readyError) throw new Error(readyError.message);

    const exp = Math.floor(Date.now() / 1000) + env.downloadUrlTtlSeconds;
    const token = await signMediaToken({
      kind: "download",
      sub: userId,
      key,
      assetId: outputId,
      jobId,
      exp,
    }, env.tokenSecret);

    return {
      id: outputId,
      type: output.type,
      content_type: output.contentType,
      url: `${env.baseUrl}/objects/${outputId}?token=${encodeURIComponent(token)}`,
      expires_at: new Date(exp * 1000).toISOString(),
    };
  }));
}

async function readProviderOutput(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma === -1) throw new Error("invalid_provider_output_data_url");
    return Buffer.from(url.slice(comma + 1), "base64");
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`provider_output_download_failed:${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
```

- [ ] **Step 2: Update worker output materialization**

In `lib/media/worker.ts`, replace the local `materializeOutputs` implementation with:

```ts
import { createOutputAssetRows } from "@/lib/media/output-assets";
```

and:

```ts
async function materializeOutputs(
  userId: string,
  jobId: string,
  outputs: ProviderOutput[],
) {
  return createOutputAssetRows({ userId, jobId, outputs });
}
```

- [ ] **Step 3: Verify**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: typecheck and lint pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add lib/media/output-assets.ts lib/media/worker.ts
git commit -m "feat: return woven media output URLs"
```

## Task 12: Fal Webhook Route

**Files:**
- Create: `app/api/v1/media/webhooks/fal/route.ts`

- [ ] **Step 1: Create webhook receiver**

Create `app/api/v1/media/webhooks/fal/route.ts`:

```ts
import { apiError } from "@/lib/api/responses";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return apiError("Request body must be a JSON object.");
  }

  const requestId = typeof payload.request_id === "string"
    ? payload.request_id
    : typeof payload.requestId === "string"
      ? payload.requestId
      : "";
  if (!requestId) return apiError("Missing Fal request id.", 400, "invalid_media_input");

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("generation_jobs")
    .update({
      progress: {
        stage: "provider_webhook_received",
        percent: null,
        message: "Provider callback received",
      },
      last_provider_poll_at: new Date().toISOString(),
    })
    .eq("provider_job_id", requestId)
    .eq("provider", "fal")
    .eq("type", "media_job");

  if (error) return apiError(error.message, 500, "provider_failed");
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 2: Verify and commit**

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
git add app/api/v1/media/webhooks/fal/route.ts
git commit -m "feat: add fal media webhook route"
```

Expected: typecheck and lint pass before commit.

## Task 13: Auto Captions Pricing And R2 Migration

**Files:**
- Modify: `lib/reel-captions/pricing.ts`
- Modify: `app/api/v1/reel-captions/jobs/route.ts`
- Modify: `app/api/v1/reel-captions/jobs/[jobId]/process/route.ts`
- Create: `tests/reel-captions/pricing.test.ts`

- [ ] **Step 1: Update caption pricing defaults**

In `lib/reel-captions/pricing.ts`, change constants to:

```ts
export const DEFAULT_PUBLIC_RATE_USD_PER_MINUTE = 0.10;
export const DEFAULT_PROVIDER_RATE_USD_PER_HOUR = 0.4;
export const DEFAULT_MINIMUM_CHARGE_USD_MICROS = 100_000;
```

Keep `chargeUsdMicrosForDuration()` formula as:

```ts
const micros = Math.ceil(
  (durationSeconds / 60) * publicRateUsdPerMinute * USD_MICROS_PER_USD,
);

return Math.max(minimum, micros);
```

- [ ] **Step 2: Add caption pricing test**

Create `tests/reel-captions/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chargeUsdMicrosForDuration } from "@/lib/reel-captions/pricing";

describe("reel caption pricing", () => {
  it("charges ten cents minimum", () => {
    expect(chargeUsdMicrosForDuration(1, null)).toBe(100000);
  });

  it("charges ten cents per minute rounded up to micros", () => {
    expect(chargeUsdMicrosForDuration(120, null)).toBe(200000);
    expect(chargeUsdMicrosForDuration(90, null)).toBe(150000);
  });
});
```

- [ ] **Step 3: Move caption upload creation to media upload helper**

In `app/api/v1/reel-captions/jobs/route.ts`, remove Supabase Storage signed upload creation and return a media upload slot using `createInputAssetUpload`. The response shape must include both the legacy `id` and the new media upload fields:

```ts
const upload = await createInputAssetUpload({
  userId: authResult.auth.user.id,
  filename: originalFilename,
  contentType: uploadContentType,
  sizeBytes: Number(payload.sizeBytes ?? 1),
});
```

Store this in job input:

```ts
input: {
  duration_seconds: duration,
  filename: originalFilename,
  content_type: uploadContentType,
  media_asset_id: upload.asset.id,
}
```

Return:

```ts
upload: {
  assetId: upload.asset.id,
  method: "PUT",
  url: upload.uploadUrl,
  expiresAt: upload.expiresAt,
  contentType: uploadContentType,
}
```

- [ ] **Step 4: Process captions from Woven media URL**

In `app/api/v1/reel-captions/jobs/[jobId]/process/route.ts`, replace the existing `admin.storage.from(storageBucket).createSignedUrl(storagePath, 10 * 60)` call with loading the `media_assets` row by `input.media_asset_id` and creating a short-lived Woven download URL using `signMediaToken`. Pass that URL to `transcribeWithElevenLabs({ cloudStorageUrl })`.

Use this output shape for the signed URL:

```ts
const signedAudioUrl = `${getMediaEnv().baseUrl}/objects/${asset.id}?token=${encodeURIComponent(token)}`;
```

After terminal success/failure, mark the input asset `deleted` in `media_assets`. Physical R2 deletion is handled by the cleanup task.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm test -- tests/reel-captions/pricing.test.ts
pnpm exec tsc --noEmit
pnpm lint
git add lib/reel-captions/pricing.ts app/api/v1/reel-captions/jobs tests/reel-captions/pricing.test.ts
git commit -m "feat: move captions to r2 media uploads"
```

Expected: tests, typecheck, and lint pass before commit.

## Task 14: Cleanup And Final Verification

**Files:**
- Create: `lib/media/cleanup.ts`
- Create: `app/api/internal/media/cleanup/route.ts`
- Modify: `docs/billing-architecture.md`

- [ ] **Step 1: Create cleanup helper**

Create `lib/media/cleanup.ts`:

```ts
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function markExpiredMediaForDeletion(nowIso = new Date().toISOString()) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("media_assets")
    .update({ status: "deleted", deleted_at: nowIso })
    .or(`upload_expires_at.lt.${nowIso},download_expires_at.lt.${nowIso}`)
    .neq("status", "deleted")
    .select("id, storage_key");

  if (error) throw new Error(error.message);
  return data ?? [];
}
```

- [ ] **Step 2: Create internal cleanup route**

Create `app/api/internal/media/cleanup/route.ts`:

```ts
import { apiError } from "@/lib/api/responses";
import { markExpiredMediaForDeletion } from "@/lib/media/cleanup";
import { getMediaEnv } from "@/lib/media/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (request.headers.get("x-woven-media-worker-secret") !== getMediaEnv().workerSharedSecret) {
    return apiError("Unauthorized.", 401, "unauthorized");
  }
  const deleted = await markExpiredMediaForDeletion();
  return Response.json({ deleted_count: deleted.length }, { headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 3: Update billing architecture docs**

In `docs/billing-architecture.md`, add a `Hosted Media Jobs` subsection after `Hosted Web Tools` with:

```md
## Hosted Media Jobs

Woven-hosted media jobs use `/api/v1/media/*` routes. Supabase stores auth, pricing, job, media asset, ledger, and usage-event rows. Cloudflare R2 stores media bytes behind `media.woven.video`; normal clients receive Woven-domain upload/download URLs, not raw R2 presigned URLs.

Job creation reserves credits before provider work starts. The media worker claims queued jobs with `claim_media_jobs`, calls Fal or ElevenLabs using server-owned keys, records `usage_events`, settles or releases the reservation, and writes final output refs into the job output.

Auto captions use the same R2 media input path and charge `$0.10/min` with a `$0.10` minimum.
```

- [ ] **Step 4: Full verification**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Expected: all commands pass.

- [ ] **Step 5: Manual API smoke checks**

Start the app:

```bash
pnpm dev
```

With a valid bearer token in `TOKEN`, run:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/media/models
curl -sS -X POST http://localhost:3000/api/v1/media/uploads \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"filename":"input.png","content_type":"image/png","size_bytes":12,"purpose":"media_input"}'
```

Expected:

- `/media/models` returns `{ "models": [] }` until curated rows are enabled.
- `/media/uploads` returns `upload_id`, `asset_id`, `method: "PUT"`, a `media.woven.video` upload URL, and `expires_at`.

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/media/cleanup.ts app/api/internal/media/cleanup/route.ts docs/billing-architecture.md
git commit -m "docs: document hosted media job operations"
```

## Execution Notes

- Keep commits task-sized. Do not combine migration, routes, worker, and captions changes in one commit.
- If a task reveals that `@fal-ai/client` or `@elevenlabs/elevenlabs-js` types differ from the digest, update the digest and the task code before continuing.
- Do not enable arbitrary provider models. A model appears in `/media/models` only when an enabled `model_pricing_rules` row has valid media metadata.
- Do not return raw R2 URLs from public routes. Return `media.woven.video` URLs only.
- Do not call a provider before `reserve_balance` succeeds.
