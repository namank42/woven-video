# Hosted Model Full Cutover Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the complete backend-owned hosted-model catalog to production before Harness is ready, with a verified forward rollback and end-to-end catalog, execution, and billing proof.

**Architecture:** Prepare and test a rollback migration on a separate unmerged branch, then publish the reviewed release branch as a PR. After every local, preview, backup, Gateway, auth, and migration-history gate passes, apply exactly four production Supabase migrations before merging the PR; the merge to `main` triggers the Git-connected Vercel production deployment. Verify the resulting database, authenticated API, real Gateway requests, reservations, settlements, retired-model rejection, pricing, and logs before closing the release.

**Tech Stack:** Git/GitHub CLI, GitHub-connected Vercel production deployment, Supabase CLI 2.101.0, PostgreSQL migrations, Next.js 16.2.3, Vitest 4.1.9, pnpm 11.9.0, curl, jq

**Docs digest:** [`docs/superpowers/research/2026-07-15-hosted-model-full-cutover-release-docs.md`](../research/2026-07-15-hosted-model-full-cutover-release-docs.md)

## Global Constraints

- The selected release strategy is the full breaking cutover; Harness is not released in this window.
- Existing Harness builds may receive `model_not_found` for GPT-5.5 and Sonnet 4.6 immediately after the database push. This risk is explicitly accepted.
- Production Supabase project ref is exactly `rlhjpovwwsqdeklhnvfl`.
- Canonical production origin is exactly `https://www.woven.video`; `https://woven.video` redirects there.
- The release branch is `feat/gpt-5-6-sol-terra-credits`; its independently reviewed runtime head is `84f7a84` and release documentation follows it.
- The production catalog after cutover contains exactly five enabled Gateway chat rows: Sol, Terra, Sonnet 5, Opus 4.8, and Kimi K2.6.
- Kimi is the sole default. Sol replaces GPT-5.5; Sonnet 5 replaces Sonnet 4.6; Opus 4.8 replaces Opus 4.7; Terra replaces nothing.
- Do not add compatibility aliases, request-time remaps, or bill one model as another.
- Do not edit a migration after production records it. Database rollback is a new forward migration.
- Do not use `supabase db push --include-all`, `--include-seed`, `--include-roles`, or `supabase migration repair` during the normal release.
- The production dry-run must list exactly `20260712120000`, `20260712121000`, `20260712123000`, and `20260714120000`, with no other pending migration.
- Never print bearer tokens, Gateway keys, database passwords, Supabase service-role keys, or complete environment files.
- Do not begin a production mutation until the explicit go/no-go checkpoint in Task 4 is approved.
- A passing migration or Vercel build alone is insufficient; real authenticated execution and billing settlement must pass.
- If any stop condition is met, stop the forward sequence and follow Task 8. Do not improvise destructive SQL.

---

### Task 1: Freeze and re-verify the final release commit

**Files:**
- Verify: complete `feat/gpt-5-6-sol-terra-credits` worktree
- Record: `.superpowers/sdd/hosted-model-full-cutover-release-report.md` (ignored execution evidence)

**Interfaces:**
- Consumes: the reviewed runtime branch plus the approved release design and this plan.
- Produces: one immutable `RELEASE_SHA` that every PR, preview, migration, deploy, and report entry references.

- [ ] **Step 1: Confirm the release worktree and branch are clean**

Run:

```bash
cd /Users/naman/projects/woven-video/.worktrees/feat-gpt-5-6-sol-terra-credits
git status --short --branch
git branch --show-current
git diff --check
```

Expected:

```text
## feat/gpt-5-6-sol-terra-credits
feat/gpt-5-6-sol-terra-credits
```

`git diff --check` prints nothing. Stop if tracked or untracked files are present.

- [ ] **Step 2: Refresh `origin/main` without changing the branch**

Run:

```bash
git fetch origin main
git rev-parse origin/main
git merge-base origin/main HEAD
git log --oneline --left-right origin/main...HEAD
```

Expected: `origin/main` and the merge base are `8f9f21d3a99bb9dd489a2723030840e13e356ca3`, unless a deliberate new production commit has landed. If `origin/main` changed, stop and rebase or re-review the complete new delta before continuing.

- [ ] **Step 3: Run the focused release contract suite**

Run:

```bash
pnpm exec vitest run \
  tests/anthropic-successor-migration.test.ts \
  tests/gpt-5-6-sol-terra-migration.test.ts \
  tests/hosted-reasoning-efforts-migration.test.ts \
  tests/hosted-model-selection-policy-migration.test.ts \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-pricing.test.ts \
  tests/model-catalog-route.test.ts \
  tests/pricing-page-rates.test.ts \
  tests/pricing-page-source.test.ts \
  tests/seo-faqs.test.ts
```

Expected: all ten files pass with no failed test.

- [ ] **Step 4: Run the complete tests and production build**

Run:

```bash
pnpm test
pnpm build
```

Expected baseline at the reviewed runtime head:

```text
Test Files  52 passed | 1 skipped
Tests       408 passed | 27 skipped
```

