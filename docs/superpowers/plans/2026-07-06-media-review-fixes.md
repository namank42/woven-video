# Media Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per repo convention, implementer/reviewer subagents are `codex:codex-rescue`.

**Goal:** Fix all 17 pre-merge review findings on the hosted media jobs branch (settle cap, size-aware GPT Image quoting, submit durability, SSRF allowlist, caption fences, env gates, cleanups).

**Architecture:** Three new idempotent Supabase migrations (settle cap; lease fix + attempt-nonce column; catalog reseed), targeted changes to the executor/fal adapter/webhook route implementing the webhook self-heal pattern, a strict output-fetch helper, and route/env hardening. Spec: `docs/superpowers/specs/2026-07-06-media-review-fixes-design.md`.

**Tech Stack:** Next.js App Router, Supabase (plpgsql RPCs), @fal-ai/client 1.10.1, @trigger.dev/sdk 4.5.0, vitest.

**Docs digest:** `docs/superpowers/research/2026-07-05-media-review-fixes-docs.md` — every fal/Trigger/ElevenLabs API shape below comes from it, not memory.

## Global Constraints

- Branch: `feat/credit-models`. Never touch `pnpm-workspace.yaml` (untracked, out of scope).
- All money values are bigint USD micros; round charges UP (`usdToMicrosCeil`, `Math.ceil`).
- New SQL functions: `security definer`, `set search_path = public, extensions`, revoke from `public, anon, authenticated`, grant to `service_role` — exactly like existing media migrations.
- fal queue status enum is ONLY `IN_QUEUE | IN_PROGRESS | COMPLETED`; failures = webhook `status:"ERROR"` or `ApiError` from `queue.result` (digest).
- Trigger idempotency keys are retained 30 days by default; every `tasks.trigger` in this plan sets `idempotencyKeyTTL: "1h"` (digest).
- Run tests with `pnpm exec vitest run <path>`; full suite `pnpm test`. DB integration suite: `pnpm run test:media-db` (requires local Supabase; skip if unavailable and say so in the report).
- Commit after every task with the exact message given. Do not batch tasks into one commit.

---

### Task 1: Settle cap migration

**Files:**
- Create: `supabase/migrations/20260706120000_cap_media_settlement.sql`
- Modify: `lib/media/executor.ts:188-215` (capped-settlement warning)
- Test: `tests/media/db-rpcs.integration.test.ts`, `tests/media/executor.test.ts`

**Interfaces:**
- Consumes: existing `record_and_settle_claimed_media_job` / `settle_claimed_media_job` definitions in `supabase/migrations/20260701122000_claim_aware_media_job_finalization.sql`.
- Produces: both RPCs settle at `least(p_final_cost_usd_micros, reserved_amount_usd_micros)`; on cap, usage-event metadata gains `settlement_capped: true`, `uncapped_cost_usd_micros`, `overage_usd_micros`. Return row's `final_cost_usd_micros` reflects the capped charge.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/media/db-rpcs.integration.test.ts` (reuse the existing `insertMediaJob`/admin-client helpers in that file; follow the surrounding test style exactly):

```ts
it("caps settlement at the reserved amount and records the overage", async () => {
  const jobId = await insertMediaJob({
    status: "running",
    reserved: 100_000, // $0.10 reserved
    claimToken: crypto.randomUUID(),
  });
  const claimToken = await readClaimToken(jobId); // or however the harness exposes it

  const { data, error } = await admin.rpc("record_and_settle_claimed_media_job", {
    p_job_id: jobId,
    p_claim_token: claimToken,
    p_final_cost_usd_micros: 250_000, // $0.25 requested > $0.10 reserved
    p_output: { outputs: [] },
    p_metadata: {},
    p_usage_event: {
      user_id: testUserId,
      job_id: jobId,
      provider: "fal",
      model: "test-model",
      operation: "image_generation",
      charged_amount_usd_micros: 250_000,
      markup_amount_usd_micros: 0,
      metadata: {},
    },
  });

  expect(error).toBeNull();
  expect(Number(data.final_cost_usd_micros)).toBe(100_000);

  const { data: usage } = await admin
    .from("usage_events").select("charged_amount_usd_micros, metadata")
    .eq("job_id", jobId).single();
  expect(Number(usage.charged_amount_usd_micros)).toBe(100_000);
  expect(usage.metadata.settlement_capped).toBe(true);
  expect(Number(usage.metadata.uncapped_cost_usd_micros)).toBe(250_000);
  expect(Number(usage.metadata.overage_usd_micros)).toBe(150_000);
});
```

Also add the ledger-restoration test the reviewers flagged as missing:

```ts
it("restores the ledger balance when an expired reserved job is finalized", async () => {
  // Mirror the existing expiry test at ~line 216, but reserve for real instead
  // of inserting reserved_amount_usd_micros directly.
  const startingBalance = await readAccountBalance(testUserId); // helper: select balance from billing accounts (or sum ledger_entries) — reuse/add alongside the file's existing helpers
  const jobId = await insertMediaJob({
    status: "queued",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const { error: reserveError } = await admin.rpc("reserve_balance", {
    p_job_id: jobId,
    p_amount_usd_micros: 100_000,
  }); // match the exact reserve RPC name/args used by lib/media/jobs.ts — grep "reserve" there before writing
  expect(reserveError).toBeNull();
  expect(await readAccountBalance(testUserId)).toBe(startingBalance - 100_000);

  const { error } = await admin.rpc("finalize_expired_media_jobs_for_reconciliation", {
    p_limit: 100, p_now: new Date().toISOString(),
  });
  expect(error).toBeNull();
  expect(await readAccountBalance(testUserId)).toBe(startingBalance);

  const { data: job } = await admin.from("generation_jobs")
    .select("status, error, final_cost_usd_micros").eq("id", jobId).single();
  expect(job).toMatchObject({ status: "failed", error: "media_job_timed_out", final_cost_usd_micros: 0 });
});
```

The reserve RPC name and argument list MUST be copied from the actual call in `lib/media/jobs.ts` (grep `\.rpc\(` there) — do not trust the names in this sketch; everything else is exact.

- [ ] **Step 2: Run to verify failure** — `pnpm run test:media-db`. Expected: FAIL (settled at 250000, no `settlement_capped`).

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260706120000_cap_media_settlement.sql`: copy BOTH function definitions of `settle_claimed_media_job` and `record_and_settle_claimed_media_job` verbatim from `20260701122000_claim_aware_media_job_finalization.sql`, then apply exactly these edits (and re-apply the revoke/grant statements for the two functions):

In **`settle_claimed_media_job`**, replace the final `return public.settle_balance_reservation(...)` with:

```sql
  return public.settle_balance_reservation(
    p_job_id,
    least(p_final_cost_usd_micros, coalesce(v_job.reserved_amount_usd_micros, p_final_cost_usd_micros)),
    p_output,
    p_metadata
  );
```

In **`record_and_settle_claimed_media_job`**:

1. Add to the `declare` block: `v_capped_cost_usd_micros bigint;`
2. Immediately AFTER the existing `usage_event_charge_mismatch` check (`if v_charged_amount_usd_micros <> p_final_cost_usd_micros then raise ...`), insert:

```sql
  v_capped_cost_usd_micros := least(
    p_final_cost_usd_micros,
    coalesce(v_job.reserved_amount_usd_micros, p_final_cost_usd_micros)
  );

  if v_capped_cost_usd_micros < p_final_cost_usd_micros then
    v_charged_amount_usd_micros := v_capped_cost_usd_micros;
    v_usage_metadata := v_usage_metadata || jsonb_build_object(
      'settlement_capped', true,
      'uncapped_cost_usd_micros', p_final_cost_usd_micros,
      'overage_usd_micros', p_final_cost_usd_micros - v_capped_cost_usd_micros
    );
  end if;
