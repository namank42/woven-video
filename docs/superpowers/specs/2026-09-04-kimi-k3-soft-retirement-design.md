# Kimi K3 Soft Retirement Design

## Goal

Remove Kimi K3 from new Woven model selection because its output quality is no
longer acceptable, while protecting desktop sessions that loaded the old model
catalog and can continue sending Kimi until they refresh.

GPT-5.6 Luna remains the sole hosted default. Historical Kimi jobs, usage, and
billing records remain intact.

## Product Decisions

- Hide Kimi from newly fetched catalogs immediately after the Phase 1 release.
- Keep stale Kimi requests working during a compatibility period.
- Use a minimum seven-day grace period.
- Require 48 consecutive hours with no Kimi generation jobs before final disablement.
- Review and apply final disablement manually. No cron job mutates model availability.
- Do not silently execute Luna when a client requests Kimi. Job identity, provider
  cost, and user-visible model selection must remain truthful.
- Do not delete the Kimi pricing rule or any historical data.

## Current Behavior

`public.model_pricing_rules.enabled` currently controls both discovery and
admission:

- `listHostedChatModels()` returns enabled chat rules to `GET /api/v1/models`.
- `getHostedChatModel()` admits an exact enabled model for
  `POST /api/v1/chat/completions`.

Harness fetches the hosted catalog on launch, after Woven sign-in, or after a
manual catalog retry. It does not poll, refresh when opening the picker, refresh
on foreground, or revalidate against the server before each send. A continuously
running app can therefore retain Kimi in memory after the backend catalog changes.

When a refreshed catalog omits a selected model, Harness resolves the missing
selection through explicit replacement metadata and then through the sole backend
default. During the compatibility period, a missing Kimi selection therefore
falls back to Luna even before Kimi becomes an explicit Luna replacement.

## Architecture

Separate model discovery from request admission with a typed column:

```sql
catalog_visible boolean not null default true
```

The resulting policy is:

| State | `enabled` | `catalog_visible` | Picker | Direct request |
|---|---:|---:|---|---|
| Available | true | true | Visible | Accepted |
| Compatibility only | true | false | Hidden | Accepted |
| Retired | false | false | Hidden | Rejected |

`enabled` remains the universal request-admission kill switch. No model-specific
exception may bypass it.

## Phase 1: Soft Hide

### Database

Add `catalog_visible` to `model_pricing_rules` with a true default so every
existing model preserves current behavior. Set Kimi K3 to:

- `enabled = true`
- `catalog_visible = false`
- `metadata.is_default = false`

Luna remains enabled, visible, and the sole default.

Do not add Kimi to Luna's `replaces_model_ids` in Phase 1. Migrations are applied
before web code. During that deployment interval, the old catalog query still
ignores `catalog_visible` and returns Kimi. If Luna simultaneously claimed Kimi
as replaced, the current selection-policy validator would reject the response
because a returned model cannot also be a replacement target.

### Backend

Extend `ModelPricingRule` and both database selects with `catalog_visible`.

`listHostedChatModels()` filters:

```text
provider = vercel-ai-gateway
operation = chat
enabled = true
catalog_visible = true
```

`getHostedChatModel()` continues to filter only on `enabled = true`. It reads the
new column for a complete typed rule but does not use it for admission.

The catalog route and chat proxy require no model-specific Kimi branch.

### User Behavior

- A client fetching after Phase 1 sees Luna but not Kimi.
- An active or saved Kimi selection on that client resolves to Luna.
- A client that has not refreshed can still display and send Kimi successfully.
- A stale Kimi request is billed under the actual Kimi rule and recorded as Kimi.

## Compatibility Gate

Let `T0` be the production deployment time of the Phase 1 web change. Phase 2 is
eligible only when both conditions are true:

1. At least seven full days have elapsed since `T0`.
2. No `generation_jobs` row for `moonshotai/kimi-k3` was created in the preceding
   48 hours.

The final check uses job creation rather than successful usage because it captures
all admitted attempts, including failed or cancelled runs.

