# Kimi K3 Soft Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Apply risk-based implementer continuity and review checkpoints; task numbering alone does not require a fresh worker or reviewer. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide Kimi K3 from new Woven model selection while preserving stale-client requests for at least seven days, then manually disable Kimi after 48 hours of zero traffic.

**Architecture:** Add a typed `catalog_visible` database control so discovery and request admission are independent. Phase 1 hides Kimi from `GET /api/v1/models` while keeping exact Kimi chat requests enabled and billed; Phase 2 is created only after the manual gate and disables admission while declaring Luna as Kimi's successor.

**Tech Stack:** PostgreSQL/Supabase migrations, `@supabase/supabase-js` 2.105.1, Next.js 16.2.3 Route Handlers, Vitest 4.1.9, Swift/XCTest for the existing Harness catalog consumer, Vercel, Supabase CLI 2.101.0

**Docs digest:** `docs/superpowers/research/2026-09-04-kimi-k3-soft-retirement-docs.md`

## Global Constraints

- `openai/gpt-5.6-luna` remains the sole visible hosted default.
- Phase 1 uses a minimum seven-day grace period plus 48 consecutive hours with no new Kimi generation jobs.
- Final disablement is manual; no cron or request-time mutation changes model availability.
- Never alias a Kimi request to Luna. Requested model, executed model, provider cost, job data, and billing must agree.
- Never delete Kimi's pricing rule, generation jobs, usage events, or ledger history.
- Keep Kimi's public rate visible as `Legacy compatibility only` while stale requests remain billable; remove it only in Phase 2.
- Do not add Kimi to Luna's `replaces_model_ids` until Phase 2.
- Do not create `20260911120000_finalize_kimi_k3_retirement.sql` until the manual gate passes.
- `supabase/migrations/20260904120000_rollout_gpt_5_6_luna.sql` has already been applied to production. It is immutable and must be committed with its existing tests and public rate row before the Kimi release is merged.
- Preserve unrelated worktree changes. Use `pnpm`, not npm.

---

### Task 1: Checkpoint The Live Luna Baseline

**Outcome:** Repository history records the Luna catalog state that is already live in production before another migration builds on it.

**Risk and evidence:** Migration-lineage and billing configuration risk. This is a characterization/checkpoint task, not a new behavior RED cycle. Review the exact applied migration, run the focused catalog/pricing tests and full suite, and independently compare local/remote migration history before committing.

**Files:**
- Existing: `supabase/migrations/20260904120000_rollout_gpt_5_6_luna.sql`
- Existing: `tests/gpt-5-6-luna-migration.test.ts`
- Existing: `tests/model-catalog-route.test.ts`
- Existing: `lib/pricing-page-rates.ts`
- Existing: `tests/pricing-page-rates.test.ts`
- Existing: `docs/superpowers/specs/2026-09-04-kimi-k3-soft-retirement-design.md`
- Existing: `docs/superpowers/research/2026-09-04-kimi-k3-soft-retirement-docs.md`
- Existing: `docs/superpowers/plans/2026-09-04-kimi-k3-soft-retirement.md`

**Interfaces:**
- Consumes: production migration history for project `rlhjpovwwsqdeklhnvfl`.
- Produces: a committed Luna baseline with `openai/gpt-5.6-luna` enabled/default, Kimi enabled/non-default, and Luna's marked-up public rates.

- [ ] **Step 1: Audit the current local state without editing it**

Run:

```bash
git status --short
git diff --check
git diff -- supabase/migrations/20260904120000_rollout_gpt_5_6_luna.sql lib/pricing-page-rates.ts tests/gpt-5-6-luna-migration.test.ts tests/model-catalog-route.test.ts tests/pricing-page-rates.test.ts
supabase migration list --linked
```

Expected: the Luna migration is present locally and remotely as `20260904120000`; no later local-only migration exists yet; Kimi remains enabled/non-default in the Luna SQL.

- [ ] **Step 2: Verify the existing Luna contracts**

Run:

```bash
pnpm exec vitest run tests/gpt-5-6-luna-migration.test.ts tests/model-catalog-route.test.ts tests/pricing-page-rates.test.ts
pnpm test
```

Expected: all focused tests and the full Vitest suite exit successfully.

- [ ] **Step 3: Review and commit the baseline**