```

3. Replace the final `return public.settle_balance_reservation(p_job_id, p_final_cost_usd_micros, ...)` with `v_capped_cost_usd_micros` as the second argument.

(The idempotent-retry usage comparison already compares against `v_charged_amount_usd_micros` and `v_usage_metadata`, which now hold the capped values — identical inputs on retry produce identical capped values, so retries still match.)

- [ ] **Step 4: Apply migration + run** — apply to the local DB the same way earlier migrations are applied (see `docs/media-worker-deploy.md` runbook), then `pnpm run test:media-db`. Expected: PASS.

- [ ] **Step 5: Executor warning + unit test**

In `lib/media/executor.ts`, change the settle call (line 188) to capture the returned row and warn on cap:

```ts
  const { data: settledJob, error: settleError } = await admin.rpc(
    "record_and_settle_claimed_media_job",
    {
      p_job_id: job.id,
      p_claim_token: job.claimToken,
      p_final_cost_usd_micros: charge.chargedAmountUsdMicros,
      p_output: outputPayload,
      p_metadata: outputPayload,
      p_usage_event: usageEvent,
    },
  );
```

and after the existing `if (settleError) {...}` block, before `return ... "succeeded"`:

```ts
  const settledFinalCost = isRecord(settledJob)
    ? Number(settledJob.final_cost_usd_micros)
    : Number.NaN;
  if (Number.isFinite(settledFinalCost) && settledFinalCost < charge.chargedAmountUsdMicros) {
    console.warn("media_settlement_capped", {
      jobId: job.id,
      modelId: model.id,
      requestedUsdMicros: charge.chargedAmountUsdMicros,
      settledUsdMicros: settledFinalCost,
      overageUsdMicros: charge.chargedAmountUsdMicros - settledFinalCost,
    });
  }
```

Add a unit test in `tests/media/executor.test.ts` (existing mock harness): make the mocked `record_and_settle_claimed_media_job` return `{ final_cost_usd_micros: <less than charged> }` and assert `console.warn` was called with `"media_settlement_capped"` (spy via `vi.spyOn(console, "warn")`).

- [ ] **Step 6: Run** — `pnpm exec vitest run tests/media/executor.test.ts`. Expected: PASS (and no other executor test broke — the settle mock now needs a `data` shape; update mocks returning `{ error: null }` to `{ data: { final_cost_usd_micros: ... }, error: null }` where needed).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "fix(media): cap settlement at reserved amount"`

---

### Task 2: Lease-fix migration (+ attempt nonce column, progress merge, claim generation)

**Files:**
- Create: `supabase/migrations/20260706121000_media_reconciliation_lease_fix.sql`
- Modify: `lib/media/job-claims.ts` (finder row type + `claimGeneration`)
- Test: `tests/media/db-rpcs.integration.test.ts`

**Interfaces:**
- Produces: `generation_jobs.provider_attempt_nonce text` column (used by Tasks 6–7); `find_media_jobs_for_trigger_reconciliation` returns an extra `claim_generation text` column and no longer matches valid-lease rows; `ReconciliationMediaJob` gains `claimGeneration: string` (used by Task 9).

- [ ] **Step 1: Failing integration test** — add to `tests/media/db-rpcs.integration.test.ts`:

```ts
it("does not return running jobs whose claim lease is still valid", async () => {
  const jobId = await insertMediaJob({
    status: "waiting_provider",
    reserved: 100_000,
    claimToken: crypto.randomUUID(),
    claimExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), // valid lease
    lastProviderPollAt: new Date(Date.now() - 10 * 60_000).toISOString(), // stale poll
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });

  const { data } = await admin.rpc("find_media_jobs_for_trigger_reconciliation", {
    p_limit: 25, p_now: new Date().toISOString(),
  });
  expect((data ?? []).map((row: { id: string }) => row.id)).not.toContain(jobId);
});
```

(Extend `insertMediaJob` with `claimExpiresAt`/`lastProviderPollAt` options if it lacks them — mirror how it sets other columns.)

- [ ] **Step 2: Run** — `pnpm run test:media-db`. Expected: FAIL (row returned because of stale poll timestamp).

- [ ] **Step 3: Write the migration** — `20260706121000_media_reconciliation_lease_fix.sql`:

```sql
alter table public.generation_jobs
  add column if not exists provider_attempt_nonce text;
```

Then copy `find_media_jobs_for_trigger_reconciliation` verbatim from `20260705120000_media_reconciliation_timeouts.sql` and change:

1. Return table becomes `returns table(id uuid, user_id uuid, media_model_id text, media_kind text, claim_generation text)`.
2. The candidates CTE adds a column after `media_kind`:

```sql
      coalesce(jobs.claim_token::text, to_char(p_now, 'YYYYMMDDHH24MISS')) as claim_generation,
```

3. The running/waiting predicate becomes ONLY the lease check (delete both `last_provider_poll_at` clauses):

```sql
        or (
          jobs.status in ('running', 'waiting_provider')
          and (
            jobs.claim_expires_at is null
            or jobs.claim_expires_at < p_now
          )
        )
```

4. Final select adds `candidates.claim_generation`.

Then copy `finalize_expired_media_jobs_for_reconciliation` verbatim and, in the reservation branch (after `select * into v_released from public.release_balance_reservation(...)`), add:

```sql
      update public.generation_jobs jobs
      set progress = coalesce(jobs.progress, '{}'::jsonb) || jsonb_build_object(
            'stage', 'failed',
            'percent', null,
            'message', 'Media job timed out'
          )
      where jobs.id = v_job.id
      returning * into v_released;
```

Because the return signature of the finder changed, `drop function if exists public.find_media_jobs_for_trigger_reconciliation(integer, timestamptz);` before recreating it. Re-apply revoke/grant for both functions.

- [ ] **Step 4: Apply + run** — `pnpm run test:media-db`. Expected: PASS. Also add + run an assertion in the existing expiry test that `progress->>'stage' = 'failed'` for the reserved-branch job.

- [ ] **Step 5: Plumb `claimGeneration`** — in `lib/media/job-claims.ts`: add `claim_generation?: unknown` to `ReconciliationRpcRow`, `claimGeneration: string` to `ReconciliationMediaJob`, and in `findMediaJobsForTriggerReconciliation` map `const claimGeneration = stringValue(row.claim_generation) ?? "unknown";` and include it in the returned object.

