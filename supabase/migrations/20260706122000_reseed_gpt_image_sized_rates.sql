update public.model_pricing_rules
set minimum_charge_usd_micros = 10000,
    metadata = jsonb_set(
      metadata,
      '{pricing_formula}',
      $${
        "type": "gpt_image_sized",
        "size_parameter": "image_size",
        "quality_parameter": "quality",
        "image_parameter": "num_images",
        "provider_rate_usd_by_quality_and_size": {
          "low":    {"standard": "0.01", "large": "0.01", "max": "0.02"},
          "medium": {"standard": "0.07", "large": "0.07", "max": "0.13"},
          "high":   {"standard": "0.27", "large": "0.28", "max": "0.51"}
        }
      }$$::jsonb
    )
where provider = 'fal'
  and model in ('openai/gpt-image-2', 'openai/gpt-image-2/edit')
  and operation = 'image_generation';
