update public.model_pricing_rules
set minimum_charge_usd_micros = 0,
    reserve_amount_usd_micros = 47760,
    metadata = jsonb_set(
      metadata,
      '{pricing_formula,provider_rate_usd_per_image}',
      '"0.0398"'::jsonb,
      true
    ),
    updated_at = now()
where provider = 'fal'
  and operation = 'image_generation'
  and model in (
    'fal-ai/nano-banana-lite',
    'fal-ai/nano-banana-lite/edit'
  );
