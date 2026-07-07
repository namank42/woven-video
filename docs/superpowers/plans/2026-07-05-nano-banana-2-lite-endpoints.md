# Nano Banana 2 Lite Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Woven's hosted Nano Banana Lite media catalog rows with Fal's latest `google/nano-banana-2-lite` and `google/nano-banana-2-lite/edit` endpoints while preserving the corrected `$0.0398` provider image pricing.

**Architecture:** This is a catalog/data-contract change, not a provider adapter change. The Fal adapter already submits `model.providerEndpoint`, and the model registry already exposes `metadata.public_id` as the public model ID, so the implementation should update seeded catalog rows, already-applied database rows, public pricing rows, and tests that assert model IDs.

**Tech Stack:** Supabase migrations, `model_pricing_rules`, Fal queue endpoints, Vitest, TypeScript.

**Docs digest:** `docs/superpowers/research/2026-07-05-fal-nano-banana-lite-pricing.md`

## Global Constraints

- Use the latest verified Fal endpoints: `google/nano-banana-2-lite` and `google/nano-banana-2-lite/edit`.
- Keep Woven pricing at provider `$0.0398/image` with 20% markup, public `$0.0478/image`.
- Keep edit input role mapping as Woven `reference_images` -> Fal `image_urls`.
- Do not change `lib/media/providers/fal.ts`; it already uses `model.providerEndpoint`.
- Update applied databases with a new migration; changing the original seed alone is not enough.
- Preserve existing unrelated worktree changes, including untracked `pnpm-workspace.yaml`.
- Use `pnpm` for tests.

---

## File Structure

- Modify `docs/superpowers/research/2026-07-05-fal-nano-banana-lite-pricing.md`
  - Records verified latest endpoints and pricing basis.
- Modify `docs/superpowers/research/2026-07-03-media-runtime-catalog-docs.md`
  - Marks old `fal-ai/nano-banana-lite` endpoint notes as superseded by the Google endpoints.
- Modify `lib/pricing-page-rates.ts`
  - Public pricing-page model IDs and display group.
- Modify `tests/pricing-page-rates.test.ts`
  - Public pricing-page assertions.
- Modify `supabase/migrations/20260703180000_seed_media_runtime_catalog.sql`
  - Fresh database seed rows for Nano Banana 2 Lite.
- Create `supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql`
  - Existing database migration that upserts the new Google rows and disables the old `fal-ai` Lite rows.
- Modify `tests/media/catalog-seed.test.ts`
  - Catalog seed and migration assertions.
- Modify `tests/media/db-rpcs.integration.test.ts`
  - Local DB integration catalog expectations.
- Modify selected media tests under `tests/media/*`
  - Replace stale production-facing Lite model IDs in fixtures with `google/nano-banana-2-lite`.

---

### Task 1: Lock The New Public Catalog Contract In Tests

**Files:**
- Modify: `tests/pricing-page-rates.test.ts`
- Modify: `tests/media/catalog-seed.test.ts`
- Modify: `tests/media/db-rpcs.integration.test.ts`

**Interfaces:**
- Consumes: current `mediaModelRates`, catalog seed metadata parsing helper, local DB catalog RPC test.
- Produces: failing tests that require `google/nano-banana-2-lite` and `google/nano-banana-2-lite/edit`.

- [ ] **Step 1: Write failing pricing-page test changes**

In `tests/pricing-page-rates.test.ts`, change the media row name and model IDs:

```ts
expect(mediaModelRates.map((rate) => rate.name)).toEqual([
  "GPT Image 2",
  "Nano Banana Pro",
  "Nano Banana 2 Lite",
  "Gemini Omni Flash",
  "Veo 3.1",
  "Veo 3.1 Fast",
  "Seedance 2.0",
  "Seedance 2.0 Fast",
  "Kling v3 Pro",
  "Kling v3 Standard",
  "Eleven Music v2",
]);

expect(mediaByName.get("Nano Banana 2 Lite")).toMatchObject({
  capability: "Image generation and editing",
  modelIds: ["google/nano-banana-2-lite", "google/nano-banana-2-lite/edit"],
  rate: "$0.0478/image",
  notes: "Uses Fal's $0.0398/image Nanobanana rate with hosted markup.",
});
```

Also update the endpoint-backed model ID assertion:

```ts
expect(mediaByName.get("Nano Banana 2 Lite")?.modelIds).toEqual([
  "google/nano-banana-2-lite",
  "google/nano-banana-2-lite/edit",
]);
```

