-- Publish reviewed, model-specific reasoning controls through GET /api/v1/models.
-- Gateway exposes only generic reasoning support, so exact selectable tiers and
-- defaults live in model_pricing_rules.metadata.

with reasoning_contract(model, efforts, default_effort) as (
  values
    ('openai/gpt-5.6-sol', '["low", "medium", "high", "xhigh", "max"]'::jsonb, 'medium'),
    ('openai/gpt-5.6-terra', '["low", "medium", "high", "xhigh", "max"]'::jsonb, 'medium'),
    ('anthropic/claude-sonnet-4.6', '["low", "medium", "high", "max"]'::jsonb, 'high'),
    ('anthropic/claude-opus-4.8', '["low", "medium", "high", "xhigh", "max"]'::jsonb, 'high'),
    ('moonshotai/kimi-k2.6', '[]'::jsonb, null)
)
update public.model_pricing_rules as rules
set metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'supports_reasoning', true,
      'supported_reasoning_efforts', contract.efforts,
      'default_reasoning_effort', contract.default_effort
    ),
    updated_at = now()
from reasoning_contract as contract
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = contract.model;
