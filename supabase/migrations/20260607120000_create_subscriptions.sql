-- Subscription mirror for the $99/yr + 7-day trial model. Source of truth is Stripe;
-- rows are written by the stripe-webhook edge function (service role) on
-- customer.subscription.* events. Access is granted during trialing/active/past_due.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text,
  status text not null,                       -- mirrors Stripe; intentionally NO check so a new
                                              -- Stripe status can never reject a webhook write
  price_id text,
  trial_end timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_event_at timestamptz,                  -- Stripe event.created of the last applied event (ordering guard)
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Composite (user_id, status) also serves user_id-only lookups (left-prefix).
create index subscriptions_user_status_idx on public.subscriptions(user_id, status);

create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

-- Order-safe upsert called by the stripe-webhook (service role). Stripe delivers events
-- out of order; we only apply an event whose event.created (p_last_event_at) is >= the last
-- applied one, so a late older event can't regress a newer status (e.g. revive a canceled sub).
create or replace function public.record_subscription(
  p_user_id uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_status text,
  p_price_id text,
  p_trial_end timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_last_event_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.subscriptions%rowtype;
begin
  insert into public.subscriptions (
    user_id, stripe_subscription_id, stripe_customer_id, status, price_id,
    trial_end, current_period_end, cancel_at_period_end, last_event_at, metadata
  )
  values (
    p_user_id, p_stripe_subscription_id, p_stripe_customer_id, p_status, p_price_id,
    p_trial_end, p_current_period_end, p_cancel_at_period_end, p_last_event_at,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (stripe_subscription_id) do update
    set user_id = excluded.user_id,
        stripe_customer_id = excluded.stripe_customer_id,
        status = excluded.status,
        price_id = excluded.price_id,
        trial_end = excluded.trial_end,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        last_event_at = excluded.last_event_at,
        metadata = excluded.metadata
    where public.subscriptions.last_event_at is null
       or excluded.last_event_at >= public.subscriptions.last_event_at
  returning * into v_row;

  -- If the conflict update was skipped (older/stale event), no row is returned —
  -- fetch and return the existing row unchanged.
  if v_row.id is null then
    select * into v_row
    from public.subscriptions
    where stripe_subscription_id = p_stripe_subscription_id;
  end if;

  return v_row;
end;
$$;

-- Access = grandfathered OR legacy active license OR a live subscription.
-- Reuses user_has_active_license (grandfather + legacy lifetime) from the licenses migration.
create or replace function public.user_has_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.user_has_active_license(p_user_id)
    or exists (
      select 1 from public.subscriptions
      where user_id = p_user_id
        and status in ('trialing', 'active', 'past_due')
    );
$$;

create or replace function public.has_access()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.user_has_access(auth.uid());
$$;

alter table public.subscriptions enable row level security;

create policy "Users can read own subscriptions"
on public.subscriptions
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;   -- read-own ONLY; writes are service-role
grant all on public.subscriptions to service_role;

revoke all on function public.user_has_access(uuid) from public, anon;
revoke all on function public.has_access() from public, anon;
grant execute on function public.user_has_access(uuid) to authenticated, service_role;
grant execute on function public.has_access() to authenticated, service_role;

revoke all on function public.record_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.record_subscription(uuid, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, jsonb) to service_role;