- [ ] **Step 6: Run** — `pnpm exec vitest run tests/media/trigger-tasks.test.ts tests/media/trigger-dispatch.test.ts`. Expected: PASS (types only; fix any mock rows to include `claim_generation`).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "fix(db): respect valid leases in media reconciliation"`

---

### Task 3: `gpt_image_sized` quoter

**Files:**
- Modify: `lib/media/pricing-quotes.ts`
- Test: `tests/media/pricing.test.ts`

**Interfaces:**
- Produces: formula type `"gpt_image_sized"` with catalog shape `{ type, size_parameter, quality_parameter, image_parameter, provider_rate_usd_by_quality_and_size: { low|medium|high: { standard|large|max: "<usd string>" } } }`. Exported for tests: `gptImageSizeTier(imageSize: unknown): "standard" | "large" | "max"`.

- [ ] **Step 1: Failing tests** — add to `tests/media/pricing.test.ts` a model fixture with the new formula (mirror how existing fixtures build `MediaModel`; `markupBps: 2000`, `minimumUsdMicros: 10_000`):

```ts
const SIZED_RATES = {
  low: { standard: "0.01", large: "0.01", max: "0.02" },
  medium: { standard: "0.07", large: "0.07", max: "0.13" },
  high: { standard: "0.27", large: "0.28", max: "0.51" },
};

describe("gpt_image_sized", () => {
  it("prices named presets at the standard tier", () => {
    const quote = quoteMediaJob({ model: sizedModel, parameters: { quality: "high", image_size: "landscape_4_3" } });
    expect(quote.providerCostUsdMicros).toBe(270_000);
    expect(quote.chargedAmountUsdMicros).toBe(324_000); // +20% markup
    expect(quote.inputs.size_tier).toBe("standard");
  });
  it("prices auto size at the large tier", () => {
    const quote = quoteMediaJob({ model: sizedModel, parameters: { quality: "high", image_size: "auto" } });
    expect(quote.providerCostUsdMicros).toBe(280_000);
  });
  it("prices custom dimensions by megapixels", () => {
    const quote = quoteMediaJob({ model: sizedModel, parameters: { quality: "medium", image_size: { width: 3840, height: 2160 } } });
    expect(quote.providerCostUsdMicros).toBe(130_000); // 8.29 MP -> max tier
  });
  it("multiplies by num_images and treats auto quality as high", () => {
    const quote = quoteMediaJob({ model: sizedModel, parameters: { quality: "auto", num_images: 3 } });
    expect(quote.providerCostUsdMicros).toBe(3 * 270_000); // default size -> standard
  });
  it("rejects sizes above the priced 4K tier", () => {
    expect(() => quoteMediaJob({ model: sizedModel, parameters: { image_size: { width: 3840, height: 3840 } } }))
      .toThrow("media_quote_unsupported_size");
  });
});
```

- [ ] **Step 2: Run** — `pnpm exec vitest run tests/media/pricing.test.ts`. Expected: FAIL (falls to `static` default case).

- [ ] **Step 3: Implement** in `lib/media/pricing-quotes.ts`:

```ts
const GPT_IMAGE_SIZE_PRESETS_MEGAPIXELS: Record<string, number> = {
  square_hd: 1.05, square: 0.27, portrait_4_3: 0.79,
  portrait_16_9: 0.59, landscape_4_3: 0.79, landscape_16_9: 0.59,
};
const GPT_IMAGE_SIZE_TIERS = [
  { tier: "standard", maxMegapixels: 2.1 },
  { tier: "large", maxMegapixels: 3.7 },
  { tier: "max", maxMegapixels: 8.3 },
] as const;

export function gptImageSizeTier(imageSize: unknown): "standard" | "large" | "max" {
  if (isRecord(imageSize)) {
    const width = positiveNumberValue(imageSize.width);
    const height = positiveNumberValue(imageSize.height);
    if (!width || !height) throw new Error("media_quote_unsupported_size");
    const megapixels = (width * height) / 1_000_000;
    const match = GPT_IMAGE_SIZE_TIERS.find((entry) => megapixels <= entry.maxMegapixels);
    if (!match) throw new Error("media_quote_unsupported_size");
    return match.tier;
  }
  const name = stringValue(imageSize);
  if (!name) return "standard";
  if (name === "auto") return "large";
  if (name in GPT_IMAGE_SIZE_PRESETS_MEGAPIXELS) return "standard";
  throw new Error("media_quote_unsupported_size");
}

function quoteGptImageSizedProviderCost(
  formula: MediaPricingFormula,
  parameters: Record<string, unknown>,
  tier: "standard" | "large" | "max",
) {
  const rates = recordValue(formula.provider_rate_usd_by_quality_and_size);
  const quality = stringParameter(parameters, stringValue(formula.quality_parameter) ?? "quality", "high");
  const normalizedQuality = quality === "auto" ? "high" : quality;
  const numImages = integerParameter(parameters, stringValue(formula.image_parameter) ?? "num_images", 1);
  const tierRates = recordValue(rates?.[normalizedQuality]) ?? recordValue(rates?.high);
  const rate = stringValue(tierRates?.[tier]) ?? stringValue(tierRates?.max) ?? "0";
  return usdToMicrosCeil(rate) * numImages;
}
```

and a new switch case in `quoteMediaJob` (above `gpt_image_conservative`, which stays for already-stored quotes):

```ts
    case "gpt_image_sized": {
      const sizeParameter = stringValue(formula.size_parameter) ?? "image_size";
      const tier = gptImageSizeTier(parameters[sizeParameter]);
      return quoteProviderCost(
        model,
        "conservative_quote",
        "gpt_image_sized",
        quoteGptImageSizedProviderCost(formula, parameters, tier),
        {
          num_images: integerParameter(parameters, stringValue(formula.image_parameter) ?? "num_images", 1),
          quality: stringParameter(parameters, stringValue(formula.quality_parameter) ?? "quality", "high"),
          size_tier: tier,
        },
      );
    }
```

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/media/pricing.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(media): quote gpt image jobs by size tier"`

---

### Task 4: Catalog reseed migration (VERIFY RATES FIRST)

**Files:**
- Create: `supabase/migrations/20260706122000_reseed_gpt_image_sized_rates.sql`
- Test: `tests/media/catalog-seed.test.ts`

**Interfaces:**
- Consumes: `gpt_image_sized` formula shape from Task 3; table `public.model_pricing_rules` (column list in `20260703180000_seed_media_runtime_catalog.sql:1-11`).

- [ ] **Step 1: Re-verify fal pricing in a real browser** — use the `browser-fetch` skill on `https://fal.ai/models/openai/gpt-image-2` and confirm the digest's table (low/medium/high × sizes up to 3840×2160, max $0.401 high/4K). If rates differ, STOP and update the digest + Task 3 rate table + this migration before proceeding, and note it in the task report.

- [ ] **Step 2: Failing test** — extend `tests/media/catalog-seed.test.ts` (it parses the seed SQL): assert the migration file `20260706122000_reseed_gpt_image_sized_rates.sql` exists, updates both `openai/gpt-image-2` and `openai/gpt-image-2/edit`, sets `pricing_formula.type` to `"gpt_image_sized"`, includes `provider_rate_usd_by_quality_and_size` with the exact 9 rates from Task 3's `SIZED_RATES`, and sets `minimum_charge_usd_micros = 10000`.

- [ ] **Step 3: Write the migration**

```sql
update public.model_pricing_rules
set minimum_charge_usd_micros = 10000,
    metadata = jsonb_set(
      metadata,
      '{pricing_formula}',
      $${
        "type": "gpt_image_sized",
        "size_parameter": "image_size",
        "quality_parameter": "quality",
        "image_parameter": "num_images",
        "provider_rate_usd_by_quality_and_size": {
          "low":    {"standard": "0.01", "large": "0.01", "max": "0.02"},
          "medium": {"standard": "0.07", "large": "0.07", "max": "0.13"},
          "high":   {"standard": "0.27", "large": "0.28", "max": "0.51"}
        }
      }$$::jsonb
    )
where provider = 'fal'
  and model in ('openai/gpt-image-2', 'openai/gpt-image-2/edit')
  and operation = 'image_generation';
```

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/media/catalog-seed.test.ts`, apply migration locally, and if the DB suite is available run `pnpm run test:media-db`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(db): reseed gpt image sized pricing"`

