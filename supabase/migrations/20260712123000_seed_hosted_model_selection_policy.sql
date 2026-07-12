-- Make the live hosted catalog authoritative for default selection and
-- retired-model migration without replacing provider or reasoning metadata.

with selection_policy(model, is_default, replaces_model_ids) as (
  values
    ('openai/gpt-5.6-sol', true, '["openai/gpt-5.5"]'::jsonb),
    ('openai/gpt-5.6-terra', false, '[]'::jsonb),
    ('anthropic/claude-sonnet-4.6', false, '[]'::jsonb),
    ('anthropic/claude-opus-4.8', false, '[]'::jsonb),
    ('moonshotai/kimi-k2.6', false, '[]'::jsonb)
)
update public.model_pricing_rules as rules
set metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', policy.is_default,
      'replaces_model_ids', policy.replaces_model_ids
    ),
    updated_at = now()
from selection_policy as policy
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = policy.model;