The build must compile, finish TypeScript, generate all static pages, keep `/api/v1/models` dynamic, and keep `/pricing` static. Non-failing Node `module.register`, localStorage, and worktree-root warnings may be recorded; any compile, type, or page-generation failure blocks release.

- [ ] **Step 5: Reset the local database and verify the final cutover state**

Run:

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -x -c "select model, enabled, metadata->'is_default' as is_default, metadata->'replaces_model_ids' as replaces_model_ids, metadata->'supported_reasoning_efforts' as supported_reasoning_efforts, metadata->>'default_reasoning_effort' as default_reasoning_effort from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' order by enabled desc, model; select count(*) as total_enabled_rows, count(*) filter (where metadata->'is_default' = 'true'::jsonb) as enabled_default_count from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and enabled = true;"
```

Expected: five enabled rows, one enabled default, and that default is Kimi. Exact successor/reasoning metadata must match the Global Constraints.

- [ ] **Step 6: Freeze the release SHA and start the ignored report**

Run:

```bash
RELEASE_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$RELEASE_SHA"
```

Record the SHA, test counts, build result, local database result, date/time, branch, and worktree in `.superpowers/sdd/hosted-model-full-cutover-release-report.md` using `apply_patch`. Do not use shell redirection to create the report.

Expected: `git status --short --branch` remains clean because `.superpowers/sdd` is ignored.

---

### Task 2: Prepare and prove the forward rollback branch

**Files:**
- Create on rollback branch: `supabase/migrations/20260715123000_rollback_hosted_model_full_cutover.sql`
- Create on rollback branch: `tests/hosted-model-full-cutover-rollback-migration.test.ts`
- Record: `.superpowers/sdd/hosted-model-full-cutover-rollback-report.md`

**Interfaces:**
- Consumes: the exact frozen release commit from Task 1.
- Produces: remote branch `rollback/hosted-model-full-cutover` containing a locally proved, unapplied forward rollback migration.

- [ ] **Step 1: Create an isolated rollback worktree from the release SHA**

From the release worktree, run:

```bash
RELEASE_SHA="$(git rev-parse HEAD)"
git worktree add \
  -b rollback/hosted-model-full-cutover \
  /Users/naman/projects/woven-video/.worktrees/rollback-hosted-model-full-cutover \
  "$RELEASE_SHA"
```

Expected: a new clean worktree on `rollback/hosted-model-full-cutover`. If that branch or directory already exists, inspect it instead of deleting or overwriting it.

- [ ] **Step 2: Write the failing rollback source-contract test**

Create `tests/hosted-model-full-cutover-rollback-migration.test.ts` with:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715123000_rollback_hosted_model_full_cutover.sql",
);

describe("hosted model full-cutover rollback migration", () => {
  it("restores the previous hosted catalog without deleting history", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    const normalized = sql.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "('openai/gpt-5.5', true, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-sonnet-4.6', true, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-opus-4.8', true, false, '[\"anthropic/claude-opus-4.7\"]'::jsonb)",
    );
    expect(normalized).toContain(
      "('moonshotai/kimi-k2.6', true, true, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('openai/gpt-5.6-sol', false, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('openai/gpt-5.6-terra', false, false, '[]'::jsonb)",
    );
    expect(normalized).toContain(
      "('anthropic/claude-sonnet-5', false, false, '[]'::jsonb)",
    );
    expect(normalized.match(/, true, true, /g)).toHaveLength(1);
    expect(normalized).toContain("rules.provider = 'vercel-ai-gateway'");
    expect(normalized).toContain("rules.operation = 'chat'");
    expect(sql).not.toMatch(/delete\s+from\s+public\.model_pricing_rules/i);
    expect(sql).not.toMatch(/metadata\s*=\s*jsonb_build_object/i);
  });
});
```

- [ ] **Step 3: Run the rollback test and verify RED**

Run:

```bash
cd /Users/naman/projects/woven-video/.worktrees/rollback-hosted-model-full-cutover
pnpm exec vitest run tests/hosted-model-full-cutover-rollback-migration.test.ts
```

Expected: one failed test because `20260715123000_rollback_hosted_model_full_cutover.sql` does not exist.

- [ ] **Step 4: Add the exact forward rollback migration**

Create `supabase/migrations/20260715123000_rollback_hosted_model_full_cutover.sql` with:

```sql
-- Forward-only emergency rollback for the 2026-07-15 hosted-model cutover.
-- Restore the previous executable catalog while preserving all model rows,
-- usage events, jobs, ledger entries, and unrelated metadata.

with rollback_policy(model, enabled, is_default, replaces_model_ids) as (
  values
    ('openai/gpt-5.5', true, false, '[]'::jsonb),
    ('anthropic/claude-sonnet-4.6', true, false, '[]'::jsonb),
    ('anthropic/claude-opus-4.8', true, false, '["anthropic/claude-opus-4.7"]'::jsonb),
    ('moonshotai/kimi-k2.6', true, true, '[]'::jsonb),
    ('openai/gpt-5.6-sol', false, false, '[]'::jsonb),
    ('openai/gpt-5.6-terra', false, false, '[]'::jsonb),
    ('anthropic/claude-sonnet-5', false, false, '[]'::jsonb)
)
update public.model_pricing_rules as rules
set enabled = policy.enabled,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', policy.is_default,
      'replaces_model_ids', policy.replaces_model_ids
    ),
    updated_at = now()
from rollback_policy as policy
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = policy.model;
```