---

### Task 5: Pricing page rates + music copy

**Files:**
- Modify: `lib/pricing-page-rates.ts:77-85` (GPT Image 2 row), `lib/pricing-page-rates.ts:177-183` (music row)
- Test: `tests/pricing-page-rates.test.ts`, `tests/media/pricing.test.ts` (music), `tests/pricing-page-source.test.ts`

- [ ] **Step 1: Failing tests** — in `tests/pricing-page-rates.test.ts`, assert the GPT Image 2 entry's `rate` is `"From $0.02/image"` and `notes` is `"Varies by quality and size · High quality: $0.33 (standard) – $0.62 (4K)"`; assert the Eleven Music v2 `notes` is `"$0.20 minimum. Up to 10 minutes."`. ($0.02 = low/standard $0.01 × 1.2 markup ceil-to-cent; $0.33 = 0.27 × 1.2; $0.62 = 0.51 × 1.2.)
- [ ] **Step 2: Run** — `pnpm exec vitest run tests/pricing-page-rates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — replace the GPT Image 2 entry:

```ts
  {
    name: "GPT Image 2",
    capability: "Image generation and editing",
    modelIds: ["openai/gpt-image-2", "openai/gpt-image-2/edit"],
    rate: "From $0.02/image",
    notes: "Varies by quality and size · High quality: $0.33 (standard) – $0.62 (4K)",
  },
```

and the music note: `notes: "$0.20 minimum. Up to 10 minutes."`.

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/pricing-page-rates.test.ts tests/pricing-page-source.test.ts tests/media/pricing.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(pricing): show sized gpt image rates and 10 minute music cap"`

---

### Task 6: fal adapter — webhook URL arg, status mapping, ApiError handling

**Files:**
- Modify: `lib/media/provider.ts` (run args), `lib/media/providers/fal.ts`, `lib/media/providers/elevenlabs.ts` (accept+ignore new arg)
- Test: `tests/media/provider-adapters.test.ts`

