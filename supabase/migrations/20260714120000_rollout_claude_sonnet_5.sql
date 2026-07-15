-- Roll out Claude Sonnet 5 and complete backend-owned Anthropic retirement policy.

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
  'anthropic/claude-sonnet-5',
  'chat',
  'Claude Sonnet 5',
  2000,
  1,
  50000,
  true,
  jsonb_build_object(
    'provider_model_id', 'anthropic/claude-sonnet-5',
    'supports_reasoning', true,
    'supported_reasoning_efforts', '["low", "medium", "high", "xhigh", "max"]'::jsonb,
    'default_reasoning_effort', 'high',
    'is_default', false,
    'replaces_model_ids', '["anthropic/claude-sonnet-4.6"]'::jsonb
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

update public.model_pricing_rules
set enabled = false,
    updated_at = now()
where provider = 'vercel-ai-gateway'
  and model = 'anthropic/claude-sonnet-4.6'
  and operation = 'chat';

update public.model_pricing_rules as rules
set metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', false,
      'replaces_model_ids', '["anthropic/claude-opus-4.7"]'::jsonb
    ),
    updated_at = now()
where rules.provider = 'vercel-ai-gateway'
  and rules.model = 'anthropic/claude-opus-4.8'
  and rules.operation = 'chat';