- [ ] **Step 2: Write failing catalog seed assertions**

In `tests/media/catalog-seed.test.ts`, change the Lite loop to new IDs and assert provider endpoint and display values:

```ts
for (const id of ["google/nano-banana-2-lite", "google/nano-banana-2-lite/edit"]) {
  const metadata = rows.get(id) as CatalogMetadata;
  expect(metadata.public_id).toBe(id);
  expect(metadata.provider_endpoint).toBe(id);
  expect(metadata.pricing_formula).toMatchObject({
    type: "nano_banana",
    provider_rate_usd_per_image: "0.0398",
  });
  expect(seedColumnsForModel(id)).toMatchObject({
    markupBps: 2_000,
    minimumChargeUsdMicros: 0,
    reserveAmountUsdMicros: 47_760,
  });
}
expect(rows.has("fal-ai/nano-banana-lite")).toBe(false);
expect(rows.has("fal-ai/nano-banana-lite/edit")).toBe(false);
```

Update `CatalogMetadata` to include:

```ts
provider_endpoint: string;
```

Update the migration-presence test to expect the new migration path:

```ts
const nanoBananaLiteEndpointMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql",
);
```

The correction migration assertion should include both old and new IDs:

```ts
expect(correction).toContain("'google/nano-banana-2-lite'");
expect(correction).toContain("'google/nano-banana-2-lite/edit'");
expect(correction).toContain("'fal-ai/nano-banana-lite'");
expect(correction).toContain("'fal-ai/nano-banana-lite/edit'");
expect(correction).toContain("enabled = false");
```

- [ ] **Step 3: Write failing DB catalog integration expectations**

In `tests/media/db-rpcs.integration.test.ts`, update the catalog ID assertions:

```ts
expect(ids.has("fal-ai/nano-banana-pro")).toBe(true);
expect(ids.has("google/nano-banana-2-lite")).toBe(true);
expect(ids.has("google/nano-banana-2-lite/edit")).toBe(true);
expect(ids.has("fal-ai/nano-banana-lite")).toBe(false);
expect(ids.has("fal-ai/nano-banana-lite/edit")).toBe(false);
```

- [ ] **Step 4: Run tests to verify red**

Run:

```bash
pnpm test tests/pricing-page-rates.test.ts tests/media/catalog-seed.test.ts
```

Expected: failures showing the current code still returns `Nano Banana Lite` and `fal-ai/nano-banana-lite`.