**Interfaces:**
- Produces: `MediaProviderAdapter.run` input gains `webhookUrl?: string | null`. fal adapter: submits with exactly that URL (no longer builds it from env); poll maps `IN_QUEUE`/`IN_PROGRESS` → `waiting_provider`, `COMPLETED` → result fetch, **any other/unknown status** → `provider_failed` with `fal_status` metadata; `ApiError` from `fal.queue.result` → `provider_failed` with `provider_status`/`provider_error_message` metadata (executor's `safeMetadata` already whitelists these keys).

- [ ] **Step 1: Failing tests** — in `tests/media/provider-adapters.test.ts` (existing fal mocks):

```ts
it("submits with the webhook url passed by the executor", async () => {
  await falMediaAdapter.run({ model, parameters: {}, inputUrls: [], providerJobId: null,
    webhookUrl: "https://www.woven.video/api/v1/media/webhooks/fal/job-1/nonce-1" });
  expect(queueSubmitMock).toHaveBeenCalledWith(model.providerEndpoint,
    expect.objectContaining({ webhookUrl: "https://www.woven.video/api/v1/media/webhooks/fal/job-1/nonce-1" }));
});
it("fails on unknown queue status instead of waiting forever", async () => {
  queueStatusMock.mockResolvedValue({ status: "CANCELLATION_REQUESTED" });
  const result = await falMediaAdapter.run({ model, parameters: {}, inputUrls: [], providerJobId: "req-1" });
  expect(result.status).toBe("provider_failed");
});
it("maps an ApiError result fetch to provider_failed", async () => {
  queueStatusMock.mockResolvedValue({ status: "COMPLETED" });
  const apiError = Object.assign(new Error("Unprocessable Entity"), { name: "ApiError", status: 422, body: {} });
  queueResultMock.mockRejectedValue(apiError);
  const result = await falMediaAdapter.run({ model, parameters: {}, inputUrls: [], providerJobId: "req-1" });
  expect(result.status).toBe("provider_failed");
  expect(result.metadata?.provider_status).toBe(422);
});
```

- [ ] **Step 2: Run** — `pnpm exec vitest run tests/media/provider-adapters.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — in `provider.ts` add `webhookUrl?: string | null;` to the `run` input type. In `fal.ts`:
  - Replace the env-derived webhook block (lines 46-49) with `if (webhookUrl) { submitOptions.webhookUrl = webhookUrl; }` (add `webhookUrl` to the destructured run args; delete the now-unused `getMediaEnv` import).
  - Replace the poll mapping (lines 68-80) with:

```ts
    const statusText = stringValue((status as unknown as Record<string, unknown>).status) ?? "";
    if (statusText === "IN_QUEUE" || statusText === "IN_PROGRESS") {
      return {
        status: "waiting_provider",
        providerJobId,
        metadata: { endpoint, fal_request_id: providerJobId, fal_status: statusText },
      };
    }
    if (statusText !== "COMPLETED") {
      return {
        status: "provider_failed",
        metadata: { endpoint, fal_request_id: providerJobId, fal_status: statusText || "unknown" },
      };
    }
```

  - Wrap the `fal.queue.result` call in try/catch:

```ts
    let result: unknown;
    try {
      result = await fal.queue.result(endpoint, { requestId: providerJobId, abortSignal: signal });
    } catch (error) {
      if (isRecord(error) && (error.name === "ApiError" || error.name === "ValidationError")) {
        return {
          status: "provider_failed",
          metadata: {
            endpoint,
            fal_request_id: providerJobId,
            provider_status: typeof error.status === "number" ? error.status : undefined,
            provider_error_message: error instanceof Error ? error.message.slice(0, 500) : undefined,
          },
        };
      }
      throw error;
    }
```

  - In `elevenlabs.ts` no change needed beyond the widened type (it destructures only what it uses).

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/media/provider-adapters.test.ts`. Expected: PASS (update any existing test that relied on env-built webhook URLs or `/completed|succeeded/i` matching).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(media): detect fal terminal failures explicitly"`

---

### Task 7: Executor — attempt nonce, persist retries, provider_not_configured release, webhook-error fast fail

**Files:**
- Modify: `lib/media/executor.ts`
- Test: `tests/media/executor.test.ts`

**Interfaces:**
- Consumes: `provider_attempt_nonce` column (Task 2), `webhookUrl` run arg (Task 6).
- Produces: submit flow per spec §2a. Exported for tests: none new — behavior via `processMediaJob`.

- [ ] **Step 1: Failing tests** — add to `tests/media/executor.test.ts` (existing harness; mock `admin.from("generation_jobs")` chains as the file already does):

```ts
it("persists an attempt nonce and passes a hinted webhook url before submitting", async () => { /* assert update({ provider_attempt_nonce }) matched .eq("claim_token") and .is("provider_job_id", null) happened BEFORE adapter.run; assert adapter.run received webhookUrl matching /\/api\/v1\/media\/webhooks\/fal\/<jobId>\/<nonce>$/ */ });
it("does not resubmit when a nonce exists without a provider job id", async () => { /* select returns provider_attempt_nonce set, provider_job_id null -> adapter.run NOT called; job marked waiting via mark_media_job_waiting_provider with p_provider_job_id null */ });
it("returns waiting_provider when persisting the provider job id keeps failing", async () => { /* mark_media_job_waiting_provider rpc fails 3x with non-stale error -> result status waiting_provider, no throw */ });
it("releases the claim when the provider is not configured", async () => { /* adapter.run rejects with Error("provider_not_configured") -> release_claimed_media_job called with p_error "provider_not_configured" */ });
it("fails fast when the webhook recorded a provider error", async () => { /* providerJobId set + progress.stage === "provider_webhook_error" -> release with provider_failed, adapter.run NOT called */ });
```

Write each body fully against the file's harness. **Delete/invert** the existing test pinning "without releasing the reservation" for provider_not_configured (`tests/media/executor.test.ts:~924`).

- [ ] **Step 2: Run** — `pnpm exec vitest run tests/media/executor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `lib/media/executor.ts` inside `processMediaJobStep`, replacing the block from `const result = await runProviderAdapter({...})` through the `waiting_provider` handling:

```ts
  let webhookUrl: string | null = null;
  if (!job.providerJobId) {
    const attempt = await readProviderAttempt(admin, job.id);
    if (attempt.nonce) {
      // A submission may already exist; wait for the webhook self-heal or deadline.
      const updated = await markWaitingProvider(admin, job, null);
      return { jobId: job.id, status: updated ? "waiting_provider" : "stale_claim" };
    }
    const nonce = crypto.randomUUID();
    const persisted = await persistProviderAttemptNonce(admin, job, nonce);
    if (!persisted) {
      return { jobId: job.id, status: "stale_claim" };
    }
    const baseUrl = getMediaEnv().falWebhookBaseUrl;
    webhookUrl = baseUrl
      ? `${baseUrl}/api/v1/media/webhooks/fal/${job.id}/${nonce}`
      : null;
  } else {
    const attempt = await readProviderAttempt(admin, job.id);
    if (attempt.progressStage === "provider_webhook_error") {
      const status = await releaseJob(admin, job, "provider_failed", {
        provider_error_message: attempt.progressMessage ?? "provider_webhook_error",
      });
      return { jobId: job.id, status };
    }
  }

  let result;
  try {
    result = await runProviderAdapter({
      adapter, model,
      parameters: objectValue(job.input.parameters),
      inputUrls: signedInputs.inputUrls,
      inputAssets: signedInputs.inputAssets,
      providerJobId: job.providerJobId,
      webhookUrl,
      signal,
    });
  } catch (error) {
    if (isProviderNotConfiguredError(error)) {
      const status = await releaseJob(admin, job, "provider_not_configured");
      return { jobId: job.id, status };
    }
    throw error;
  }

  if (result.status === "provider_failed") { /* unchanged */ }

  if (result.status === "waiting_provider") {
    const updated = await markWaitingProviderWithRetry(admin, job, result.providerJobId);
    return { jobId: job.id, status: updated === "stale" ? "stale_claim" : "waiting_provider" };
  }
```

with these new helpers (and pass `webhookUrl` through `runProviderAdapter`'s args and `adapter.run`):

```ts
async function readProviderAttempt(admin: SupabaseAdminClient, jobId: string) {
  const { data, error } = await admin
    .from("generation_jobs")
    .select("provider_attempt_nonce, progress")
    .eq("id", jobId)
    .single();
  if (error) throw new Error(error.message);
  const progress = objectValue(data?.progress);
  return {
    nonce: stringValue(data?.provider_attempt_nonce),
    progressStage: stringValue(progress.stage),
    progressMessage: stringValue(progress.message),
  };
}

async function persistProviderAttemptNonce(
  admin: SupabaseAdminClient,
  job: { id: string; claimToken: string | null },
  nonce: string,
) {
  if (!job.claimToken) return false;
  const { data, error } = await admin
    .from("generation_jobs")
    .update({ provider_attempt_nonce: nonce })
    .eq("id", job.id)
    .eq("claim_token", job.claimToken)
    .is("provider_job_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

async function markWaitingProvider(
  admin: SupabaseAdminClient,
  job: { id: string; claimToken: string | null },
  providerJobId: string | null,
) {
  return updateWaitingProviderJob({ admin, jobId: job.id, claimToken: job.claimToken, providerJobId });
}

async function markWaitingProviderWithRetry(
  admin: SupabaseAdminClient,
  job: { id: string; claimToken: string | null },
  providerJobId: string,
): Promise<"updated" | "stale" | "unpersisted"> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const updated = await markWaitingProvider(admin, job, providerJobId);
      return updated ? "updated" : "stale";
    } catch (error) {
      if (attempt === 2) {
        console.error("media_provider_job_id_persist_failed", {
          jobId: job.id, providerJobId,
          message: error instanceof Error ? error.message : String(error),
        });
        return "unpersisted"; // webhook self-heal or deadline resolves it
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return "unpersisted";
}
```

`updateWaitingProviderJob`'s `providerJobId` parameter type widens to `string | null`. Map `"unpersisted"` to returning `waiting_provider` at the call site (shown above via `!== "stale"`).

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/media/executor.test.ts`. Expected: PASS (existing tests will need the new `readProviderAttempt` select mocked; extend the harness's `generation_jobs` mock accordingly).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(media): make fal submission durable via attempt nonce"`

---

### Task 8: Webhook route — path hints, self-heal, ERROR recording

**Files:**
- Move: `app/api/v1/media/webhooks/fal/route.ts` → `app/api/v1/media/webhooks/fal/[[...hint]]/route.ts` (`git mv`)
- Test: `tests/media/fal-webhook-route.test.ts`

**Interfaces:**
- Consumes: `provider_attempt_nonce` (Task 2). Route context becomes `{ params: Promise<{ hint?: string[] }> }`.
- Produces: self-heal adoption + `provider_webhook_error` progress stage consumed by Task 7.

- [ ] **Step 1: Failing tests** — add to `tests/media/fal-webhook-route.test.ts` (existing harness mocks verification + admin):

```ts
it("adopts the request id when the job is found by path hint and nonce", async () => { /* provider_job_id lookup misses; select by id+nonce+null provider_job_id returns job; assert update set provider_job_id = request_id and dispatch called with source "webhook" */ });
it("ignores a hint with a wrong nonce", async () => { /* hint lookup returns nothing -> 200 ok, no update/dispatch */ });
it("records provider_webhook_error progress on ERROR payloads", async () => { /* payload status "ERROR", error "Invalid status code: 422" -> progress update contains stage "provider_webhook_error" and the message; dispatch still called */ });
```

Route invocations in tests pass `{ params: Promise.resolve({ hint: ["<jobId>", "<nonce>"] }) }` as the second handler argument.

- [ ] **Step 2: Run** — `pnpm exec vitest run tests/media/fal-webhook-route.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — `git mv 'app/api/v1/media/webhooks/fal/route.ts' 'app/api/v1/media/webhooks/fal/[[...hint]]/route.ts'`, then edit:

```ts
type RouteContext = { params: Promise<{ hint?: string[] }> };

export async function POST(request: Request, context: RouteContext) {
  // ... signature verification and payload parsing unchanged ...

  const { hint } = await context.params;
  const [hintJobId, hintNonce] = hint ?? [];
  const admin = createSupabaseAdminClient();

  // Self-heal: adopt the request id if the primary mapping is missing.
  const { data: mapped } = await admin
    .from("generation_jobs")
    .select("id")
    .eq("provider_job_id", requestId)
    .eq("provider", "fal")
    .eq("type", "media_job")
    .maybeSingle();

  if (!mapped?.id && hintJobId && hintNonce) {
    const { error: adoptError } = await admin
      .from("generation_jobs")
      .update({ provider_job_id: requestId })
      .eq("id", hintJobId)
      .eq("provider_attempt_nonce", hintNonce)
      .eq("provider", "fal")
      .eq("type", "media_job")
      .is("provider_job_id", null)
      .in("status", ["running", "waiting_provider"]);
    if (adoptError) {
      console.error("Failed to adopt Fal request id from webhook hint", adoptError);
      return apiError("Unable to update media job webhook state.", 500, "provider_failed");
    }
  }

  const isProviderError = payload.status === "ERROR";
  const progress = isProviderError
    ? {
        stage: "provider_webhook_error",
        percent: null,
        message: typeof payload.error === "string" ? payload.error.slice(0, 500) : "Provider reported an error",
      }
    : {
        stage: "provider_webhook_received",
        percent: null,
        message: "Provider callback received",
      };

  // existing update block, with `progress` from above and status filter widened:
  //   .in("status", ["running", "waiting_provider"])
  // existing job select + dispatch block unchanged apart from the same
  //   .in("status", ["running", "waiting_provider"]) filter.
}
```

(The status filter widens from `.eq("status", "waiting_provider")` to `.in("status", ["running", "waiting_provider"])` in both the update and the follow-up select, because a self-healed job may still be `running`.)

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/media/fal-webhook-route.test.ts`. Expected: PASS (existing tests: update import paths if they import the route file by path).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(media): self-heal fal webhook job mapping"`

---

### Task 9: Per-wake Trigger idempotency keys

**Files:**
- Modify: `lib/media/trigger-dispatch.ts`, `app/api/v1/media/webhooks/fal/[[...hint]]/route.ts` (pass requestId), `trigger/media.ts` (pass claimGeneration)
- Test: `tests/media/trigger-dispatch.test.ts`, `tests/media/trigger-tasks.test.ts`

**Interfaces:**
- Consumes: `ReconciliationMediaJob.claimGeneration` (Task 2).
- Produces: `DispatchMediaJobPayload` gains `idempotencyDiscriminator?: string`. Keys: `create:<jobId>` / `webhook:<jobId>:<disc>` / `reconcile:<jobId>:<disc>`; all triggers set `idempotencyKeyTTL: "1h"`.

- [ ] **Step 1: Failing tests** — in `tests/media/trigger-dispatch.test.ts`:

```ts
it.each([
  ["create", undefined, "create:job-1"],
  ["webhook", "req-9", "webhook:job-1:req-9"],
  ["reconcile", "claim-token-3", "reconcile:job-1:claim-token-3"],
])("builds a per-wake idempotency key for %s", async (source, disc, expected) => {
  await dispatchMediaJob({ jobId: "job-1", userId: "u1", modelId: "m", kind: "image",
    source: source as MediaDispatchSource, idempotencyDiscriminator: disc });
  expect(triggerMock).toHaveBeenCalledWith("process-media-job", { jobId: "job-1" },
    expect.objectContaining({ idempotencyKey: expected, idempotencyKeyTTL: "1h" }));
});
```

- [ ] **Step 2: Run** — `pnpm exec vitest run tests/media/trigger-dispatch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — in `trigger-dispatch.ts`:

```ts
export function mediaDispatchIdempotencyKey(
  source: MediaDispatchSource,
  jobId: string,
  discriminator?: string,
) {
  if (source === "create") return `create:${jobId}`;
  return `${source}:${jobId}:${discriminator ?? "unknown"}`;
}
```

`DispatchMediaJobPayload` gains `idempotencyDiscriminator?: string`; `dispatchMediaJob` computes `const idempotencyKey = mediaDispatchIdempotencyKey(source, jobId, idempotencyDiscriminator);` and passes `{ idempotencyKey, idempotencyKeyTTL: "1h", ... }` to `tasks.trigger` and the same key to `recordMediaJobTriggerDispatch`. Callers: webhook route adds `idempotencyDiscriminator: requestId`; in `trigger/media.ts`, the reconciliation loop (it maps `findMediaJobsForTriggerReconciliation()` rows into `dispatchMediaJob` calls with `source: "reconcile"`) adds `idempotencyDiscriminator: job.claimGeneration`.

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/media/trigger-dispatch.test.ts tests/media/trigger-tasks.test.ts tests/media/fal-webhook-route.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(media): scope trigger idempotency keys per wake"`

---

### Task 10: SSRF output-fetch allowlist

**Files:**
- Create: `lib/media/output-fetch.ts`
- Modify: `lib/media/provider.ts` (adapter allowlist field), `lib/media/providers/fal.ts`, `lib/media/providers/elevenlabs.ts`, `lib/media/output-assets.ts` (use helper; plumb allowlist), `lib/media/executor.ts` (pass `adapter.outputUrlAllowlist` into `createOutputAssetRows`)
- Test: `tests/media/output-fetch.test.ts` (new), `tests/media/output-assets.test.ts`

**Interfaces:**
- Produces:

```ts
// lib/media/output-fetch.ts
export function isAllowedOutputHost(hostname: string, allowlist: string[]): boolean;
export async function fetchProviderOutput(options: {
  url: string;
  allowlist: string[];
  expectedType: "image" | "video" | "audio" | "json";
  maxBytes: number;
  timeoutMs?: number; // default 120_000
}): Promise<{ bytes: Buffer; contentType: string | null }>;
```

- `MediaProviderAdapter` gains `outputUrlAllowlist: string[]` (fal: `["fal.media", "*.fal.media"]`; elevenlabs: `[]`). `createOutputAssetRows` gains required `outputUrlAllowlist: string[]`.

- [ ] **Step 1: Failing tests** — create `tests/media/output-fetch.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchProviderOutput, isAllowedOutputHost } from "@/lib/media/output-fetch";

describe("isAllowedOutputHost", () => {
  it.each([
    ["v3b.fal.media", true], ["fal.media", true], ["a.b.fal.media", true],
    ["evil.com", false], ["fal.media.evil.com", false], ["notfal.media", false],
    ["localhost", false], ["169.254.169.254", false],
  ])("%s -> %s", (host, expected) => {
    expect(isAllowedOutputHost(host, ["fal.media", "*.fal.media"])).toBe(expected);
  });
});

describe("fetchProviderOutput", () => {
  afterEach(() => vi.unstubAllGlobals());
  const base = { allowlist: ["fal.media", "*.fal.media"], expectedType: "image" as const, maxBytes: 1024 };

  it("rejects http urls", async () => {
    await expect(fetchProviderOutput({ ...base, url: "http://v3b.fal.media/f.png" }))
      .rejects.toThrow("media_output_url_not_allowed");
  });
  it("rejects hosts outside the allowlist", async () => {
    await expect(fetchProviderOutput({ ...base, url: "https://evil.com/f.png" }))
      .rejects.toThrow("media_output_url_not_allowed");
  });
  it("rejects mismatched content types", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", {
      status: 200, headers: { "content-type": "text/html" } })));
    await expect(fetchProviderOutput({ ...base, url: "https://v3b.fal.media/f.png" }))
      .rejects.toThrow("media_output_content_type_mismatch");
  });
  it("passes redirect: error and a timeout signal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from("img"), {
      status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchProviderOutput({ ...base, url: "https://v3b.fal.media/f.png" });
    expect(result.bytes.toString()).toBe("img");
    const init = fetchMock.mock.calls[0][1];
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("enforces the byte cap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.alloc(2048), {
      status: 200, headers: { "content-type": "image/png" } })));
    await expect(fetchProviderOutput({ ...base, url: "https://v3b.fal.media/f.png" }))
      .rejects.toThrow("media_output_too_large");
  });
});
```

- [ ] **Step 2: Run** — `pnpm exec vitest run tests/media/output-fetch.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `lib/media/output-fetch.ts`:

```ts
const EXPECTED_CONTENT_TYPE_PREFIX = {
  image: "image/", video: "video/", audio: "audio/", json: "application/json",
} as const;

export function isAllowedOutputHost(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((entry) => {
    const pattern = entry.toLowerCase();
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".fal.media"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
  });
}

export async function fetchProviderOutput({
  url, allowlist, expectedType, maxBytes, timeoutMs = 120_000,
}: {
  url: string;
  allowlist: string[];
  expectedType: keyof typeof EXPECTED_CONTENT_TYPE_PREFIX;
  maxBytes: number;
  timeoutMs?: number;
}): Promise<{ bytes: Buffer; contentType: string | null }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("media_output_url_not_allowed");
  }
  if (parsed.protocol !== "https:" || !isAllowedOutputHost(parsed.hostname, allowlist)) {
    throw new Error("media_output_url_not_allowed");
  }

  let response: Response;
  try {
    response = await fetch(parsed, {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("media_output_download_timeout");
    }
    throw new Error("media_output_url_not_allowed"); // redirect or network refusal
  }
  if (!response.ok) {
    throw new Error(`provider_output_download_failed:${response.status}`);
  }

  const contentType = response.headers.get("content-type");
  const prefix = EXPECTED_CONTENT_TYPE_PREFIX[expectedType];
  if (!contentType || !contentType.toLowerCase().startsWith(prefix)) {
    throw new Error("media_output_content_type_mismatch");
  }

  const bytes = await readResponseBytes(response, maxBytes);
  return { bytes, contentType };
}
```

Move `readResponseBytes` (and its byte-cap error) from `output-assets.ts` into this module and export it (or re-import). In `output-assets.ts`, `readProviderOutput(output, maxBytes)` becomes `readProviderOutput(output, maxBytes, allowlist)` and the remote branch becomes:

```ts
  const { bytes } = await fetchProviderOutput({
    url: output.url,
    allowlist,
    expectedType: output.type,
    maxBytes,
  });
  return bytes;
```

Plumb `outputUrlAllowlist: string[]` through `createOutputAssetRows` (required option) to the `readProviderOutput` call at `output-assets.ts:175`. In `provider.ts` add `outputUrlAllowlist: string[];` to `MediaProviderAdapter`; set `["fal.media", "*.fal.media"]` on `falMediaAdapter` and `[]` on `elevenLabsMediaAdapter`. In `executor.ts` pass `outputUrlAllowlist: adapter.outputUrlAllowlist` in the `createOutputAssetRows` call. `data:` URL and `output.data` branches stay exactly as they are.

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/media/output-fetch.test.ts tests/media/output-assets.test.ts tests/media/executor.test.ts`. Expected: PASS (existing output-assets tests must now pass an allowlist — use `["fal.media", "*.fal.media"]` and rewrite any fixture URLs to `https://v3b.fal.media/...`).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(media): allowlist provider output downloads"`

---

### Task 11: Caption route type fences

**Files:**
- Modify: `app/api/v1/reel-captions/jobs/[jobId]/route.ts`, `app/api/v1/reel-captions/jobs/[jobId]/process/route.ts:234-279`
- Test: `tests/reel-captions/routes.test.ts`

- [ ] **Step 1: Failing tests** — in `tests/reel-captions/routes.test.ts`, add: GET status with a row whose lookup now filters `type` (mock returns null for a media job id) → expect 404 `caption_job_not_found`; process route `loadJob`/`claimQueuedJob` queries assert `.eq("type", "reel_captions")` was applied (the harness records filter calls).
- [ ] **Step 2: Run** — `pnpm exec vitest run tests/reel-captions/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — status route: `import { REEL_CAPTION_JOB_TYPE } from "@/lib/reel-captions/pricing";` and add `.eq("type", REEL_CAPTION_JOB_TYPE)` to the select chain. Process route: add the same `.eq("type", REEL_CAPTION_JOB_TYPE)` to both the `loadJob` select chain and the `claimQueuedJob` update chain.
- [ ] **Step 4: Run** — `pnpm exec vitest run tests/reel-captions/routes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(captions): fence caption routes by job type"`

---

### Task 12: Env gates — manual-mode prod rejection + private-range check

**Files:**
- Modify: `lib/media/env.ts`, `.env.example:37,60`
- Test: `tests/media/env.test.ts`

- [ ] **Step 1: Failing tests** — in `tests/media/env.test.ts` (it already stubs env vars):

```ts
it("rejects manual completion mode in production", () => {
  process.env.MEDIA_UPLOAD_COMPLETION_MODE = "manual";
  process.env.VERCEL_ENV = "production";
  expect(() => getMediaEnv()).toThrow("MEDIA_UPLOAD_COMPLETION_MODE");
});
it("allows manual completion mode in preview/dev", () => {
  process.env.MEDIA_UPLOAD_COMPLETION_MODE = "manual";
  process.env.VERCEL_ENV = "preview";
  expect(getMediaEnv().uploadCompletionMode).toBe("manual");
});
it.each([
  ["http://10.0.0.5", true], ["http://192.168.1.1:8787", true], ["http://172.20.3.4", true],
  ["http://169.254.169.254", true], ["http://[fe80::1]", true], ["http://[fd00::1]", true],
  ["http://[::ffff:127.0.0.1]", true], ["https://media.woven.video", false], ["http://172.32.0.1", false],
])("isLoopbackMediaBaseUrl(%s) === %s", (url, expected) => {
  expect(isLoopbackMediaBaseUrl(url)).toBe(expected);
});
```

- [ ] **Step 2: Run** — `pnpm exec vitest run tests/media/env.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `lib/media/env.ts`:

```ts
function isProductionMediaEnvironment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv) return vercelEnv === "production";
  return process.env.NODE_ENV === "production";
}

function uploadCompletionModeEnv(): MediaUploadCompletionMode {
  const raw = process.env.MEDIA_UPLOAD_COMPLETION_MODE?.trim() || "callback";
  if (raw !== "callback" && raw !== "manual") {
    throw new Error("MEDIA_UPLOAD_COMPLETION_MODE must be callback or manual.");
  }
  if (raw === "manual" && isProductionMediaEnvironment()) {
    throw new Error("MEDIA_UPLOAD_COMPLETION_MODE=manual is not allowed in production.");
  }
  return raw;
}
```

and extend `isLoopbackMediaBaseUrl` (same exported name — callers unchanged):

```ts
export function isLoopbackMediaBaseUrl(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 127 || a === 0 || a === 10 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (hostname.includes(":")) {
    if (hostname === "::" || hostname === "::1") return true;
    if (hostname.startsWith("fe8") || hostname.startsWith("fe9") ||
        hostname.startsWith("fea") || hostname.startsWith("feb")) return true; // fe80::/10
    if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true; // fc00::/7
    // WHATWG URL serializes IPv4-mapped addresses in hex form
    // ("[::ffff:127.0.0.1]" becomes "::ffff:7f00:1"), so treat ANY
    // IPv4-mapped literal as private — no legitimate operator config uses one.
    if (hostname.startsWith("::ffff:")) return true;
  }

  return false;
}
```

Update `.env.example` line 37 comment and line 60 to note: `# manual is dev/smoke only — getMediaEnv() rejects it when VERCEL_ENV/NODE_ENV is production`.

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/media/env.test.ts tests/media/job-routes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(media): gate manual completion and private hosts"`

---

### Task 13: Timing-safe secret comparison

**Files:**
- Create: `lib/security/timing-safe-equal.ts`
- Modify: `app/api/internal/media/uploads/complete/route.ts:13-16`, `app/api/internal/media/cleanup/route.ts:19-42`
- Test: `tests/security/timing-safe-equal.test.ts` (new), `tests/media/cleanup-route.test.ts`

- [ ] **Step 1: Failing test** — `tests/security/timing-safe-equal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { timingSafeEqualStrings } from "@/lib/security/timing-safe-equal";

describe("timingSafeEqualStrings", () => {
  it("matches equal strings", () => expect(timingSafeEqualStrings("abc", "abc")).toBe(true));
  it("rejects different strings", () => expect(timingSafeEqualStrings("abc", "abd")).toBe(false));
  it("rejects different lengths without throwing", () => expect(timingSafeEqualStrings("abc", "abcdef")).toBe(false));
  it("rejects empty vs non-empty", () => expect(timingSafeEqualStrings("", "abc")).toBe(false));
});
```

- [ ] **Step 2: Run** — `pnpm exec vitest run tests/security/timing-safe-equal.test.ts`. Expected: FAIL (module missing). If `tests/security/` is not matched by `vitest.config.ts` includes, add it there in this step.
- [ ] **Step 3: Implement**:

```ts
// lib/security/timing-safe-equal.ts
import { createHash, timingSafeEqual } from "node:crypto";

// Hashing both inputs first makes unequal lengths safe to compare.
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
```

Replace the three comparisons:

```ts
// app/api/internal/media/uploads/complete/route.ts
if (!timingSafeEqualStrings(secret ?? "", getMediaEnv().workerSharedSecret)) {

// app/api/internal/media/cleanup/route.ts (GET)
if (!cronSecret || !timingSafeEqualStrings(authHeader ?? "", `Bearer ${cronSecret}`)) {

// app/api/internal/media/cleanup/route.ts (POST)
if (!timingSafeEqualStrings(request.headers.get("x-woven-media-worker-secret") ?? "", workerSharedSecret)) {
```

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/security/timing-safe-equal.test.ts tests/media/cleanup-route.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(media): compare internal secrets in constant time"`

---

### Task 14: Expired-input rejection

**Files:**
- Modify: `lib/media/jobs.ts` (validation select ~line 254; attach update ~line 345), `app/api/v1/media/jobs/route.ts:137-141` (error mapping)
- Test: `tests/media/jobs.test.ts`, `tests/media/job-routes.test.ts`

- [ ] **Step 1: Failing tests** — in `tests/media/jobs.test.ts`: creating a job with an input asset whose `upload_expires_at` is in the past throws `upload_expired`; one whose `kind` is `"output"` throws `invalid_media_input`. In `tests/media/job-routes.test.ts`: the route maps `upload_expired` to HTTP 400 with code `upload_expired`.
- [ ] **Step 2: Run** — `pnpm exec vitest run tests/media/jobs.test.ts tests/media/job-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — in the validation function (`lib/media/jobs.ts` ~254): select becomes `"id, status, content_type, kind, upload_expires_at"`; extend `MediaAssetInputRow` with `kind: string; upload_expires_at: string | null;` and the status loop becomes:

```ts
  const nowMs = Date.now();
  for (const inputAsset of assetRows) {
    if (inputAsset.kind !== "input") {
      throw new Error("invalid_media_input");
    }
    if (inputAsset.status !== "uploaded") {
      throw new Error("upload_not_complete");
    }
    const expiresAtMs = inputAsset.upload_expires_at ? Date.parse(inputAsset.upload_expires_at) : Number.NaN;
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
      throw new Error("upload_expired");
    }
  }