Review boundary: independent migration/configuration review. Confirm the migration is identical to the version already applied remotely and does not disable Kimi.

```bash
git add supabase/migrations/20260904120000_rollout_gpt_5_6_luna.sql tests/gpt-5-6-luna-migration.test.ts tests/model-catalog-route.test.ts lib/pricing-page-rates.ts tests/pricing-page-rates.test.ts docs/superpowers/specs/2026-09-04-kimi-k3-soft-retirement-design.md docs/superpowers/research/2026-09-04-kimi-k3-soft-retirement-docs.md docs/superpowers/plans/2026-09-04-kimi-k3-soft-retirement.md
git commit -m "feat(models): roll out GPT-5.6 Luna"
```

---

### Task 2: Separate Catalog Visibility From Chat Admission

**Outcome:** Newly fetched hosted catalogs omit Kimi, while stale clients can continue making exact Kimi requests during Phase 1.

**Risk and evidence:** Database migration, authorization boundary, and billable request routing. Use strict TDD for migration/query behavior and caller-visible route behavior. Require independent review before production release.

**Files:**
- Create: `supabase/migrations/20260904123000_add_model_catalog_visibility.sql`
- Create: `tests/model-catalog-visibility-migration.test.ts`
- Modify: `lib/billing/model-pricing.ts:5-69`
- Modify: `lib/billing/tool-pricing.ts:20-47`
- Modify: `lib/reel-captions/pricing.ts:23-47`
- Modify: `lib/media/model-registry.ts:17-58`
- Modify: `tests/model-pricing.test.ts:16-67`
- Modify: `tests/model-catalog-route.test.ts:12-230`
- Modify: `tests/chat-completions-model-policy.test.ts:38-199`
- Modify: `tests/media/model-registry.test.ts:167-192`
- Modify: `tests/reel-captions/routes.test.ts:3-14`

**Interfaces:**
- Consumes: `public.model_pricing_rules.enabled` as the existing admission control.
- Produces: `ModelPricingRule.catalog_visible: boolean`.
- Produces: `listHostedChatModels(): Promise<ModelPricingRule[]>`, restricted to `enabled = true AND catalog_visible = true`.
- Produces: `getHostedChatModel(model: string): Promise<ModelPricingRule | null>`, restricted to `enabled = true` but intentionally independent of `catalog_visible`.

- [ ] **Step 1: Add failing migration and query contracts**

Create `tests/model-catalog-visibility-migration.test.ts` with assertions that the migration:

- adds `catalog_visible boolean not null default true`;
- sets Kimi `catalog_visible = false`;
- preserves Kimi `enabled = true` and `metadata.is_default = false`;
- does not modify Luna replacement metadata;
- contains no `delete` statement.

Update `tests/model-pricing.test.ts` so catalog query calls are exactly:

```ts
[
  ["provider", "vercel-ai-gateway"],
  ["operation", "chat"],
  ["enabled", true],
  ["catalog_visible", true],
]
```

Keep direct lookup calls exactly provider, operation, model, and enabled; assert they do not include a visibility filter.

Add `catalog_visible` to typed test rules. In `tests/chat-completions-model-policy.test.ts`, set the Kimi rule to `catalog_visible: false` and prove both `moonshotai/kimi-k3` and `woven:moonshotai/kimi-k3` normalize to and execute the exact Kimi Gateway ID with Kimi job/usage records.

- [ ] **Step 2: Capture RED**

Run:

```bash
pnpm exec vitest run tests/model-catalog-visibility-migration.test.ts tests/model-pricing.test.ts tests/model-catalog-route.test.ts tests/chat-completions-model-policy.test.ts tests/media/model-registry.test.ts
```

Expected: assertions fail because the migration/column/filter are absent; compilation may additionally identify every typed `ModelPricingRule` fixture that needs `catalog_visible`.

- [ ] **Step 3: Add the Phase 1 migration**

Create `supabase/migrations/20260904123000_add_model_catalog_visibility.sql` with this behavior:

```sql
alter table public.model_pricing_rules
  add column catalog_visible boolean not null default true;

comment on column public.model_pricing_rules.catalog_visible is
  'Whether an enabled pricing rule is published in user-facing model catalogs.';

update public.model_pricing_rules as rules
set catalog_visible = false,
    enabled = true,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', false
    ),
    updated_at = now()
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = 'moonshotai/kimi-k3';
```

