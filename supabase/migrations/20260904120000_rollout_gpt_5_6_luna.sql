-- Add GPT-5.6 Luna as the hosted default while retaining Kimi K3 as a selectable model.
-- Gateway supplies live capabilities and base pricing; billing settles from reported cost.

insert into public.model_pricing_rules as rules (
  provider,
  model,
  operation,
  display_name,
  markup_bps,
  minimum_charge_usd_micros,
  reserve_amount_usd_micros,
  enabled,
  metadata
)
values (
  'vercel-ai-gateway',
  'openai/gpt-5.6-luna',
  'chat',
  'GPT-5.6 Luna',
  2000,
  1,
  50000,
  true,
  jsonb_build_object(
    'provider_model_id', 'openai/gpt-5.6-luna',
    'supports_reasoning', true,
    'supported_reasoning_efforts', '["low", "medium", "high", "xhigh", "max"]'::jsonb,
    'default_reasoning_effort', 'medium',
    'is_default', true,
    'replaces_model_ids', '[]'::jsonb
  )
)
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    enabled = true,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.model_pricing_rules as rules
set metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', false
    ),
    updated_at = now()
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = 'moonshotai/kimi-k3';
