-- Trial eligibility for the subscription checkout flow.
-- A user has used their trial once any subscription row exists for them,
-- regardless of current Stripe status.

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

revoke all on function public.user_trial_used(uuid) from public, anon, authenticated;
revoke all on function public.trial_used() from public, anon;

grant execute on function public.user_trial_used(uuid) to service_role;
grant execute on function public.trial_used() to authenticated, service_role;