Do not alter Luna's replacements and do not disable Kimi.

- [ ] **Step 4: Implement the query split**

In `lib/billing/model-pricing.ts`:

- add `catalog_visible: boolean` to `ModelPricingRule`;
- add `catalog_visible` to both select lists;
- add `.eq("catalog_visible", true)` only to `listHostedChatModels()`;
- keep `getHostedChatModel()` gated only by exact model and `enabled = true`.

Add `catalog_visible` to the select lists in `lib/billing/tool-pricing.ts`, `lib/reel-captions/pricing.ts`, and `lib/media/model-registry.ts` so every query cast to the shared `ModelPricingRule` returns the complete type. Do not add a visibility filter to these non-chat pricing lookups; their existing `enabled` semantics remain unchanged.

Update every typed or representative `ModelPricingRule` fixture surfaced by TypeScript, including `tests/media/model-registry.test.ts` and `tests/reel-captions/routes.test.ts`, with `catalog_visible: true` unless the fixture specifically represents hidden Kimi.

Update the production-shaped catalog in `tests/model-catalog-route.test.ts` to omit Kimi and assert Luna is the sole default. Keep a focused synthetic Kimi capability test only if it remains independent of production catalog visibility; direct compatibility behavior belongs in the chat-policy test.

- [ ] **Step 5: Verify the focused and full backend suites**

Run:

```bash
pnpm exec vitest run tests/model-catalog-visibility-migration.test.ts tests/model-pricing.test.ts tests/model-catalog-route.test.ts tests/chat-completions-model-policy.test.ts tests/media/model-registry.test.ts tests/reel-captions/routes.test.ts
pnpm test
git diff --check
```

Expected: all focused tests and the full suite exit successfully; no test expects Kimi in the production-shaped visible catalog; hidden Kimi remains accepted by both bare and `woven:` request forms.

- [ ] **Step 6: Review and commit the admission boundary**

Review boundary: independent migration and billing-path review. Specifically inspect that visibility cannot disable admission, admission still requires `enabled`, and no model alias was added.

```bash
git add supabase/migrations/20260904123000_add_model_catalog_visibility.sql tests/model-catalog-visibility-migration.test.ts lib/billing/model-pricing.ts lib/billing/tool-pricing.ts lib/reel-captions/pricing.ts lib/media/model-registry.ts tests/model-pricing.test.ts tests/model-catalog-route.test.ts tests/chat-completions-model-policy.test.ts tests/media/model-registry.test.ts tests/reel-captions/routes.test.ts
git commit -m "feat(models): soft-hide Kimi K3"
```

---

### Task 3: Publish Accurate Phase 1 Pricing And Model Copy

**Outcome:** Public pages advertise Luna instead of Kimi for new selection while still disclosing Kimi's legacy compatibility rate.

**Risk and evidence:** Low-risk static content with deterministic tests and a production-page smoke check. No database behavior changes.

**Files:**
- Modify: `lib/pricing-page-rates.ts:35-114`
- Modify: `tests/pricing-page-rates.test.ts:9-108`
- Modify: `lib/seo/faqs.ts:40-42`
- Modify: `tests/seo-faqs.test.ts:5-21`

**Interfaces:**
- Consumes: `ChatModelRate.rateLabel?: string` already rendered by the desktop and mobile pricing tables.
- Produces: a Kimi rate row with `rateLabel: "Legacy compatibility only"` during Phase 1.
- Produces: hosted-model FAQ copy containing Luna and not Kimi.

- [ ] **Step 1: Add failing public-contract assertions**

In `tests/pricing-page-rates.test.ts`, keep the Kimi row and exact rates but require:

```ts
rateLabel: "Legacy compatibility only"
```

In `tests/seo-faqs.test.ts`, require the “Which models can I use?” answer to contain `GPT-5.6 Luna` and not contain `Kimi K3`.

- [ ] **Step 2: Capture RED**

Run:

```bash
pnpm exec vitest run tests/pricing-page-rates.test.ts tests/seo-faqs.test.ts
```

Expected: pricing fails for the missing legacy label and SEO fails because the current FAQ still advertises Kimi and omits Luna.

- [ ] **Step 3: Update the public data sources**

Add `rateLabel: "Legacy compatibility only"` to Kimi in `chatModelRates`. Keep its `$3.60/M` input, `$18.00/M` output, and `$0.36/M` cache-read rates unchanged.

