insert into public.model_pricing_rules (
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
  'elevenlabs',
  'scribe_v2',
  'reel_captions',
  'Auto captions',
  0,
  10000,
  10000,
  true,
  '{
    "billing_unit": "audio_second",
    "public_rate_usd_per_minute": 0.01,
    "provider_rate_usd_per_hour": 0.40,
    "provider": "ElevenLabs Scribe v2",
    "minimum_charge_usd": 0.01
  }'::jsonb
)
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    enabled = excluded.enabled,
    metadata = excluded.metadata,
    updated_at = now();