For DB integration, run only if local Supabase is running:

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=$LOCAL_SUPABASE_SERVICE_ROLE_KEY pnpm run test:media-db
```

Expected before implementation: the catalog test fails because local DB still has old Lite IDs.

---

### Task 2: Update Fresh Seed And Public Pricing Rows

**Files:**
- Modify: `lib/pricing-page-rates.ts`
- Modify: `supabase/migrations/20260703180000_seed_media_runtime_catalog.sql`

**Interfaces:**
- Consumes: Fal docs digest endpoint IDs and current seed row shape.
- Produces: fresh DB catalog rows with public IDs and provider endpoints set to Google Nano Banana 2 Lite.

- [ ] **Step 1: Update public pricing row**

In `lib/pricing-page-rates.ts`, rename the row and update model IDs:

```ts
{
  name: "Nano Banana 2 Lite",
  capability: "Image generation and editing",
  modelIds: ["google/nano-banana-2-lite", "google/nano-banana-2-lite/edit"],
  rate: "$0.0478/image",
  notes: "Uses Fal's $0.0398/image Nanobanana rate with hosted markup.",
},
```

- [ ] **Step 2: Update fresh seed text-to-image row**

In `supabase/migrations/20260703180000_seed_media_runtime_catalog.sql`, change the text-to-image row:

```sql
'google/nano-banana-2-lite',
'image_generation',
'Nano Banana 2 Lite',
2000,
0,
47760,
true,
```

Inside that row's JSON metadata, change:

```json
"public_id": "google/nano-banana-2-lite",
"provider_endpoint": "google/nano-banana-2-lite"
```

Keep these values unchanged:

```json
"pricing_formula": {
  "type": "nano_banana",
  "image_parameter": "num_images",
  "provider_rate_usd_per_image": "0.0398"
}
```

- [ ] **Step 3: Update fresh seed edit row**

In the same migration, change the edit row:

```sql
'google/nano-banana-2-lite/edit',
'image_generation',
'Nano Banana 2 Lite Edit',
2000,
0,
47760,
true,
```

Inside that row's JSON metadata, change:

```json
"public_id": "google/nano-banana-2-lite/edit",
"provider_endpoint": "google/nano-banana-2-lite/edit"
```

Keep the input role mapping:

```json
"input_asset_schema": {
  "roles": [
    {
      "role": "reference_images",
      "provider_field": "image_urls",
      "media_kind": "image",
      "required": true,
      "min": 1,
      "max": 4,
      "content_type_prefixes": ["image/"]
    }
  ]
}
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm test tests/pricing-page-rates.test.ts tests/media/catalog-seed.test.ts
```

Expected: pricing-page and fresh-seed assertions pass except the follow-up migration assertion, if Task 3 is not complete yet.

---

### Task 3: Add Migration For Already-Applied Databases

**Files:**
- Create: `supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql`
- Modify: `tests/media/catalog-seed.test.ts`

**Interfaces:**
- Consumes: current `model_pricing_rules` schema and catalog metadata format.
- Produces: existing DBs expose only the new Google Lite rows as enabled catalog entries.

- [ ] **Step 1: Create migration**

Create `supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql`.

The migration should:

1. Insert or update `google/nano-banana-2-lite`.
2. Insert or update `google/nano-banana-2-lite/edit`.
3. Disable old `fal-ai/nano-banana-lite` rows.

Use the exact metadata from the updated seed rows for both `metadata` values. The row values must be:

```sql
provider = 'fal'
operation = 'image_generation'
markup_bps = 2000
minimum_charge_usd_micros = 0
reserve_amount_usd_micros = 47760
enabled = true
```

At the end of the migration, disable old rows:

```sql
update public.model_pricing_rules
set enabled = false,
    metadata = metadata
      || jsonb_build_object(
        'superseded_by',
        case
          when model = 'fal-ai/nano-banana-lite' then 'google/nano-banana-2-lite'
          when model = 'fal-ai/nano-banana-lite/edit' then 'google/nano-banana-2-lite/edit'
          else null
        end
      ),
    updated_at = now()
where provider = 'fal'
  and operation = 'image_generation'
  and model in (
    'fal-ai/nano-banana-lite',
    'fal-ai/nano-banana-lite/edit'
  );
```

- [ ] **Step 2: Run catalog migration test**

Run:

```bash
pnpm test tests/media/catalog-seed.test.ts
```

Expected: PASS.

- [ ] **Step 3: Apply locally with psql**

If local Supabase is running, apply only this migration:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql
```

Expected: insert/update output for the new rows and update output for the old rows.

- [ ] **Step 4: Verify local DB catalog rows**