Change the FAQ lineup to:

```text
Claude Sonnet 5, Claude Opus 4.8, GPT-5.6 Sol, GPT-5.6 Terra, and GPT-5.6 Luna
```

Do not describe Kimi as selectable. Do not remove its pricing row until Phase 2.

- [ ] **Step 4: Verify and commit public accuracy**

Run:

```bash
pnpm exec vitest run tests/pricing-page-rates.test.ts tests/seo-faqs.test.ts
pnpm test
git diff --check
```

Expected: all tests pass.

```bash
git add lib/pricing-page-rates.ts tests/pricing-page-rates.test.ts lib/seo/faqs.ts tests/seo-faqs.test.ts
git commit -m "fix(marketing): mark Kimi K3 as legacy"
```

---

### Task 4: Prove Current Harness Reconciliation Against The Phase 1 Catalog

**Outcome:** The current desktop catalog consumer is tested against a Luna-default catalog with no Kimi entry; no Harness production-code or app release is required.

**Risk and evidence:** Cross-system compatibility characterization. Update test fixtures and focused XCTest coverage, then run the affected suites through the repository's required Xcode task wrapper. Review as a separate Harness test-only commit.

**Files (in `/Users/naman/projects/woven-harness`):**
- Modify: `Tests/WovenHarnessTests/HostedModelCatalogFixtures.swift:29-70`
- Modify: `Tests/WovenHarnessTests/HostedModelCatalogTests.swift:5-44`
- Modify: `Tests/WovenHarnessTests/ModelCatalogStoreTests.swift:16-90`
- Modify: `Tests/WovenHarnessTests/ChatSessionModelReconcilerTests.swift:70-183, 529-557, 1003-1034`
- Modify: `Tests/WovenHarnessTests/ModelAccessTests.swift:279-288`

**Interfaces:**
- Consumes: existing `HostedModelCatalog.resolve(candidateID:)` exact/replacement/default order.
- Produces: a production-shaped Phase 1 fixture containing Luna as the sole default and no Kimi entry.
- Produces: explicit assertions that active/saved Kimi IDs resolve to Luna with `.medium` reasoning after catalog refresh.

- [ ] **Step 1: Update the production-shaped fixture**

In `validHostedModelEntries()`:

- add `openai/gpt-5.6-luna`, with 1,050,000 context, Low through Max efforts, Medium default, `isDefault: true`, and no replacements;
- remove the Kimi entry;
- keep Sol, Terra, Sonnet, and Opus unchanged.

Tests specifically validating Kimi's fixed-reasoning representation must construct a one-entry synthetic Kimi catalog rather than relying on the production-shaped fixture.

- [ ] **Step 2: Update reconciliation expectations**

Change default-fallback expectations from Kimi/Off to Luna/Medium. Add both canonical forms of saved and active Kimi:

```text
moonshotai/kimi-k3
woven:moonshotai/kimi-k3
```

For the Phase 1 fixture, both resolve through the sole backend default because Luna does not yet claim Kimi as a replacement. Assert Kimi is absent from `catalog.models` and cannot be executed after refresh.

- [ ] **Step 3: Run focused Harness tests through the wrapper**

Run from `/Users/naman/projects/woven-harness`:

```bash
RUN_ID="$(scripts/xcode-task.sh begin kimi-k3-soft-retirement)"
scripts/xcode-task.sh run "$RUN_ID" -- test \
  -scheme WovenHarness \
  -destination 'platform=macOS' \
  -only-testing:WovenHarnessTests/HostedModelCatalogTests \
  -only-testing:WovenHarnessTests/ModelCatalogStoreTests \
  -only-testing:WovenHarnessTests/ChatSessionModelReconcilerTests \
  -only-testing:WovenHarnessTests/ModelAccessTests
```

Expected: the wrapper exits successfully and all four selected suites pass.

- [ ] **Step 4: Review and commit the Harness contract tests**

Review boundary: confirm the diff changes fixtures/tests only and does not introduce a static Luna or Kimi production catalog.

