-- Replace Kimi K2.6 with Kimi K3 as the sole hosted default while preserving
-- historical rows and unrelated provider, reasoning, and selection metadata.

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
  'moonshotai/kimi-k3',
  'chat',
  'Kimi K3',
  2000,
  1,
  50000,
  true,
  jsonb_build_object(
    'provider_model_id', 'moonshotai/kimi-k3',
    'supports_reasoning', true,
    'supported_reasoning_efforts', '[]'::jsonb,
    'default_reasoning_effort', null,
    'is_default', true,
    'replaces_model_ids', '["moonshotai/kimi-k2.6"]'::jsonb
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
set enabled = false,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', false,
      'replaces_model_ids', '[]'::jsonb
    ),
    updated_at = now()
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = 'moonshotai/kimi-k2.6';
