-- Final subscription access contract. Stripe's mirrored status remains useful
-- for payment recovery, but only a trialing or active subscription grants access.
create or replace function public.user_has_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.user_has_active_license(p_user_id)
    or exists (
      select 1
      from public.subscriptions
      where user_id = p_user_id
        and status in ('trialing', 'active')
    );
$$;

revoke all on function public.user_has_access(uuid) from public, anon;
grant execute on function public.user_has_access(uuid) to authenticated, service_role;

-- Emit Realtime updates for rows that were already delinquent at cutover.
update public.subscriptions
set updated_at = now()
where status in ('past_due', 'unpaid');