```

In the attach update (~line 345) add to the chain: `.eq("kind", "input").or(`upload_expires_at.is.null,upload_expires_at.gt.${new Date().toISOString()}`)`. In the jobs route error mapping add before the `invalid_media_input` case:

```ts
    if (message === "upload_expired") {
      return apiError("Upload has expired.", 400, "upload_expired");
    }
```

- [ ] **Step 4: Run** — `pnpm exec vitest run tests/media/jobs.test.ts tests/media/job-routes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(media): reject expired uploaded inputs"`

---

### Task 15: Cleanups + full verification

**Files:**
- Modify: `package.json` (pin versions, scripts), `scripts/trigger-dev.mjs:14-16`, `docs/billing-architecture.md:64`
- Delete: `.superpowers/sdd/task-4-report.md`, `.superpowers/sdd/task-5-report.md`

- [ ] **Step 1: Pin Trigger.dev** — in `package.json`: change `"@trigger.dev/sdk": "^4.5.0"` → `"4.5.0"`; add to `devDependencies`: `"trigger.dev": "4.5.0"`; change script `"trigger:deploy": "pnpm exec trigger.dev deploy"`. In `scripts/trigger-dev.mjs` replace the spawn args:

```js
const child = spawn("pnpm", [
  "exec",
  "trigger.dev",
  "dev",
  "start",
  "--project-ref",
  triggerProjectRef,
  "--env-file",
  envFile,
  "--skip-update-check",
], {
```

