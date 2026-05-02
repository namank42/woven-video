-- Seed pricing rules for hosted web tools (search + fetch via Exa).
--
-- Flat per-call pricing: reserve = minimum_charge = expected charge, since
-- these tools have fixed cost per invocation (no token-based variance).
-- Settlement passes the same amount as the reservation, producing a $0
-- adjustment ledger entry. Markup matches chat at 20% (markup_bps = 2000).
--
-- Raw cost basis (verify in Exa billing as usage builds):
--   search: 1 search + 5 content extractions ≈ $0.010
--   fetch:  1 livecrawled content extraction ≈ $0.005
-- Charged: raw × 1.20 = $0.012 search, $0.006 fetch.

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
    'exa',
    'exa/search',
    'search',
    'Web Search',
    2000,
    12000,
    12000,
    jsonb_build_object(
      'endpoint', 'https://api.exa.ai/search',
      'description', 'Search the web; returns up to 5 results with snippets.'
    )
  ),
  (
    'exa',
    'exa/contents',
    'fetch',
    'Web Fetch',
    2000,
    6000,
    6000,
    jsonb_build_object(
      'endpoint', 'https://api.exa.ai/contents',
      'description', 'Fetch a URL and extract clean markdown contents.'
    )
  )
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    metadata = excluded.metadata,
    enabled = true,
    updated_at = now();
