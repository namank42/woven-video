alter table public.model_pricing_rules
  add column catalog_visible boolean not null default true;

comment on column public.model_pricing_rules.catalog_visible is
  'Whether an enabled pricing rule is published in user-facing model catalogs.';

update public.model_pricing_rules as rules
set catalog_visible = false,
    enabled = true,
    metadata = coalesce(rules.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_default', false
    ),
    updated_at = now()
where rules.provider = 'vercel-ai-gateway'
  and rules.operation = 'chat'
  and rules.model = 'moonshotai/kimi-k3';