Run `pnpm install` and confirm `pnpm exec trigger.dev --version` prints `4.5.0`.

- [ ] **Step 2: Remove tracked scratch artifacts** — `git rm .superpowers/sdd/task-4-report.md .superpowers/sdd/task-5-report.md` (path is gitignored; earlier branch commits removed identical files).

- [ ] **Step 3: Fix billing docs** — replace the stale sentence at `docs/billing-architecture.md:64` ("The `generated-media` storage bucket is private...") with:

```markdown
Hosted media inputs and outputs live in Cloudflare R2 behind the media worker
(`media.woven.video`). Download URLs are short-lived signed links minted on
status reads; retention is enforced by the media cleanup job.
```

- [ ] **Step 4: Full suite** — `pnpm test` (expect: all pass) and, if a local Supabase is available, `pnpm run test:media-db`. Also `pnpm lint`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore(media): pin trigger cli and clean review leftovers"`

---

## Final acceptance checklist (run after Task 15)

- [ ] `pnpm test` green; `pnpm run test:media-db` green (or explicitly reported unavailable).
- [ ] Every finding in the spec's finding→fix map has a commit implementing it.
- [ ] fal pricing table was browser-verified in Task 4 Step 1 (rates confirmed or corrected).
- [ ] No task introduced an env escape hatch for the SSRF allowlist or the manual-mode gate.
