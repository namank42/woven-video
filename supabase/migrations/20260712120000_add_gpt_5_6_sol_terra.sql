-- Add GPT-5.6 Sol and Terra to Woven Credits and retire GPT-5.5.
-- Live capabilities and base pricing are enriched from Vercel AI Gateway;
-- final billing continues to settle from Gateway-reported generation cost.

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
  ('vercel-ai-gateway', 'openai/gpt-5.6-sol', 'chat', 'GPT-5.6 Sol', 2000, 1, 100000, jsonb_build_object('provider_model_id', 'openai/gpt-5.6-sol')),
  ('vercel-ai-gateway', 'openai/gpt-5.6-terra', 'chat', 'GPT-5.6 Terra', 2000, 1, 50000, jsonb_build_object('provider_model_id', 'openai/gpt-5.6-terra'))
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    metadata = excluded.metadata,
    enabled = true;

-- Keep the GPT-5.5 row for historical jobs and usage events, but remove it
-- from GET /api/v1/models and reject new chat requests for it.
update public.model_pricing_rules
set enabled = false
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and model = 'openai/gpt-5.5';