Representative production query:

```sql
select
  max(created_at) as last_kimi_job_at,
  count(*) filter (where created_at >= now() - interval '48 hours') as jobs_last_48h
from public.generation_jobs
where provider = 'vercel-ai-gateway'
  and model = 'moonshotai/kimi-k3';
```

If either condition fails, leave Phase 1 in place and check again later. There is
no automatic deadline and no automatic database mutation.

## Phase 2: Hard Disable

Apply a separate reviewed migration that atomically:

1. Sets Kimi K3 `enabled = false` and keeps `catalog_visible = false`.
2. Clears Kimi's `replaces_model_ids` ownership.
3. Adds both `moonshotai/kimi-k3` and `moonshotai/kimi-k2.6` to Luna's
   `replaces_model_ids`.
4. Preserves Luna as the sole visible default.

Explicit replacement metadata makes saved Kimi selections continue resolving to
Luna even if the hosted default changes later.

Do not create or merge the Phase 2 migration during Phase 1. The release process
applies every pending migration, so preparing it early could disable Kimi before
the compatibility gate passes. Create the migration only after the manual gate is
approved.

After Phase 2, a client still holding an in-memory Kimi catalog receives
`404 model_not_found` before job creation, reservation, provider execution, or
billing. Current Harness builds surface this as a generic agent-step failure.
The seven-day and zero-traffic gates reduce but cannot eliminate the edge case of
an app left open and unused throughout the grace period.

## Public Pricing And Copy

During Phase 1, keep Kimi's public rate row because compatibility requests remain
billable, but label it `Legacy compatibility only`. Remove Kimi from copy that
describes models available for new selection and ensure Luna is listed.

After Phase 2, remove Kimi's public rate row. Historical charges continue to use
the immutable ledger and usage records rather than the marketing table.

## Testing

### Database and query contracts

- Existing rows default to `catalog_visible = true`.
- Phase 1 leaves Kimi enabled but sets it invisible.
- Catalog listing requires visibility and admission.
- Exact chat lookup ignores visibility but still requires admission.
- The visible catalog contains exactly one default: Luna.
- No migration deletes a pricing rule.

### Route behavior

- `GET /api/v1/models` omits invisible Kimi.
- A bare or `woven:` Kimi chat request remains accepted during Phase 1.
- A Kimi request returns `404 model_not_found` before job creation after Phase 2.
- Luna requests continue to stream and settle normally in both phases.

### Harness compatibility

- A catalog without Kimi decodes successfully.
- Active and saved Kimi selections resolve to Luna after refresh.
- Existing Kimi context-window and Sidecar execution support remains during Phase 1.

### Production checks

- Verify the persisted visibility/admission flags after each migration.
- Call the authenticated production catalog and confirm Luna is the sole default.
- During Phase 1, run one controlled Kimi compatibility request and confirm the
  job and usage identify Kimi.
- Record `T0` and the final traffic-gate query result before Phase 2.
- After Phase 2, confirm a Kimi request is rejected without creating a job.

## Deployment Order

### Phase 1

1. Apply the additive column and Kimi visibility migration.
2. Deploy backend query changes and public pricing/copy changes.
3. Verify the production catalog and one controlled stale-client Kimi request.
4. Record `T0` and begin traffic observation.

Applying the migration first is safe: the old web code ignores the new column and
continues current behavior until the new catalog filter deploys.

### Phase 2

1. Confirm seven days elapsed and the 48-hour Kimi job count is zero.
2. Create and review the final disable/replacement migration.
3. Apply the final migration.
4. Deploy removal of the legacy pricing row.
5. Verify Kimi rejection, Luna replacement metadata, and no new Kimi job creation.

## Rollback

Phase 1 rollback is a fix-forward migration setting Kimi
`catalog_visible = true`. Admission remains enabled, so no request-path rollback
is required.

Phase 2 rollback is a fix-forward migration restoring Kimi to `enabled = true`
and restoring non-conflicting replacement ownership before making it visible.
Do not delete migration history or historical billing rows.
