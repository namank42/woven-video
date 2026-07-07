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
  'fal',
  'woven-launch-placeholder',
  'video_generation',
  'Launch placeholder video',
  2000,
  100000,
  500000,
  false,
  '{
    "public_id": "fal:launch-placeholder-video",
    "provider_endpoint": "fal-ai/woven-launch-placeholder",
    "kind": "video",
    "supports_uploaded_inputs": false,
    "supported_input_types": [],
    "output_types": ["video"],
    "pricing_unit": "job",
    "default_parameters": {},
    "parameter_schema": {
      "type": "object",
      "required": ["prompt"],
      "properties": {
        "prompt": { "type": "string" }
      }
    },
    "fal_output_paths": [
      { "path": "video", "type": "video" }
    ],
    "fal_allow_generic_url_fallback": false,
    "launch_placeholder": true
  }'::jsonb
)
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    enabled = false,
    metadata = excluded.metadata,
    updated_at = now();
