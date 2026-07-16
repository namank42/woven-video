-- Forward-only emergency rollback for the Kimi K3 hosted cutover.
-- Restore K2.6 execution while preserving both model rows and all history.

with rollback_policy(model, enabled, is_default, replaces_model_ids) as (
  values
    ('moonshotai/kimi-k3', false, false, '[]'::jsonb),
    ('moonshotai/kimi-k2.6', true, true, '["moonshotai/kimi-k3"]'::jsonb)
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
