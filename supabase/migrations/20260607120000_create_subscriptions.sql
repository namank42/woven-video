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
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Composite (user_id, status) also serves user_id-only lookups (left-prefix).
create index subscriptions_user_status_idx on public.subscriptions(user_id, status);

create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

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
