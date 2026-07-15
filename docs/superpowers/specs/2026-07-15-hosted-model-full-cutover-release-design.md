# Hosted Model Full Cutover Release Design

## Decision

Release the complete hosted-model backend before the compatible Harness release is finished.

This is an intentionally breaking cutover for older desktop builds. As soon as the production database migrations apply, direct Woven-credit requests for `openai/gpt-5.5` and `anthropic/claude-sonnet-4.6` may return `model_not_found`. The user has accepted that risk because the current user base is small. No compatibility alias, silent execution remap, or adoption wait will be introduced.

The release unit is the verified `feat/gpt-5-6-sol-terra-credits` branch, whose implementation was independently reviewed at `84f7a84`. Release documentation commits may advance the branch head without changing runtime behavior.

## Production Outcome

After cutover, the enabled Vercel AI Gateway chat catalog is exactly:

- `openai/gpt-5.6-sol`
- `openai/gpt-5.6-terra`
- `anthropic/claude-sonnet-5`
- `anthropic/claude-opus-4.8`
- `moonshotai/kimi-k2.6`

Kimi is the sole default. Sol replaces `openai/gpt-5.5`; Sonnet 5 replaces `anthropic/claude-sonnet-4.6`; Opus 4.8 replaces `anthropic/claude-opus-4.7`; Terra has no replacement claim. GPT-5.5, Sonnet 4.6, and Opus 4.7 are disabled and hidden from the live catalog.

The API contract, public pricing, homepage FAQ/JSON-LD, and current billing documentation deploy together with the migrations.

## Release Architecture

Production has two independently deployed state surfaces:

1. Supabase owns model availability, selection/replacement metadata, reasoning metadata, pricing rules, jobs, usage, and ledger data.
2. Vercel owns the `/api/v1/models` validator/serializer, chat admission and forwarding, and public website/pricing code.

`main` is connected to Vercel through GitHub. Merging the approved PR begins production deployment automatically. The locally installed Supabase CLI is linked separately and applies database migrations explicitly.

The database cutover must happen before the PR merge. Deploying the new API code against unmigrated rows can make `/api/v1/models` fail closed with `invalid_model_catalog`. Applying the migrations first leaves the previous API code able to read the new enabled rows during the short interval before Vercel finishes. Retired IDs begin returning `model_not_found` at the database cutover; that is the accepted breaking point.

## Preflight Gates

No production mutation begins until all gates pass:

1. The feature worktree is clean and contains only the reviewed release commits plus release documentation.
2. The complete test suite, focused catalog/pricing suite, production build, and `git diff --check` pass from the final release commit.
3. The feature branch is pushed and has an approved PR against current `origin/main` with no unexpected merge delta.
4. Vercel's PR/preview deployment succeeds.
5. The Supabase CLI is authenticated and linked to the intended production project.
6. `supabase migration list` has no unexplained local/remote history mismatch.
7. `supabase db push --dry-run` lists exactly the expected pending migrations and no unrelated migration.
8. Current production model rows, enabled/default counts, and relevant metadata are captured before cutover.
9. A recent production backup is confirmed. If managed backup evidence is unavailable, take an explicit schema/data dump or stop.
10. Direct Vercel AI Gateway smoke tests recognize Sol, Terra, and Sonnet 5, including Sonnet 5 adaptive thinking and the reviewed effort values.
11. A funded production smoke-test account and bearer token are available without printing secrets.
12. A rollback branch or exact forward-migration template is prepared and locally tested before cutover.

## Production Sequence

Once the release owner declares the window open:

1. Freeze the PR and record the exact release commit, current production `main` commit, current Vercel deployment, and linked Supabase project.
2. Run one final migration dry-run and compare it with the approved pending-migration list.
3. Apply the pending production migrations with `supabase db push`.
4. Immediately query the unrestricted production Gateway chat catalog. It must contain exactly five enabled rows, exactly one default, and the exact successor/reasoning contract.
5. If the database state is wrong, do not merge the PR. Execute the prepared forward rollback path.
6. Merge the approved PR to `main`. GitHub triggers the Vercel production deployment.
7. Wait for the Vercel status on the merge commit to succeed and confirm the production domain resolves to that deployment.
8. Run all post-deploy smoke checks before declaring the release complete.

No unrelated migration, application change, environment change, Harness release, or announcement is combined with this window.

## Production Smoke Checks

### Catalog

- Authenticated `GET /api/v1/models` returns HTTP 200.
- It returns exactly five unique canonical model IDs.
- Kimi is the sole `is_default: true` model.
- Replacement arrays are exact and use canonical non-`woven:` IDs.
- Sonnet 5 publishes `low`, `medium`, `high`, `xhigh`, and `max` in order, with `high` as default.

### Execution and Billing

- Send one small non-streaming request through Sol, Terra, and Sonnet 5.
- Send one small streaming Sonnet 5 request with a reviewed reasoning effort.
- Confirm each request uses the requested exact model with no compatibility remap.
- Confirm each successful request creates a completed job, usage event, reservation debit, settlement adjustment, and expected final balance.
- Confirm failed smoke requests release their reservations.

### Retirement and Public Surface

- GPT-5.5, Sonnet 4.6, and Opus 4.7 return `model_not_found` through hosted chat.
- `/pricing` shows Sol, Terra, Sonnet 5, Opus 4.8, and Kimi with the approved values and dates.
- Homepage FAQ and JSON-LD name Sonnet 5 rather than Sonnet 4.6.
- Production logs show no new catalog 500s, settlement errors, or sustained 5xx spike.

## Rollback Design

Rollback is forward-only for database state. Do not edit a migration recorded in production or use migration-history repair as a normal rollback.

The prepared rollback migration must:

- re-enable `openai/gpt-5.5` and `anthropic/claude-sonnet-4.6`;
- disable Sol, Terra, and Sonnet 5 if the new catalog itself is the failure source;
- clear replacement claims that target any re-enabled model;
- retain Kimi as the sole default;
- preserve Opus 4.8 and the already-retired Opus 4.7 policy unless evidence identifies it as part of the failure;
- preserve unrelated metadata and historical billing rows.

Rollback order depends on failure location:

1. If migration application fails before the PR merge, leave Vercel on the old deployment and restore catalog data with the forward rollback migration if any cutover statements committed.
2. If the Vercel build fails, Git-connected Vercel should retain the previous production deployment. Restore catalog data first so old clients work again.
3. If the new deployment has runtime defects, apply the forward catalog rollback, then roll Vercel back to the previously recorded production deployment if the code change is implicated.
4. Re-run catalog, request, reservation, settlement, and public-surface smoke checks after rollback.

## Monitoring and Completion

Monitor production through the remainder of the release day for:

- `invalid_model_catalog` responses;
- `model_not_found` volume for retired IDs;
- chat 5xx responses;
- stuck reserved jobs or missing settlement entries;
- provider/model cost anomalies;
- support reports from older desktop builds.

The release is complete only when database state, Vercel deployment status, authenticated catalog output, real execution, billing settlement, retirement behavior, and public pricing all pass. A successful migration or Vercel build alone is not sufficient.

## Out of Scope

- Releasing Harness in the same window.
- Waiting for an adoption percentage.
- Compatibility aliases or billing one model as another.
- Destructive removal of historical model rows or billing records.
- Editing a production-recorded migration.
- Unrelated product, pricing, environment, or infrastructure changes.

## Documentation Basis

The command-level plan must use [`2026-07-15-hosted-model-full-cutover-release-docs.md`](../research/2026-07-15-hosted-model-full-cutover-release-docs.md) for current Supabase and Vercel deployment behavior.
