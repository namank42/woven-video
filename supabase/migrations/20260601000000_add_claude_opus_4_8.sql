-- Add Claude Opus 4.8 to the hosted catalog and retire Opus 4.7.
-- Opus 4.8 is the same price tier as 4.7 ($5/$25 base, 20% markup); context
-- length + reasoning support come from the Vercel AI Gateway dynamically.

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
    'anthropic/claude-opus-4.8',
    'chat',
    'Claude Opus 4.8',
    2000,
    1,
    100000,
    jsonb_build_object('provider_model_id', 'anthropic/claude-opus-4.8')
  )
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    metadata = excluded.metadata,
    enabled = true;

-- Retire Opus 4.7 from the offered catalog. The row stays for billing history;
-- flipping `enabled` hides it from GET /api/v1/models. Desktop clients
-- reconcile a persisted 4.7 selection to 4.8 (handled in the desktop repo).
-- (updated_at is maintained by the set_model_pricing_rules_updated_at trigger.)
update public.model_pricing_rules
set enabled = false
where provider = 'vercel-ai-gateway'
  and model = 'anthropic/claude-opus-4.7'
  and operation = 'chat';