- [ ] **Step 5: Run the rollback test and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/hosted-model-full-cutover-rollback-migration.test.ts
```

Expected: one passing test.

- [ ] **Step 6: Prove the rollback against a complete local migration reset**

Run:

```bash
supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -x -c "select model, enabled, metadata->'is_default' as is_default, metadata->'replaces_model_ids' as replaces_model_ids from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' order by enabled desc, model; select count(*) as total_enabled_rows, count(*) filter (where metadata->'is_default' = 'true'::jsonb) as enabled_default_count from public.model_pricing_rules where provider = 'vercel-ai-gateway' and operation = 'chat' and enabled = true;"
```

Expected enabled catalog after rollback:

```text
anthropic/claude-opus-4.8
anthropic/claude-sonnet-4.6
moonshotai/kimi-k2.6
openai/gpt-5.5
```

Expected aggregate: four enabled rows and one enabled default, Kimi.

- [ ] **Step 7: Run rollback-branch regression gates**

Run:

```bash
pnpm exec vitest run \
  tests/hosted-model-full-cutover-rollback-migration.test.ts \
  tests/hosted-model-selection-policy.test.ts \
  tests/model-catalog-route.test.ts
pnpm test
git diff --check
```

Expected: all focused tests and the complete suite pass.

- [ ] **Step 8: Commit and push the rollback branch without merging it**

Run:

```bash
git add \
  supabase/migrations/20260715123000_rollback_hosted_model_full_cutover.sql \
  tests/hosted-model-full-cutover-rollback-migration.test.ts
git diff --cached --check
git commit -m "fix(models): prepare hosted catalog rollback"
git push -u origin rollback/hosted-model-full-cutover
```

Record the rollback commit SHA and local verification in `.superpowers/sdd/hosted-model-full-cutover-rollback-report.md`. The rollback branch must remain unmerged and its migration must not appear in the release branch's dry-run.

---

### Task 3: Publish the release branch and qualify the PR preview

**Files:**
- No source changes expected.
- Record: `.superpowers/sdd/hosted-model-full-cutover-release-report.md`

**Interfaces:**
- Consumes: frozen release SHA and proved rollback branch.
- Produces: an approved, green, unmerged release PR with a successful Vercel preview.

- [ ] **Step 1: Push the exact release branch**

Run from the release worktree:

```bash
cd /Users/naman/projects/woven-video/.worktrees/feat-gpt-5-6-sol-terra-credits
git status --short --branch
git push -u origin feat/gpt-5-6-sol-terra-credits
```

Expected: clean branch pushed without force.

- [ ] **Step 2: Create the release PR**

Run:

```bash
gh pr create \
  --base main \
  --head feat/gpt-5-6-sol-terra-credits \
  --title "feat(models): cut over hosted model catalog" \
  --body $'## Summary\n- add GPT-5.6 Sol and Terra to Woven credits\n- make Kimi the sole backend-owned default\n- publish exact backend-owned reasoning tiers and successor claims\n- roll out Claude Sonnet 5 and retire GPT-5.5/Sonnet 4.6 without aliases\n- update public pricing and current model copy\n- fail closed on invalid, duplicate, or non-executable catalog identities\n\n## Verification\n- local Supabase reset and idempotent migration replay\n- exact five-row enabled catalog and sole Kimi default\n- 408 tests passed, 27 skipped at reviewed runtime head\n- Next.js production build passed\n- independent whole-branch review: ready to merge\n\n## Release\nThis PR must remain unmerged until the production migration dry-run, backup, Gateway, auth, and rollback gates pass. Production database migrations apply immediately before this PR is merged.'