```bash
git diff --check
git add Tests/WovenHarnessTests/HostedModelCatalogFixtures.swift Tests/WovenHarnessTests/HostedModelCatalogTests.swift Tests/WovenHarnessTests/ModelCatalogStoreTests.swift Tests/WovenHarnessTests/ChatSessionModelReconcilerTests.swift Tests/WovenHarnessTests/ModelAccessTests.swift
git commit -m "test(models): cover Kimi K3 soft retirement"
scripts/xcode-task.sh finish "$RUN_ID"
```

---

### Task 5: Release And Verify Phase 1

**Outcome:** Production catalogs hide Kimi, stale exact Kimi requests still succeed under Kimi, and the seven-day timer begins from a recorded production deployment time.

**Risk and evidence:** Production schema, billing, and compatibility release. Use the `release-woven-web` skill, inspect every pending migration before applying it, and stop if the dry run lists anything other than the Phase 1 visibility migration. Run authenticated catalog, compatibility, billing, and public-page smokes.

**Files:**
- Deploy: `supabase/migrations/20260904123000_add_model_catalog_visibility.sql`
- Deploy: backend and public files committed in Tasks 1-3
- Runtime evidence: production model catalog, one controlled Kimi job, matching usage event, pricing page, and homepage FAQ

**Interfaces:**
- Consumes: `WOVEN_PROD_SMOKE_BEARER_TOKEN` from the operator's environment; never print or persist it.
- Produces: `PHASE1_T0`, the successful Vercel production deployment timestamp reported in the completion summary.
- Produces: `KIMI_COMPAT_JOB_ID`, a controlled Kimi job proving compatibility and truthful billing.

- [ ] **Step 1: Audit release state and pending migrations**

Run:

```bash
git status --short
git diff --check
git log --oneline -10
supabase projects list
supabase db push --linked --dry-run
```

Expected: linked project is `rlhjpovwwsqdeklhnvfl`; the only pending migration is `20260904123000_add_model_catalog_visibility.sql`. Stop if any Phase 2 migration exists or any unrelated migration is pending.

- [ ] **Step 2: Apply the additive migration, then push and merge the reviewed branch**

Apply only the migration shown by the dry run:

```bash
supabase db push --linked
supabase migration list --linked
```

Expected: migration history shows `20260904123000` locally and remotely. Do not create or apply the Phase 2 migration.

Push the current feature branch and open the Phase 1 PR:

```bash
BRANCH="$(git branch --show-current)"
test "$BRANCH" != "main"
git push -u origin "$BRANCH"
gh pr create \
  --title "feat: soft-retire Kimi K3" \
  --body $'## Summary\n- make GPT-5.6 Luna the hosted default\n- hide Kimi K3 from new selection while preserving stale-client requests\n- mark Kimi pricing as legacy compatibility\n\n## Test plan\n- [x] focused model and pricing tests\n- [x] full Vitest suite\n- [x] migration applied to production'
```

Review all commits in the PR, wait for required checks, then squash-merge it. Wait until the resulting Vercel production deployment reaches `Ready`; stop on any failed check or deployment.

- [ ] **Step 3: Verify the authenticated visible catalog**

Run:

```bash
curl -sS \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  https://www.woven.video/api/v1/models \
  | jq -e '
    ([.data[] | select(.is_default == true)] | length) == 1 and
    (.data[] | select(.is_default == true) | .id) == "openai/gpt-5.6-luna" and
    ([.data[].id] | index("moonshotai/kimi-k3")) == null and
    ([.data[].id] | index("openai/gpt-5.6-luna")) != null
  '
```

Expected: `true`; Luna is the only default and Kimi is absent.

- [ ] **Step 4: Prove stale Kimi compatibility and billing identity**

Use a pre-approved production smoke account with sufficient credits:

```bash
curl -sS -D /var/folders/h4/j2nb67f945l_jhyzw0qx0tbw0000gn/T/opencode/kimi-compat.headers \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k3","messages":[{"role":"user","content":"Reply with exactly: ok"}],"max_tokens":32,"stream":false}' \
  https://www.woven.video/api/v1/chat/completions \
  | jq -e '.model == "moonshotai/kimi-k3" and (.choices | length > 0)'

KIMI_COMPAT_JOB_ID="$(rg -i '^x-woven-job-id:' /var/folders/h4/j2nb67f945l_jhyzw0qx0tbw0000gn/T/opencode/kimi-compat.headers | cut -d: -f2- | tr -d ' \r\n')"
test -n "$KIMI_COMPAT_JOB_ID"

supabase db query --linked --output json "select id, status, provider, model, final_cost_usd_micros from public.generation_jobs where id = '$KIMI_COMPAT_JOB_ID'; select job_id, provider, model, raw_provider_cost, charged_amount_usd_micros from public.usage_events where job_id = '$KIMI_COMPAT_JOB_ID'"
```

