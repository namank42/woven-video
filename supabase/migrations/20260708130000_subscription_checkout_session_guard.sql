-- Durable guard for trial subscription Checkout creation.
-- Open trial sessions are reusable and do not burn the trial; completed trial
-- sessions count as used even if the subscription webhook is delayed.

create table public.subscription_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_checkout_session_id text unique,
  stripe_customer_id text,
  checkout_mode text not null check (checkout_mode in ('trial', 'subscription')),
  status text not null check (status in ('open', 'completed', 'expired', 'cancelled')),
  stripe_checkout_url text,
  expires_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subscription_checkout_open_user_mode_key
  on public.subscription_checkout_sessions(user_id, checkout_mode)
  where status = 'open';

create index subscription_checkout_user_status_idx
  on public.subscription_checkout_sessions(user_id, checkout_mode, status);

create trigger set_subscription_checkout_sessions_updated_at
before update on public.subscription_checkout_sessions
for each row execute function public.set_updated_at();

do $$
begin
  create type public.subscription_checkout_reservation_result as (
    reservation_id uuid,
    checkout_mode text,
    status text,
    stripe_checkout_session_id text,
    stripe_checkout_url text,
    created boolean
  );
exception
  when duplicate_object then null;
end $$;

create or replace function public.reserve_subscription_checkout_session(
  p_user_id uuid,
  p_stripe_customer_id text
)
returns public.subscription_checkout_reservation_result
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.subscription_checkout_sessions%rowtype;
  v_result public.subscription_checkout_reservation_result;
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  update public.subscription_checkout_sessions
  set status = 'expired'
  where user_id = p_user_id
    and checkout_mode = 'trial'
    and status = 'open'
    and (
      (expires_at is not null and expires_at <= now())
      or (stripe_checkout_session_id is null and created_at < now() - interval '5 minutes')
    );

  if public.user_trial_used(p_user_id) then
    v_result := (
      null::uuid,
      'subscription'::text,
      'open'::text,
      null::text,
      null::text,
      false
    );
    return v_result;
  end if;

  select *
  into v_row
  from public.subscription_checkout_sessions
  where user_id = p_user_id
    and checkout_mode = 'trial'
    and status = 'open'
  order by created_at desc
  limit 1;

  if found then
    v_result := (
      v_row.id,
      v_row.checkout_mode,
      v_row.status,
      v_row.stripe_checkout_session_id,
      v_row.stripe_checkout_url,
      false
    );
    return v_result;
  end if;

  insert into public.subscription_checkout_sessions (
    user_id,
    stripe_customer_id,
    checkout_mode,
    status
  )
  values (
    p_user_id,
    p_stripe_customer_id,
    'trial',
    'open'
  )
  returning * into v_row;

  v_result := (
    v_row.id,
    v_row.checkout_mode,
    v_row.status,
    v_row.stripe_checkout_session_id,
    v_row.stripe_checkout_url,
    true
  );
  return v_result;
end;
$$;

create or replace function public.record_subscription_checkout_session(
  p_reservation_id uuid,
  p_user_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_checkout_url text,
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.subscription_checkout_sessions
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.subscription_checkout_sessions%rowtype;
begin
  update public.subscription_checkout_sessions
  set stripe_checkout_session_id = p_stripe_checkout_session_id,
      stripe_checkout_url = p_stripe_checkout_url,
      expires_at = p_expires_at,
      metadata = coalesce(p_metadata, '{}'::jsonb)
  where id = p_reservation_id
    and user_id = p_user_id
    and checkout_mode = 'trial'
    and status = 'open'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'subscription_checkout_reservation_missing';
  end if;

  return v_row;
end;
$$;

create or replace function public.mark_subscription_checkout_session_completed(
  p_stripe_checkout_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_updated integer;
begin
  update public.subscription_checkout_sessions
  set status = 'completed',
      completed_at = coalesce(completed_at, now())
  where stripe_checkout_session_id = p_stripe_checkout_session_id
    and status = 'open';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.user_trial_used(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.subscriptions
    where user_id = p_user_id
  )
  or exists (
    select 1
    from public.subscription_checkout_sessions
    where user_id = p_user_id
      and checkout_mode = 'trial'
      and status = 'completed'
  );
$$;

create or replace function public.trial_used()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.user_trial_used(auth.uid());
$$;

alter table public.subscription_checkout_sessions enable row level security;

create policy "Users can read own subscription checkout sessions"
on public.subscription_checkout_sessions
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.subscription_checkout_sessions from anon, authenticated;
grant select on public.subscription_checkout_sessions to authenticated;
grant all on public.subscription_checkout_sessions to service_role;

revoke all on function public.reserve_subscription_checkout_session(uuid, text) from public, anon, authenticated;
revoke all on function public.record_subscription_checkout_session(uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.mark_subscription_checkout_session_completed(text) from public, anon, authenticated;
revoke all on function public.user_trial_used(uuid) from public, anon, authenticated;
revoke all on function public.trial_used() from public, anon;

grant execute on function public.reserve_subscription_checkout_session(uuid, text) to service_role;
grant execute on function public.record_subscription_checkout_session(uuid, uuid, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.mark_subscription_checkout_session_completed(text) to service_role;
grant execute on function public.user_trial_used(uuid) to service_role;
grant execute on function public.trial_used() to authenticated, service_role;
