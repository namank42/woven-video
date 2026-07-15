# Hosted Model Selection Policy Design

**Date:** 2026-07-12
**Status:** Approved design - pending written-spec review
**Backend scope:** `woven-video` hosted chat metadata, catalog validation, model response fields, and tests.
**Consumer contract:** Coordinated `woven-harness` live-catalog selection behavior; Harness implementation remains a separate change.

---

## Purpose

Make the live Woven model catalog authoritative not only for available hosted models and reasoning
tiers, but also for automatic default selection and retired-model migration. Harness must not need a
hardcoded Woven model ID or a local Woven replacement table to select Kimi by default or migrate a
saved GPT-5.5 selection to Sol.

BYOK remains intentionally independent. Its local GPT-5.5-to-Sol migration does not consult Woven's
hosted catalog.

## Decisions

- Store selection policy in each enabled hosted chat row's `model_pricing_rules.metadata`.
- Kimi K2.6 is the sole Woven default.
- GPT-5.6 Sol is the sole declared successor to `openai/gpt-5.5`.
- Every enabled hosted model explicitly declares both `is_default` and `replaces_model_ids`; absence
  is invalid rather than an implicit false or empty value.
- Expose both fields at the top level of each `GET /api/v1/models` model object because they describe
  catalog identity and selection, not model capabilities.
- Validate the complete enabled catalog before starting live Gateway enrichment.
- A successful catalog always contains exactly one default and unambiguous replacement claims.
- Invalid selection-policy metadata fails the entire catalog request with
  `500 invalid_model_catalog`; it must never trigger a hardcoded backend fallback.
- Harness uses selection and replacement fields only from the current successful live Woven catalog.
- Keep the existing per-model safe degradation for invalid reasoning metadata. Reasoning controls are
  optional UI capabilities; default and replacement metadata are critical selection policy.
- Do not add chat request-time effort enforcement or model aliases in this revision.
- Keep the API change additive and unversioned; older clients may ignore the new fields.

## Metadata Contract

The resulting enabled hosted chat metadata is:

| Model | `is_default` | `replaces_model_ids` |
| --- | --- | --- |
| `openai/gpt-5.6-sol` | `false` | `["openai/gpt-5.5"]` |
| `openai/gpt-5.6-terra` | `false` | `[]` |
| `anthropic/claude-sonnet-4.6` | `false` | `[]` |
| `anthropic/claude-opus-4.8` | `false` | `[]` |
| `moonshotai/kimi-k2.6` | `true` | `[]` |

Before this unreleased branch ships, revise its pending immutable, idempotent selection-policy
migration to seed the final policy above. It merges these two keys into existing metadata without
replacing `provider_model_id`, reasoning fields, or any unrelated metadata. No follow-up corrective
migration or runtime default override is needed because the pending migration has not shipped.

Replacement IDs use the canonical backend model namespace:

- exact, unprefixed model IDs such as `openai/gpt-5.5`;
- never Harness's internal `woven:` prefix;
- retired or otherwise absent from the enabled hosted catalog.

## Catalog Policy Validator

Create one pure catalog-level validator with a clear boundary: it accepts the enabled model IDs and
their raw metadata, then returns either a complete per-model selection policy or one deterministic
validation failure.

Per-model validation requires:

- the metadata root is a non-null, non-array object;
- `is_default` is explicitly boolean;
- `replaces_model_ids` is explicitly an array;
- every replacement entry is a non-empty string already trimmed to its canonical form;
- replacement IDs do not use the `woven:` prefix;
- a model does not replace itself; and
- a replacement array contains no duplicate IDs.

Cross-catalog validation requires:

- exactly one enabled model has `is_default: true`;
- an enabled model ID does not appear in any replacement array; and
- no replacement ID is claimed by more than one enabled model.

The validator does not infer a default from ordering, display name, model family, replacement claims,
or an existing hardcoded constant. It does not infer replacement claims from disabled database rows.

Run this validator immediately after `listHostedChatModels()` and before `Promise.all()` begins
Gateway lookups. This avoids unnecessary provider calls for a catalog that cannot be used safely.

## API Contract

Every successful model object adds:

```json
{
  "id": "moonshotai/kimi-k2.6",
  "is_default": true,
  "replaces_model_ids": []
}
```

Sol is returned separately with `is_default: false` and
`replaces_model_ids: ["openai/gpt-5.5"]`.

The complete response remains an authenticated OpenAI-style list:

```json
{
  "object": "list",
  "data": [
    {
      "id": "moonshotai/kimi-k2.6",
      "object": "model",
      "created": 0,
      "owned_by": "woven",
      "display_name": "Kimi K2.6",
      "is_default": true,
      "replaces_model_ids": [],
      "capabilities": {},
      "pricing": {}
    }
  ]
}
```

Gateway capability failure does not remove or alter `is_default` or `replaces_model_ids`. As with the
existing reasoning contract, backend-owned policy remains available while live-only capability fields
degrade and `pricing` becomes `null`.

## Error Handling

When catalog policy is missing, malformed, or contradictory, return HTTP 500:

```json
{
  "error": {
    "code": "invalid_model_catalog",
    "type": "invalid_model_catalog",
    "message": "Hosted model catalog metadata is invalid."
  }
}
```

Log `console.error("[model-catalog] invalid selection policy", { reason })`, where the deterministic
reason names the relevant model IDs when applicable. Do not expose database metadata or operational
detail in the API response.

Examples that fail the whole request:

- no enabled default;
- two enabled defaults;
- one enabled row missing either policy field;
- non-array or non-string replacement data;
- Sol replacing itself;
- Sol claiming Terra while Terra is enabled;
- Sol and Terra both claiming GPT-5.5; or
- a `woven:openai/gpt-5.5` replacement ID.

Do not begin Gateway enrichment after a policy failure. Authentication and database-listing failures
continue to use their existing behavior.

Invalid reasoning metadata remains different: the affected model is still returned with
`supports_reasoning: false`, `supported_reasoning_efforts: []`, and
`default_reasoning_effort: null`, provided the catalog selection policy itself is valid.

## Harness Consumer Contract

Harness may use `is_default` and `replaces_model_ids` only after a current live Woven catalog refresh
succeeds. Static fallback entries and cached catalog metadata are not authoritative for automatic
selection or migration.

Resolve a Woven selection in this order:

1. If the saved Woven model ID exists in the live catalog, retain it.
2. Otherwise, if exactly one live model contains the saved ID in `replaces_model_ids`, migrate to that
   live model.
3. If no saved selection exists, or a missing saved ID has no declared successor, select the sole live
   model with `is_default: true`.
4. If the live response has zero or multiple defaults, duplicate replacement claims, or another
   contradictory policy, block automatic Woven selection.

Harness should validate the successful response defensively even though the backend rejects invalid
catalogs. It must not substitute a hardcoded Woven ID when policy is absent or contradictory.

For the current rollout:

- a saved `openai/gpt-5.5` or internal `woven:openai/gpt-5.5` selection normalizes to the backend ID,
  matches Sol's replacement claim, and migrates to Sol;
- a new Woven user selects Kimi from the live `is_default` field;
- an unknown missing Woven model with no successor selects Kimi as the sole live backend default; and
- BYOK keeps its local GPT-5.5-to-Sol migration and does not read Woven catalog policy.

## Data Flow

1. An authenticated Harness client requests `GET /api/v1/models`.
2. Woven loads all enabled hosted chat rows.
3. Woven validates every row's explicit selection policy and the complete catalog invariants.
4. On failure, Woven logs the internal reason and returns `500 invalid_model_catalog` without Gateway
   calls.
5. On success, Woven performs Gateway capability and pricing enrichment.
6. Woven returns each model with backend-owned selection policy and reasoning metadata plus live
   Gateway fields.
7. Harness defensively confirms exactly one default and unambiguous replacement claims.
8. Harness retains, migrates, or defaults the saved Woven selection using only that live response.

## Testing

Backend implementation proceeds test-first and includes:

1. A migration source-contract test proving the exact five model rows, sole Kimi default, sole
   GPT-5.5 replacement claim on Sol, metadata merge, and provider/operation scope.
2. Catalog validator unit tests covering the exact valid catalog and every per-model and cross-catalog
   invalid case listed above.
3. Model route tests proving successful top-level response fields, exactly one returned default,
   Gateway-failure preservation, and unchanged reasoning degradation.
4. Route tests proving invalid policy returns `500 invalid_model_catalog`, logs the internal reason,
   and never calls `getModelCapabilities()`.
5. Focused tests, the complete `pnpm test` suite, `pnpm build`, `supabase db reset`, exact persisted-row
   verification, and `git diff --check`.

Coordinated Harness acceptance tests cover:

1. retaining an existing live Woven selection;
2. migrating saved GPT-5.5 to Sol from the live replacement claim;
3. selecting Kimi for a new Woven user from the sole live default;
4. selecting the live default for an unclaimed missing Woven model;
5. blocking selection for missing or contradictory policy;
6. refusing to use static or cached policy for automatic selection;
7. preserving the independent BYOK GPT-5.5-to-Sol migration; and
8. continuing to route hosted Sol/Terra IDs through the existing Woven execution path.

## Rollout

1. Apply the reasoning-effort migration and the new selection-policy migration.
2. Deploy the backend route and validate the authenticated production catalog contains exactly one
   default, that the default is Kimi, and that Sol retains the GPT-5.5 replacement claim.
3. Smoke-test Sol and Terra chat plus the existing billing settlement checks.
4. Ship the coordinated Harness patch.
5. Verify a saved Woven GPT-5.5 selection migrates to Sol after a successful live refresh and BYOK's
   local migration still works without the Woven catalog.

The fields are additive, so older Harness versions ignore them. The new Harness version must not make
the policy mandatory until the backend migration and route are deployed.

## Out of Scope

- BYOK catalog or selection policy changes.
- Removing BYOK's local GPT-5.5-to-Sol migration.
- Backend aliases that accept GPT-5.5 chat requests.
- Request-time reasoning-effort enforcement.
- Database columns or constraints for catalog policy; route validation remains the required
  exactly-one-default enforcement boundary.
- Static fallback or cached catalog policy becoming authoritative.
- Automatic multi-hop replacement chains.
- A general model-family or provider migration framework.

## Risks

- **Catalog outage from bad metadata:** Fail-closed behavior is intentional. Migration and route tests
  must verify the full enabled set before deployment, and the structured log must identify the
  invalid invariant quickly.
- **Prefix mismatch:** Harness stores `woven:` IDs internally while backend replacement IDs are
  unprefixed. Harness must normalize before comparing and restore its internal prefix after choosing
  the live model.
- **Stale catalog use:** Cached or fallback policy could silently select an obsolete model. Automatic
  Woven selection requires the current successful live response.
- **Ambiguous replacement claims:** Backend and Harness both validate uniqueness so one retired ID can
  never resolve to multiple live successors.
- **Rollout ordering:** Harness must retain compatibility with the pre-policy backend until the new
  backend response is deployed, then switch automatic Woven selection to the live policy fields.