Expected: both records identify `vercel-ai-gateway` and `moonshotai/kimi-k3`; the job succeeds and the usage charge is nonnegative. No Luna identity appears in this compatibility request.

- [ ] **Step 5: Verify public pages and record the gate start**

Run:

```bash
(
  set -euo pipefail

  PRICING_RESPONSE="/var/folders/h4/j2nb67f945l_jhyzw0qx0tbw0000gn/T/opencode/woven-phase1-pricing.html"
  HOMEPAGE_RESPONSE="/var/folders/h4/j2nb67f945l_jhyzw0qx0tbw0000gn/T/opencode/woven-phase1-homepage.html"

  curl -fsS -o "$PRICING_RESPONSE" https://www.woven.video/pricing
  curl -fsS -o "$HOMEPAGE_RESPONSE" https://www.woven.video

  rg -q 'GPT-5\.6 Luna' "$PRICING_RESPONSE"
  rg -q 'Kimi K3' "$PRICING_RESPONSE"
  rg -q 'Legacy compatibility only' "$PRICING_RESPONSE"
  rg -q 'GPT-5\.6 Luna' "$HOMEPAGE_RESPONSE"
  if rg -q 'Kimi K3' "$HOMEPAGE_RESPONSE"; then
    exit 1
  fi
)
```

Expected: pricing contains Luna and the labeled legacy Kimi rate; selectable-model copy contains Luna and omits Kimi.

Record the successful Vercel production deployment timestamp as `PHASE1_T0` in the task completion summary. Phase 2 cannot start before `PHASE1_T0 + 7 days`.

---

### Task 6: Evaluate The Manual Retirement Gate

**Outcome:** Phase 2 begins only with recorded proof that the time and traffic conditions passed.

**Risk and evidence:** Production operational decision. Read-only database evidence only; no code, migration, or availability mutation occurs in this task.

**Files:**
- Read only: production `generation_jobs`
- Read only: the Phase 1 completion summary containing `PHASE1_T0`

**Interfaces:**
- Consumes: exact `PHASE1_T0` from Task 5.
- Produces: a manual go/no-go decision with `last_kimi_job_at` and `jobs_last_48h`.

- [ ] **Step 1: Confirm the minimum time gate**

Compare current UTC time with `PHASE1_T0 + 7 days`.

Expected: at least seven complete 24-hour periods have elapsed. If not, stop and leave Phase 1 unchanged.

- [ ] **Step 2: Query Kimi traffic**

Run:

```bash
supabase db query --linked --output json "select max(created_at) as last_kimi_job_at, count(*) filter (where created_at >= now() - interval '48 hours') as jobs_last_48h from public.generation_jobs where provider = 'vercel-ai-gateway' and model = 'moonshotai/kimi-k3'"
```

Expected for approval: `jobs_last_48h` is `0`. Record `last_kimi_job_at` with the decision. If the count is nonzero, stop and repeat this task only after another 48-hour quiet period.

- [ ] **Step 3: Obtain explicit manual approval**

Present `PHASE1_T0`, elapsed time, `last_kimi_job_at`, and `jobs_last_48h` to the user. Do not create the Phase 2 migration until the user approves final disablement based on this evidence.

---

### Task 7: Finalize Kimi Retirement After Gate Approval

**Outcome:** Kimi requests are rejected before job creation or billing, Luna explicitly succeeds Kimi/K2.6, and Kimi's public compatibility rate is removed.

**Risk and evidence:** Irreversible-at-runtime admission and billing behavior, implemented through a reversible fix-forward migration. Use strict TDD, independent migration review, and focused/full backend tests. Execute only after Task 6 passes and the user approves.

**Files:**
- Create after approval: `supabase/migrations/20260911120000_finalize_kimi_k3_retirement.sql`
- Create after approval: `tests/kimi-k3-final-retirement-migration.test.ts`
- Modify: `tests/model-catalog-route.test.ts`
- Modify: `tests/chat-completions-model-policy.test.ts`
- Modify: `lib/pricing-page-rates.ts`
- Modify: `tests/pricing-page-rates.test.ts`