```

Expected: a PR URL. Record its number as `PR_NUMBER` in the ignored release report.

- [ ] **Step 3: Wait for all PR checks and Vercel preview**

Run:

```bash
PR_NUMBER="$(gh pr view --json number --jq .number)"
gh pr checks "$PR_NUMBER" --watch
gh pr view "$PR_NUMBER" --json mergeable,reviewDecision,statusCheckRollup,url
```

Expected: all checks pass, Vercel preview succeeds, `mergeable` is `MERGEABLE`, and the PR remains open/unmerged.

- [ ] **Step 4: Inspect the preview deployment**

Open the Vercel preview URL from the PR check and verify:

- `/pricing` renders Sol, Terra, Sonnet 5, Opus 4.8, and Kimi;
- Sonnet 5 shows both dated rate bands;
- homepage FAQ names Sonnet 5;
- preview build logs contain no compile, TypeScript, or route-generation error.

Do not use preview `/api/v1/models` as production-catalog proof unless preview is intentionally connected to production auth and database state.

- [ ] **Step 5: Obtain independent approval and freeze the PR**

Confirm the PR has either a human approval or a fresh independent read-only review of `origin/main...HEAD`. Record approval evidence, preview URL, and the final PR head SHA in the release report. Do not add commits after this point without rerunning Tasks 1 and 3.

---

### Task 4: Complete production preflight and declare go/no-go

**Files:**
- Verify: production Supabase migration history and backup inventory
- Verify: direct Vercel AI Gateway model execution
- Verify: production smoke-test credentials
- Record: `.superpowers/sdd/hosted-model-full-cutover-release-report.md`

**Interfaces:**
- Consumes: green frozen PR, rollback branch, production project ref, Gateway key, and funded smoke account.
- Produces: explicit release-owner authorization to run `supabase db push` in Task 5.

- [ ] **Step 1: Link the release worktree to the exact production Supabase project**

Run:

```bash
cd /Users/naman/projects/woven-video/.worktrees/feat-gpt-5-6-sol-terra-credits
supabase link --project-ref rlhjpovwwsqdeklhnvfl
cat supabase/.temp/project-ref
```

Expected:

```text
rlhjpovwwsqdeklhnvfl
```

Stop if any other project ref is shown.

- [ ] **Step 2: Verify production migration history**

Run:

```bash
supabase migration list --linked
```

Expected: local and remote history match through `20260708130000`. Exactly these four versions are local-only/pending:

```text
20260712120000
20260712121000
20260712123000
20260714120000
```

Stop on any other local-only migration, any remote-only migration, or any mismatch before `20260708130000`.

- [ ] **Step 3: Run the production migration dry-run**

Run:

```bash
supabase db push --linked --dry-run
```

Expected: the CLI plans exactly these files, in order:

```text
20260712120000_add_gpt_5_6_sol_terra.sql
20260712121000_seed_hosted_reasoning_efforts.sql
20260712123000_seed_hosted_model_selection_policy.sql
20260714120000_rollout_claude_sonnet_5.sql
```

The rollback migration must not appear. Stop if the list differs.

- [ ] **Step 4: Verify a recent completed physical backup**

Run:

```bash
supabase backups list --project-ref rlhjpovwwsqdeklhnvfl
```

Expected: the newest `PHYSICAL` backup has status `COMPLETED` and is less than 24 hours old. At plan-writing time, the newest verified backup was `2026-07-14 22:03:59 UTC`; execution must use the then-current newest backup.

- [ ] **Step 5: Capture the pre-cutover production catalog in Supabase SQL Editor**

Run this exact read-only query against project `rlhjpovwwsqdeklhnvfl`:

```sql
select
  id,
  provider,
  model,
  operation,
  display_name,
  markup_bps,
  minimum_charge_usd_micros,
  reserve_amount_usd_micros,
  enabled,
  metadata,
  created_at,
  updated_at
