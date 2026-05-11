insert into public.model_pricing_rules (
  provider,
  model,
  operation,
  display_name,
  markup_bps,
  minimum_charge_usd_micros,
  reserve_amount_usd_micros,
  metadata
)
values
  (
    'vercel-ai-gateway',
    'xai/grok-4.3',
    'chat',
    'Grok 4.3',
    2000,
    1,
    50000,
    jsonb_build_object('provider_model_id', 'xai/grok-4.3')
  )
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    metadata = excluded.metadata,
    enabled = true;