**Interfaces:**
- Consumes: Phase 1's `catalog_visible` and existing exact admission lookup.
- Produces: Kimi `enabled = false`, `catalog_visible = false`, and empty replacements.
- Produces: Luna `replaces_model_ids = ["moonshotai/kimi-k3", "moonshotai/kimi-k2.6"]` while remaining the sole default.

- [ ] **Step 1: Add failing final-state contracts**

Create `tests/kimi-k3-final-retirement-migration.test.ts` only now. Assert that the final migration:

- disables Kimi and keeps it invisible;
- clears Kimi's replacement ownership;
- adds canonical K3 and K2.6 IDs to Luna's replacement list;
- preserves Luna as default;
- deletes no pricing rules.

Update the production-shaped route fixture so Luna exposes the two replacement IDs. Change the Kimi chat rejection test to request both bare and `woven:` K3 forms, mock no admitted rule, and assert `404 model_not_found` before Gateway URL resolution, admin client creation, fetch, job creation, or billing.

Update pricing tests to require Kimi's row to be absent.

- [ ] **Step 2: Capture RED**

Run:

```bash
pnpm exec vitest run tests/kimi-k3-final-retirement-migration.test.ts tests/model-catalog-route.test.ts tests/chat-completions-model-policy.test.ts tests/pricing-page-rates.test.ts
```

Expected: migration existence/final metadata and pricing assertions fail before implementation.

- [ ] **Step 3: Create the final migration**

Create `20260911120000_finalize_kimi_k3_retirement.sql` with two explicit updates in one migration:

```sql
update public.model_pricing_rules as rules
set enabled = false,
    catalog_visible = false,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', false,
      'replaces_model_ids', '[]'::jsonb
    ),
    updated_at = now()
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = 'moonshotai/kimi-k3';

update public.model_pricing_rules as rules
set enabled = true,
    catalog_visible = true,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', true,
      'replaces_model_ids', '["moonshotai/kimi-k3", "moonshotai/kimi-k2.6"]'::jsonb
    ),
    updated_at = now()
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = 'openai/gpt-5.6-luna';
```

Do not delete Kimi and do not modify historical jobs or usage.

- [ ] **Step 4: Remove the compatibility pricing row and satisfy contracts**

Remove Kimi from `chatModelRates`; retain Luna's exact marked-up rates. Update the route and chat-policy fixtures/assertions described in Step 1. No production chat code should need a Kimi branch: `enabled = false` makes the existing exact lookup reject it.

- [ ] **Step 5: Verify, review, and commit Phase 2**

Run:

```bash
pnpm exec vitest run tests/kimi-k3-final-retirement-migration.test.ts tests/model-catalog-route.test.ts tests/chat-completions-model-policy.test.ts tests/pricing-page-rates.test.ts
pnpm test
git diff --check
```

Expected: all focused tests and the full suite pass.

Review boundary: independent migration/admission review confirming the Task 6 evidence exists, Kimi is disabled rather than deleted, and rejection occurs before any billable side effect.

```bash
git add supabase/migrations/20260911120000_finalize_kimi_k3_retirement.sql tests/kimi-k3-final-retirement-migration.test.ts tests/model-catalog-route.test.ts tests/chat-completions-model-policy.test.ts lib/pricing-page-rates.ts tests/pricing-page-rates.test.ts
git commit -m "feat(models): retire Kimi K3"
```

---

### Task 8: Release And Verify Phase 2

**Outcome:** Production rejects all Kimi chat requests without billing, advertises Luna as Kimi's explicit successor, and no longer publishes Kimi pricing.

**Risk and evidence:** Production admission cutoff. Use the `release-woven-web` skill, require a dry run containing only the final migration, and compare generation-job counts around the rejection smoke.

**Files:**
- Deploy: `supabase/migrations/20260911120000_finalize_kimi_k3_retirement.sql`
- Deploy: final route-test contract and pricing-table removal from Task 7

**Interfaces:**
- Consumes: approved Task 6 evidence.
- Produces: final Kimi retirement with no hidden compatibility admission.

- [ ] **Step 1: Recheck the gate immediately before release**

Repeat Task 6's production query. If a new Kimi job appeared in the last 48 hours, stop and do not apply the final migration.