from public.model_pricing_rules
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
order by model;
```

Export or copy the complete result into the private release evidence. Confirm GPT-5.5 and Sonnet 4.6 are currently enabled before accepting the breaking cutover.

- [ ] **Step 6: Smoke-test all three new model IDs directly through Gateway**

Run from the release worktree. The command reads `AI_GATEWAY_API_KEY` from the root checkout's local environment file and prints only sanitized response summaries:

```bash
node --env-file=/Users/naman/projects/woven-video/.env.local --input-type=module -e '
const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is missing");
const baseUrl = (process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1").replace(/\/$/, "");
const checks = [
  { model: "openai/gpt-5.6-sol", effort: "medium" },
  { model: "openai/gpt-5.6-terra", effort: "medium" },
  { model: "anthropic/claude-sonnet-5", effort: "high" },
];
for (const check of checks) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: check.model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      reasoning_effort: check.effort,
      max_tokens: 32,
      stream: false,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.choices?.length) {
    throw new Error(`${check.model} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  console.log(JSON.stringify({
    requestedModel: check.model,
    status: response.status,
    responseId: payload.id ?? null,
    returnedModel: payload.model ?? null,
    usage: payload.usage ?? null,
  }));
}
'
```

Expected: three HTTP 200 summaries with non-empty response IDs and choices. Stop if any model is unrecognized, any effort is rejected, or Gateway returns an error.

- [ ] **Step 7: Verify the funded production smoke account before cutover**

Obtain a short-lived bearer token for the designated funded production test account through the normal signed-in Woven flow. Load it without echoing:

```bash
read -r -s "WOVEN_PROD_SMOKE_BEARER_TOKEN?Production smoke bearer token: "
export WOVEN_PROD_SMOKE_BEARER_TOKEN
printf '\n'
curl -sS \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  https://www.woven.video/api/v1/billing/balance \
  | jq -e '.balance_usd_micros > 200000 and .license.active == true'
```

Expected: `true`. The account must have more than `200000` micros ($0.20) and active access. Stop if auth, access, or balance is insufficient.

- [ ] **Step 8: Record the current production Vercel deployment**

Run:

```bash
CURRENT_MAIN_SHA="$(gh api repos/namank42/woven-video/commits/main --jq .sha)"
gh api "repos/namank42/woven-video/commits/$CURRENT_MAIN_SHA/status" \
  --jq '{state, deployments: [.statuses[] | select(.context == "Vercel") | {state, target_url, description}]}'
```

Expected: overall state `success` and one successful Vercel deployment URL. Record `CURRENT_MAIN_SHA` and the Vercel target URL for rollback.

- [ ] **Step 9: Present the production go/no-go checkpoint**

The release owner must review one compact evidence block containing:

- immutable release SHA and PR URL;
- rollback branch and commit SHA;
- all local tests/build/database gates;
- green PR checks and preview URL;
- exact four-file migration dry-run;
- newest completed backup time;
- pre-cutover production catalog snapshot;
- three successful direct Gateway checks;
- funded smoke-account balance/access check;
- current production main SHA and Vercel deployment URL.

Pause and obtain explicit approval to apply the production database migrations. Without that approval, do not execute Task 5.

---

### Task 5: Apply the production database cutover

**Files:**
- Apply: four approved Supabase migrations
- Record: `.superpowers/sdd/hosted-model-full-cutover-release-report.md`

**Interfaces:**
- Consumes: explicit Task 4 go decision and exact dry-run.
- Produces: the five-model persisted production catalog and four new remote migration-history entries.

- [ ] **Step 1: Repeat the migration dry-run immediately before mutation**

Run:

```bash
cd /Users/naman/projects/woven-video/.worktrees/feat-gpt-5-6-sol-terra-credits
git status --short --branch
supabase db push --linked --dry-run
```

Expected: clean release branch and exactly the same four files from Task 4. Any drift cancels the go decision.

- [ ] **Step 2: Apply the production migrations**

Run:

```bash
supabase db push --linked
```

Review the prompt and approve only if it lists the exact four migration files. Do not pass `--include-all`, `--include-seed`, `--include-roles`, or `--yes`.

Expected: all four migrations apply successfully. Record the complete non-secret output and timestamp.

- [ ] **Step 3: Verify remote migration history immediately**

Run:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
```

Expected: local and remote match through `20260714120000`; the second command reports no pending migration.

- [ ] **Step 4: Verify the unrestricted persisted catalog before merging the PR**

Run this exact read-only query in the production Supabase SQL Editor:

```sql
select
  model,
  enabled,
  metadata->'is_default' as is_default,
  metadata->'replaces_model_ids' as replaces_model_ids,
  metadata->'supported_reasoning_efforts' as supported_reasoning_efforts,
  metadata->>'default_reasoning_effort' as default_reasoning_effort
from public.model_pricing_rules
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
order by enabled desc, model;

select
  count(*) as total_enabled_rows,
  count(*) filter (
    where metadata->'is_default' = 'true'::jsonb
  ) as enabled_default_count,
  array_agg(model order by model) filter (
    where metadata->'is_default' = 'true'::jsonb
  ) as enabled_default_models
from public.model_pricing_rules
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and enabled = true;
```

Expected:

- exactly five enabled rows;
- exactly one enabled default: `moonshotai/kimi-k2.6`;
- exact successor/reasoning fields from Global Constraints;
- GPT-5.5, Sonnet 4.6, and Opus 4.7 disabled.

- [ ] **Step 5: Stop or proceed based on database state**

If every assertion passes, proceed immediately to Task 6.

If any assertion fails, do not merge the PR. Check out `/Users/naman/projects/woven-video/.worktrees/rollback-hosted-model-full-cutover`, link it to `rlhjpovwwsqdeklhnvfl`, run `supabase db push --linked --dry-run`, confirm it lists only `20260715123000_rollback_hosted_model_full_cutover.sql`, and apply it with `supabase db push --linked`. Then verify the four-row rollback catalog from Task 2.

If the original `db push` stopped before recording all four migrations, do not use `migration repair`. Run the rollback SQL body from Task 2 directly in Supabase SQL Editor, verify restored data, and investigate migration history before any further push.

---

### Task 6: Merge the release PR and qualify the Vercel production deployment

**Files:**
- Merge: approved release PR
- Deploy: Git-connected Vercel project `wovengroup/woven-video`
- Record: `.superpowers/sdd/hosted-model-full-cutover-release-report.md`

**Interfaces:**
- Consumes: verified production database cutover and green frozen PR.
- Produces: production Vercel deployment containing the exact release branch.

- [ ] **Step 1: Reconfirm the frozen PR head**

Run:

```bash
PR_NUMBER="$(gh pr view --json number --jq .number)"
LOCAL_RELEASE_SHA="$(git rev-parse HEAD)"
PR_HEAD_SHA="$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid)"
test "$LOCAL_RELEASE_SHA" = "$PR_HEAD_SHA"
gh pr checks "$PR_NUMBER"
```

Expected: the SHA comparison exits zero and every PR check is successful.

- [ ] **Step 2: Merge with a merge commit**

Run:

```bash
gh pr merge "$PR_NUMBER" --merge
MERGE_SHA="$(gh pr view "$PR_NUMBER" --json mergeCommit --jq .mergeCommit.oid)"
printf '%s\n' "$MERGE_SHA"
```

Expected: PR state becomes merged and `MERGE_SHA` is non-empty. The merge triggers Vercel automatically.

- [ ] **Step 3: Wait for the Vercel status on the merge commit**

Run:

```bash
for attempt in {1..60}; do
  state="$(gh api "repos/namank42/woven-video/commits/$MERGE_SHA/status" \
    --jq '[.statuses[] | select(.context == "Vercel")][0].state // "pending"')"
  printf 'Vercel deployment state: %s\n' "$state"
  if [ "$state" = "success" ]; then break; fi
  if [ "$state" = "failure" ] || [ "$state" = "error" ]; then exit 1; fi
  sleep 10
done
test "$(gh api "repos/namank42/woven-video/commits/$MERGE_SHA/status" \
  --jq '[.statuses[] | select(.context == "Vercel")][0].state // "pending"')" = "success"
gh api "repos/namank42/woven-video/commits/$MERGE_SHA/status" \
  --jq '{state, deployments: [.statuses[] | select(.context == "Vercel") | {state, target_url, description}]}'
```

Expected: success within ten minutes and a successful Vercel target URL.

- [ ] **Step 4: Confirm the canonical production site serves the new deployment**

Run:

```bash
curl -fsS https://www.woven.video/pricing > /private/tmp/woven-pricing-cutover.html
rg -n "Claude Sonnet 5|GPT-5.6 Sol|GPT-5.6 Terra|Intro through Aug 31, 2026|From Sep 1, 2026" /private/tmp/woven-pricing-cutover.html
```

Expected: all five strings are present. If GitHub/Vercel reports success but the production domain still serves old content, wait for alias propagation and recheck; do not declare success.

- [ ] **Step 5: Handle deployment failure without widening damage**

If the new Vercel deployment fails or produces runtime 5xx responses, first apply the prepared database rollback from Task 5 so old desktop clients regain old models. The previous Vercel production deployment should remain active on build failure; if a bad deployment became active, use the recorded Vercel deployment in the Vercel dashboard's rollback action. Verify both restored database state and canonical-domain behavior before continuing.

---

### Task 7: Run authenticated production execution and billing smoke tests

**Files:**
- Verify: `https://www.woven.video/api/v1/models`
- Verify: `https://www.woven.video/api/v1/chat/completions`
- Verify: `https://www.woven.video/api/v1/billing/balance`
- Verify: production Supabase jobs, usage, and ledger rows
- Record: `.superpowers/sdd/hosted-model-full-cutover-release-report.md`

**Interfaces:**
- Consumes: deployed Vercel merge commit, five-row production catalog, funded bearer token.
- Produces: real catalog, execution, retirement, reservation, settlement, and public-surface evidence.

- [ ] **Step 1: Reload the production bearer token without printing it**

Run:

```bash
read -r -s "WOVEN_PROD_SMOKE_BEARER_TOKEN?Production smoke bearer token: "
export WOVEN_PROD_SMOKE_BEARER_TOKEN
printf '\n'
```

- [ ] **Step 2: Verify the exact authenticated catalog contract**

Run:

```bash
curl -fsS \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  https://www.woven.video/api/v1/models \
  > /private/tmp/woven-model-catalog-cutover.json

jq -e '
  .object == "list" and
  (.data | map(.id) | sort) == ([
    "anthropic/claude-opus-4.8",
    "anthropic/claude-sonnet-5",
    "moonshotai/kimi-k2.6",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra"
  ] | sort) and
  ([.data[] | select(.is_default == true) | .id] == ["moonshotai/kimi-k2.6"]) and
  ((.data[] | select(.id == "openai/gpt-5.6-sol") | .replaces_model_ids) == ["openai/gpt-5.5"]) and
  ((.data[] | select(.id == "anthropic/claude-sonnet-5") | .replaces_model_ids) == ["anthropic/claude-sonnet-4.6"]) and
  ((.data[] | select(.id == "anthropic/claude-opus-4.8") | .replaces_model_ids) == ["anthropic/claude-opus-4.7"]) and
  ((.data[] | select(.id == "anthropic/claude-sonnet-5") | .capabilities.supported_reasoning_efforts) == ["low", "medium", "high", "xhigh", "max"]) and
  ((.data[] | select(.id == "anthropic/claude-sonnet-5") | .capabilities.default_reasoning_effort) == "high")
' /private/tmp/woven-model-catalog-cutover.json
```

Expected: `true` and exit zero.

- [ ] **Step 3: Capture the balance before real requests**

Run:

```bash
curl -fsS \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  https://www.woven.video/api/v1/billing/balance \
  > /private/tmp/woven-balance-before-cutover.json
jq -e '.license.active == true and .balance_usd_micros > 200000' \
  /private/tmp/woven-balance-before-cutover.json
```

Expected: `true`.

- [ ] **Step 4: Send one non-streaming request through each new model**

Run:

```bash
curl -fsS -D /private/tmp/woven-sol.headers \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  https://www.woven.video/api/v1/chat/completions \
  --data '{"model":"openai/gpt-5.6-sol","messages":[{"role":"user","content":"Reply with exactly: ok"}],"reasoning_effort":"medium","max_tokens":32,"stream":false}' \
  > /private/tmp/woven-sol.json

curl -fsS -D /private/tmp/woven-terra.headers \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  https://www.woven.video/api/v1/chat/completions \
  --data '{"model":"openai/gpt-5.6-terra","messages":[{"role":"user","content":"Reply with exactly: ok"}],"reasoning_effort":"medium","max_tokens":32,"stream":false}' \
  > /private/tmp/woven-terra.json

curl -fsS -D /private/tmp/woven-sonnet.headers \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  https://www.woven.video/api/v1/chat/completions \
  --data '{"model":"anthropic/claude-sonnet-5","messages":[{"role":"user","content":"Reply with exactly: ok"}],"reasoning_effort":"high","max_tokens":32,"stream":false}' \
  > /private/tmp/woven-sonnet.json

jq -e '.choices | length > 0' /private/tmp/woven-sol.json
jq -e '.choices | length > 0' /private/tmp/woven-terra.json
jq -e '.choices | length > 0' /private/tmp/woven-sonnet.json
```

Expected: all three requests return HTTP 200 with a choice.

- [ ] **Step 5: Send and fully consume one streaming Sonnet 5 request**

Run:

```bash
curl -fsS -N --max-time 120 -D /private/tmp/woven-sonnet-stream.headers \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  https://www.woven.video/api/v1/chat/completions \
  --data '{"model":"anthropic/claude-sonnet-5","messages":[{"role":"user","content":"Reply with exactly: stream ok"}],"reasoning_effort":"high","max_tokens":32,"stream":true}' \
  > /private/tmp/woven-sonnet-stream.sse

rg -n "data:|\[DONE\]" /private/tmp/woven-sonnet-stream.sse
```

Expected: streamed data is present and the response reaches `[DONE]`.

- [ ] **Step 6: Extract and record the four Woven job IDs**

Run:

```bash
for headers in \
  /private/tmp/woven-sol.headers \
  /private/tmp/woven-terra.headers \
  /private/tmp/woven-sonnet.headers \
  /private/tmp/woven-sonnet-stream.headers; do
  tr -d '\r' < "$headers" | awk 'tolower($1) == "x-woven-job-id:" { print $2 }'
done
```

Expected: four UUIDs. Record them in the private release report; do not record bearer tokens or response content beyond the minimal smoke evidence.

- [ ] **Step 7: Verify all reservations, usage rows, and settlements in Supabase SQL Editor**

Run this exact read-only query within 20 minutes of the smoke requests:

```sql
with smoke_jobs as (
  select *
  from public.generation_jobs
  where type = 'chat'
    and provider = 'vercel-ai-gateway'
    and model in (
      'openai/gpt-5.6-sol',
      'openai/gpt-5.6-terra',
      'anthropic/claude-sonnet-5'
    )
    and created_at >= now() - interval '20 minutes'
)
select
  j.id,
  j.user_id,
  j.model,
  j.status,
  j.reserved_amount_usd_micros,
  j.final_cost_usd_micros,
  j.error,
  j.completed_at,
  count(distinct u.id) as usage_event_count,
  max(u.raw_provider_cost) as raw_provider_cost,
  max(u.charged_amount_usd_micros) as charged_amount_usd_micros,
  array_agg(distinct l.kind order by l.kind) filter (where l.kind is not null) as ledger_kinds
from smoke_jobs j
left join public.usage_events u on u.job_id = j.id
left join public.ledger_entries l
  on l.source = 'job'
 and l.source_id = j.id::text
group by j.id, j.user_id, j.model, j.status,
  j.reserved_amount_usd_micros, j.final_cost_usd_micros,
  j.error, j.completed_at
order by j.created_at;
```

Identify the four recorded job IDs. Each must be `succeeded`, have one usage event, non-null final cost, no error, and ledger kinds containing `reserve` and `settle`. `charged_amount_usd_micros` must equal `final_cost_usd_micros`. Stop and roll back on any stuck reservation, missing usage row, failed settlement, or mismatched charge.

- [ ] **Step 8: Confirm the balance decreased by exactly the settled smoke charges**

Run:

```bash
curl -fsS \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  https://www.woven.video/api/v1/billing/balance \
  > /private/tmp/woven-balance-after-cutover.json

jq '{before: .balance_usd_micros}' /private/tmp/woven-balance-before-cutover.json
jq '{after: .balance_usd_micros}' /private/tmp/woven-balance-after-cutover.json
```

Compare `before - after` with the sum of `final_cost_usd_micros` for the four recorded job IDs from Step 7. They must match exactly unless another transaction for the same test account occurred during the window; if so, reconcile every intervening ledger entry before accepting the result.

- [ ] **Step 9: Verify retired model rejection**

Run:

```bash
for model in \
  openai/gpt-5.5 \
  anthropic/claude-sonnet-4.6 \
  anthropic/claude-opus-4.7; do
  status="$(curl -sS -o /private/tmp/woven-retired-model.json -w '%{http_code}' \
    -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    https://www.woven.video/api/v1/chat/completions \
    --data "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"test\"}],\"max_tokens\":8,\"stream\":false}")"
  test "$status" = "404"
  jq -e '.error.code == "model_not_found"' /private/tmp/woven-retired-model.json
done
```

Expected: every request returns HTTP 404 and `model_not_found`; no job or reservation is created.

- [ ] **Step 10: Verify public copy and inspect production errors**

Run:

```bash
curl -fsS https://www.woven.video/pricing \
  | rg "Claude Sonnet 5|GPT-5.6 Sol|GPT-5.6 Terra|Intro through Aug 31, 2026|From Sep 1, 2026"
curl -fsS https://www.woven.video/ \
  | rg "Claude Sonnet 5|Claude Opus 4.8|GPT-5.6 Sol|GPT-5.6 Terra|Kimi K2.6"
```

Inspect the Vercel production deployment logs for the release interval. There must be no `invalid_model_catalog`, sustained 5xx spike, `usage_settlement_failed`, or reservation-release failure.

---

### Task 8: Close, monitor, or roll back the production release

**Files:**
- Finalize: `.superpowers/sdd/hosted-model-full-cutover-release-report.md`
- Optional on failure: merge/apply `rollback/hosted-model-full-cutover`

**Interfaces:**
- Consumes: all production evidence from Tasks 5-7.
- Produces: an explicit completed or rolled-back release with no ambiguous intermediate state.

- [ ] **Step 1: Apply the completion decision**

Mark the release complete only if all of these are true:

- four migrations recorded remotely;
- five enabled catalog rows and one Kimi default;
- Vercel merge commit is active on the canonical domain;
- authenticated catalog contract is exact;
- four real requests succeeded, including streaming Sonnet 5;
- all four jobs settled with exact ledger reconciliation;
- all three retired IDs return `model_not_found` without creating jobs;
- public pricing/homepage copy is current;
- production logs are clean.

If any item is false, execute the rollback steps instead of marking partial success.

- [ ] **Step 2: Execute the prepared database rollback when required**

Run from the rollback worktree:

```bash
cd /Users/naman/projects/woven-video/.worktrees/rollback-hosted-model-full-cutover
supabase link --project-ref rlhjpovwwsqdeklhnvfl
supabase migration list --linked
supabase db push --linked --dry-run
```

Expected: only `20260715123000_rollback_hosted_model_full_cutover.sql` is pending. Then run:

```bash
supabase db push --linked
supabase migration list --linked
```

Verify the four-row rollback catalog and sole Kimi default with the Task 2 SQL before touching Vercel.

- [ ] **Step 3: Roll Vercel back when code or public-surface behavior is implicated**

Use the recorded pre-release Vercel deployment URL in the Vercel project dashboard and select its production rollback action. Confirm GitHub/Vercel reports the old deployment active and the canonical domain serves the old pricing page/API code.

Do not rewrite Git history or force-push `main`. Follow up by merging the rollback branch so repository migration history matches production, then create a new fix branch for another attempt.

- [ ] **Step 4: Verify rollback end to end**

After rollback, verify:

- GPT-5.5 and Sonnet 4.6 appear in the restored executable catalog;
- Sol, Terra, and Sonnet 5 are disabled;
- Kimi remains the sole default under the new validator, or the old Vercel code serves the restored legacy catalog;
- a small legacy-model request succeeds and settles;
- no reservation from failed cutover smoke tests remains held;
- public pricing matches the active Vercel deployment.

- [ ] **Step 5: Finalize the release report**

Record:

- release and merge SHAs;
- PR, preview, production, and previous deployment URLs;
- production project ref and backup timestamp;
- exact migration dry-run and applied history;
- pre/post catalog query results;
- sanitized Gateway and Woven job IDs/results;
- balance and ledger reconciliation;
- retired-model results;
- production log inspection;
- completion or rollback decision and timestamp;
- any follow-up required for Harness.

Never include bearer tokens, API keys, service-role keys, database passwords, raw prompts, or unrelated user data.

- [ ] **Step 6: Monitor the remainder of the release day**

Check Vercel logs, Supabase `generation_jobs`, `usage_events`, and `ledger_entries`, and support reports for:

- `invalid_model_catalog`;
- retired-ID `model_not_found` volume;
- chat 5xx responses;
- jobs stuck in `queued` or `running`;
- missing settlement or unexpected release entries;
- provider cost or charge anomalies;
- reports from older Harness builds.

Any billing-integrity issue triggers immediate rollback. Expected old-client `model_not_found` alone is recorded as the accepted release consequence unless its impact is larger than the release owner is willing to carry.
