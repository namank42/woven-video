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
values
  (
    'fal',
    'google/nano-banana-2-lite',
    'image_generation',
    'Nano Banana 2 Lite',
    2000,
    0,
    47760,
    true,
    $${"public_id": "google/nano-banana-2-lite", "provider_endpoint": "google/nano-banana-2-lite", "kind": "image", "supports_uploaded_inputs": false, "supported_input_types": [], "output_types": ["image"], "pricing_unit": "job", "default_parameters": {"num_images": 1, "aspect_ratio": "auto", "output_format": "png", "safety_tolerance": "4", "sync_mode": false, "system_prompt": "", "limit_generations": true}, "parameter_schema": {"type": "object", "required": ["prompt"], "additionalProperties": false, "properties": {"prompt": {"type": "string", "minLength": 3, "maxLength": 50000}, "num_images": {"type": "integer", "minimum": 1, "maximum": 4, "default": 1}, "seed": {"type": "integer"}, "aspect_ratio": {"type": "string", "enum": ["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "4:1", "1:4", "8:1", "1:8"], "default": "auto"}, "output_format": {"type": "string", "enum": ["jpeg", "png", "webp"], "default": "png"}, "safety_tolerance": {"type": "string", "enum": ["1", "2", "3", "4", "5", "6"], "default": "4"}, "sync_mode": {"type": "boolean", "default": false}, "system_prompt": {"type": "string", "maxLength": 50000, "default": ""}, "limit_generations": {"type": "boolean", "default": true}, "thinking_level": {"type": "string", "enum": ["minimal", "high"]}}}, "input_asset_schema": {"roles": []}, "pricing_formula": {"type": "nano_banana", "image_parameter": "num_images", "provider_rate_usd_per_image": "0.0398"}, "fal_output_paths": [{"path": "images", "type": "image"}], "fal_allow_generic_url_fallback": false}$$::jsonb
  ),
  (
    'fal',
    'google/nano-banana-2-lite/edit',
    'image_generation',
    'Nano Banana 2 Lite Edit',
    2000,
    0,
    47760,
    true,
    $${"public_id": "google/nano-banana-2-lite/edit", "provider_endpoint": "google/nano-banana-2-lite/edit", "kind": "image", "supports_uploaded_inputs": true, "supported_input_types": ["image"], "output_types": ["image"], "pricing_unit": "job", "default_parameters": {"num_images": 1, "aspect_ratio": "auto", "output_format": "png", "safety_tolerance": "4", "sync_mode": false, "system_prompt": "", "limit_generations": true}, "parameter_schema": {"type": "object", "required": ["prompt"], "additionalProperties": false, "properties": {"prompt": {"type": "string", "minLength": 3, "maxLength": 50000}, "num_images": {"type": "integer", "minimum": 1, "maximum": 4, "default": 1}, "seed": {"type": "integer"}, "aspect_ratio": {"type": "string", "enum": ["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "3:4", "1:1", "2:3", "9:16", "4:1", "1:4", "8:1", "1:8"], "default": "auto"}, "output_format": {"type": "string", "enum": ["jpeg", "png", "webp"], "default": "png"}, "safety_tolerance": {"type": "string", "enum": ["1", "2", "3", "4", "5", "6"], "default": "4"}, "sync_mode": {"type": "boolean", "default": false}, "system_prompt": {"type": "string", "maxLength": 50000, "default": ""}, "limit_generations": {"type": "boolean", "default": true}, "thinking_level": {"type": "string", "enum": ["minimal", "high"]}}}, "input_asset_schema": {"roles": [{"role": "reference_images", "provider_field": "image_urls", "media_kind": "image", "required": true, "min": 1, "max": 4, "content_type_prefixes": ["image/"]}]}, "pricing_formula": {"type": "nano_banana", "image_parameter": "num_images", "provider_rate_usd_per_image": "0.0398"}, "fal_output_paths": [{"path": "images", "type": "image"}], "fal_allow_generic_url_fallback": false}$$::jsonb
  )
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    enabled = excluded.enabled,
    metadata = excluded.metadata,
    updated_at = now();

update public.model_pricing_rules
set enabled = false,
    metadata = metadata
      || jsonb_build_object(
        'superseded_by',
        case
          when model = 'fal-ai/nano-banana-lite' then 'google/nano-banana-2-lite'
          when model = 'fal-ai/nano-banana-lite/edit' then 'google/nano-banana-2-lite/edit'
          else null
        end
      ),
    updated_at = now()
where provider = 'fal'
  and operation = 'image_generation'
  and model in (
    'fal-ai/nano-banana-lite',
    'fal-ai/nano-banana-lite/edit'
  );
