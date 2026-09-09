update public.model_pricing_rules
set enabled = false,
    catalog_visible = false,
    metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'is_default', false
        ),
    updated_at = now()
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and model like 'anthropic/%';