Run:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select model, display_name, enabled, minimum_charge_usd_micros, reserve_amount_usd_micros, metadata #>> '{public_id}' as public_id, metadata #>> '{provider_endpoint}' as endpoint, metadata #>> '{pricing_formula,provider_rate_usd_per_image}' as rate from public.model_pricing_rules where model in ('google/nano-banana-2-lite','google/nano-banana-2-lite/edit','fal-ai/nano-banana-lite','fal-ai/nano-banana-lite/edit') order by model;"
```

Expected:

```text
google/nano-banana-2-lite       enabled true   reserve 47760   public_id google/nano-banana-2-lite       endpoint google/nano-banana-2-lite       rate 0.0398
google/nano-banana-2-lite/edit  enabled true   reserve 47760   public_id google/nano-banana-2-lite/edit  endpoint google/nano-banana-2-lite/edit  rate 0.0398
fal-ai/nano-banana-lite         enabled false
fal-ai/nano-banana-lite/edit    enabled false
```

---

### Task 4: Replace Stale Lite IDs In Active Tests And Docs

**Files:**
- Modify: `tests/media/job-routes.test.ts`
- Modify: `tests/media/fal-webhook-route.test.ts`
- Modify: `tests/media/trigger-dispatch.test.ts`
- Modify: `tests/media/trigger-tasks.test.ts`
- Modify: `tests/media/pricing.test.ts`
- Modify: `docs/superpowers/research/2026-07-03-media-runtime-catalog-docs.md`
- Modify: `docs/superpowers/specs/2026-07-03-media-runtime-catalog-design.md`

**Interfaces:**
- Consumes: new canonical Lite public model IDs.
- Produces: no active tests or current catalog docs point engineers toward `fal-ai/nano-banana-lite`.

- [ ] **Step 1: Replace production-facing test fixture IDs**

Run:

```bash
rg -n "fal-ai/nano-banana-lite" tests/media lib supabase docs/superpowers/specs docs/superpowers/research
```

In active tests and current specs/research, replace:

```text
fal-ai/nano-banana-lite -> google/nano-banana-2-lite
fal-ai/nano-banana-lite/edit -> google/nano-banana-2-lite/edit
```

Do not edit older implementation plans under `docs/superpowers/plans/` unless a test imports them.

- [ ] **Step 2: Preserve old-ID references only where intentionally testing migration disablement**

After replacements, this command should show old IDs only in migration tests, migration SQL, and superseded historical notes:

```bash
rg -n "fal-ai/nano-banana-lite" tests lib supabase docs/superpowers/research docs/superpowers/specs
```

Acceptable remaining references:

```text
tests/media/catalog-seed.test.ts
supabase/migrations/20260705131500_migrate_nano_banana_2_lite_endpoints.sql
docs/superpowers/research/2026-07-03-media-runtime-catalog-docs.md
docs/superpowers/research/2026-07-05-fal-nano-banana-lite-pricing.md
```

- [ ] **Step 3: Run media unit tests touched by ID replacement**

Run:

```bash
pnpm test tests/media/pricing.test.ts tests/media/job-routes.test.ts tests/media/fal-webhook-route.test.ts tests/media/trigger-dispatch.test.ts tests/media/trigger-tasks.test.ts tests/pricing-page-rates.test.ts tests/media/catalog-seed.test.ts
```

Expected: PASS.

---

### Task 5: End-To-End Catalog Verification

**Files:**
- No source changes unless verification finds a bug.

**Interfaces:**
- Consumes: local DB, local backend, and generated model catalog.
- Produces: proof Harness will see the new model IDs from the backend.

- [ ] **Step 1: Run DB integration catalog test**

If local Supabase is running:

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=$LOCAL_SUPABASE_SERVICE_ROLE_KEY pnpm run test:media-db
```

Expected: PASS.

- [ ] **Step 2: Restart local Next app if it is running**

The media registry caches enabled models in-process. If `pnpm run dev` is already running, restart it before calling `/api/v1/media/models`.

- [ ] **Step 3: Verify model registry from Node**

Run with the same env used by local dev:

```bash
pnpm exec tsx -e "import { getMediaModel } from './lib/media/model-registry'; const model = await getMediaModel('google/nano-banana-2-lite'); const edit = await getMediaModel('google/nano-banana-2-lite/edit'); console.log({ model: model && { id: model.id, endpoint: model.providerEndpoint, reserve: model.pricing.reserveUsdMicros }, edit: edit && { id: edit.id, endpoint: edit.providerEndpoint, reserve: edit.pricing.reserveUsdMicros, roles: edit.inputAssetSchema.roles.map((role) => [role.role, role.providerField]) } });"
```

Expected:

```js
{
  model: {
    id: "google/nano-banana-2-lite",
    endpoint: "google/nano-banana-2-lite",
    reserve: 47760
  },
  edit: {
    id: "google/nano-banana-2-lite/edit",
    endpoint: "google/nano-banana-2-lite/edit",
    reserve: 47760,
    roles: [["reference_images", "image_urls"]]
  }
}
```

- [ ] **Step 4: Harness handoff note**

Tell the Harness agent:

```text
Nano Banana Lite hosted media model IDs changed:
- old text-to-image: fal-ai/nano-banana-lite
- new text-to-image: google/nano-banana-2-lite
- old edit: fal-ai/nano-banana-lite/edit
- new edit: google/nano-banana-2-lite/edit

Harness should not hardcode either ID. It should refresh /api/v1/media/models and use the returned model IDs, parameter_schema, and input_asset_schema. Existing generated jobs with old local IDs can be treated as historical local-test data.
```

---

## Self-Review

- Spec coverage: plan covers latest Fal endpoint IDs, pricing math, edit image input, fresh seed, already-applied DBs, tests, and Harness handoff.
- Placeholder scan: no task asks for unspecified validation or future work. The only long metadata instruction intentionally points to the updated seed row as the single source of truth to prevent duplicated JSON drift.
- Type consistency: public model IDs are consistently `google/nano-banana-2-lite` and `google/nano-banana-2-lite/edit`; provider endpoint equals public ID for both rows; pricing remains `0.0398` provider and `47760` reserve micros.
