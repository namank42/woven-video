update public.model_pricing_rules
set enabled = false,
    updated_at = now()
where provider = 'vercel-ai-gateway'
  and operation = 'chat'
  and model in (
    'anthropic/claude-haiku-4.5',
    'xai/grok-4.3'
  );