- [ ] **Step 2: Audit and apply only the final migration**

Run:

```bash
git status --short
git diff --check
git log --oneline -10
supabase projects list
supabase db push --linked --dry-run
```

Expected: the only pending migration is `20260911120000_finalize_kimi_k3_retirement.sql`.

Apply and verify it:

```bash
supabase db push --linked
supabase migration list --linked
```

Push the current feature branch, open a PR titled `feat: retire Kimi K3`, review all included commits, wait for required checks, and squash-merge it. Wait for the resulting Vercel production deployment to reach `Ready`; stop on any failed check or deployment.

- [ ] **Step 3: Verify final catalog and database policy**

Run:

```bash
supabase db query --linked --output json "select model, enabled, catalog_visible, metadata->>'is_default' as is_default, metadata->'replaces_model_ids' as replaces_model_ids from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and model in ('openai/gpt-5.6-luna', 'moonshotai/kimi-k3') order by model"

curl -sS \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  https://www.woven.video/api/v1/models \
  | jq -e '
    ([.data[] | select(.is_default == true)] | length) == 1 and
    (.data[] | select(.id == "openai/gpt-5.6-luna") |
      .is_default == true and
      .replaces_model_ids == ["moonshotai/kimi-k3", "moonshotai/kimi-k2.6"]) and
    ([.data[].id] | index("moonshotai/kimi-k3")) == null
  '
```

Expected: the database reports Kimi disabled/invisible and Luna enabled/visible/default; the catalog check returns `true`.

- [ ] **Step 4: Prove rejection happens before job creation**

Run:

```bash
BEFORE_KIMI_JOB_COUNT="$(supabase db query --linked --output json "select count(*)::bigint as count from public.generation_jobs where provider = 'vercel-ai-gateway' and model = 'moonshotai/kimi-k3'" | jq -r '.[0].count')"

KIMI_STATUS="$(curl -sS \
  -D /var/folders/h4/j2nb67f945l_jhyzw0qx0tbw0000gn/T/opencode/kimi-retired.headers \
  -o /var/folders/h4/j2nb67f945l_jhyzw0qx0tbw0000gn/T/opencode/kimi-retired.json \
  -w '%{http_code}' \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k3","messages":[{"role":"user","content":"Reply with exactly: ok"}],"max_tokens":8,"stream":false}' \
  https://www.woven.video/api/v1/chat/completions)"

test "$KIMI_STATUS" = "404"
jq -e '.error.code == "model_not_found"' /var/folders/h4/j2nb67f945l_jhyzw0qx0tbw0000gn/T/opencode/kimi-retired.json
if rg -qi '^x-woven-job-id:' /var/folders/h4/j2nb67f945l_jhyzw0qx0tbw0000gn/T/opencode/kimi-retired.headers; then exit 1; fi

AFTER_KIMI_JOB_COUNT="$(supabase db query --linked --output json "select count(*)::bigint as count from public.generation_jobs where provider = 'vercel-ai-gateway' and model = 'moonshotai/kimi-k3'" | jq -r '.[0].count')"
test "$BEFORE_KIMI_JOB_COUNT" = "$AFTER_KIMI_JOB_COUNT"
```

Expected: HTTP `404`, `model_not_found`, no job ID header, and an unchanged global Kimi job count. If concurrent stale traffic changes the global count, inspect the new rows and repeat once traffic is quiet rather than treating the count delta as proof that the rejected request created a job.

- [ ] **Step 5: Verify public removal and report completion**

Run:

```bash
curl -sS https://www.woven.video/pricing | rg -n 'Kimi K3' && false || true
curl -sS https://www.woven.video/pricing | rg -n 'GPT-5.6 Luna'
```

Expected: Kimi is absent and Luna remains published. Report the final migration version, deployment URL, gate evidence, catalog result, rejection result, and unchanged job count.

## Rollback Checkpoints

- Phase 1 rollback: add a new fix-forward migration setting Kimi `catalog_visible = true`; keep `enabled = true`. Revert only the related public copy if Kimi becomes selectable again.
- Phase 2 rollback: add a new fix-forward migration restoring Kimi `enabled = true`, keep it hidden first, and restore non-conflicting replacement ownership before making it visible.
- Never edit or delete an applied migration, use `git reset --hard`, reset the linked database, or remove historical billing data.
