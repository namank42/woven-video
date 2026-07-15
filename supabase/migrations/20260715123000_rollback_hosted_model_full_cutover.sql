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
