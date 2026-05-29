-- Lifetime license entitlement. Separate from the credit ledger.
-- Clones ledger idempotency (unique source/source_id), RLS, and security-definer conventions.

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'lifetime' check (kind in ('lifetime')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  source text not null,            -- 'stripe' | 'grandfather'
  source_id text not null,         -- stripe: payment_intent id; grandfather: user_id::text
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason in ('refund', 'dispute', 'admin')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id),
  check ((status = 'revoked') = (revoked_at is not null))
);

-- A user can never hold two ACTIVE licenses.
create unique index licenses_one_active_per_user
  on public.licenses(user_id) where status = 'active';
create index licenses_user_idx on public.licenses(user_id);

create trigger set_licenses_updated_at
before update on public.licenses
for each row execute function public.set_updated_at();

-- ---------- RPCs ----------

create or replace function public.grant_license(
  p_user_id uuid,
  p_source text,
  p_source_id text,
  p_kind text default 'lifetime',
  p_metadata jsonb default '{}'::jsonb
)
returns public.licenses
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing public.licenses%rowtype;
  v_row public.licenses%rowtype;
begin
  if p_source is null or length(trim(p_source)) = 0 then
    raise exception 'license_source_required';
  end if;
  if p_source_id is null or length(trim(p_source_id)) = 0 then
    raise exception 'license_source_id_required';
  end if;
  if p_kind not in ('lifetime') then
    raise exception 'invalid_license_kind';
  end if;

  -- Replay / tombstone: a row for this exact (source, source_id) is returned unchanged.
  -- This is what makes an out-of-order refund-before-grant safe: a 'revoked' tombstone
  -- is returned and is NOT reactivated.
  select * into v_existing
  from public.licenses
  where source = p_source and source_id = p_source_id;

  if v_existing.id is not null then
    return v_existing;
  end if;

  begin
    insert into public.licenses (user_id, kind, status, source, source_id, metadata)
    values (p_user_id, p_kind, 'active', p_source, p_source_id, coalesce(p_metadata, '{}'::jsonb))
    returning * into v_row;
  exception
    when unique_violation then
      -- Two unique constraints can fire here. If (source, source_id) collided (a row
      -- committed between the pre-check and this insert), return that row — it may be a
      -- revoked tombstone, which must NOT be reactivated. Otherwise the partial-active
      -- index fired: the user already holds an active license; return it.
      select * into v_row
      from public.licenses
      where source = p_source and source_id = p_source_id;
      if v_row.id is null then
        select * into v_row
        from public.licenses
        where user_id = p_user_id and status = 'active'
        limit 1;
      end if;
  end;

  return v_row;
end;
$$;

create or replace function public.revoke_license(
  p_source text,
  p_source_id text,
  p_user_id uuid default null,
  p_reason text default 'refund',
  p_metadata jsonb default '{}'::jsonb
)
returns public.licenses
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.licenses%rowtype;
begin
  if p_source is null or length(trim(p_source)) = 0 then
    raise exception 'license_source_required';
  end if;
  if p_source_id is null or length(trim(p_source_id)) = 0 then
    raise exception 'license_source_id_required';
  end if;
  if p_reason not in ('refund', 'dispute', 'admin') then
    raise exception 'invalid_revoke_reason';
  end if;

  select * into v_row
  from public.licenses
  where source = p_source and source_id = p_source_id
  for update;

  if v_row.id is not null then
    if v_row.status = 'revoked' then
      return v_row;  -- idempotent no-op
    end if;
    update public.licenses
    set status = 'revoked',
        revoked_at = now(),
        revoke_reason = p_reason,
        metadata = metadata || coalesce(p_metadata, '{}'::jsonb)
    where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  -- No row yet: refund/dispute arrived before the grant. Write a 'revoked' tombstone
  -- keyed on (source, source_id) so the later grant_license collides and does NOT activate.
  if p_user_id is null then
    raise exception 'license_user_id_required_for_tombstone';
  end if;

  insert into public.licenses (user_id, status, source, source_id, granted_at, revoked_at, revoke_reason, metadata)
  values (p_user_id, 'revoked', p_source, p_source_id, now(), now(), p_reason, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.license_cutoff()
returns timestamptz
language sql
immutable
as $$
  select '2026-05-28T00:00:00Z'::timestamptz;  -- launch cutoff (UTC): accounts created before this are grandfathered; on/after pay $99
$$;

-- Grandfather eligibility is DERIVED (created_at < cutoff), not a pre-written row.
-- Shared by has_active_license() (auth.uid) and the edge function (explicit user id).
create or replace function public.user_has_active_license(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.licenses
    where user_id = p_user_id and status = 'active'
  )
  or exists (
    select 1 from auth.users
    where id = p_user_id and created_at < public.license_cutoff()
  );
$$;

create or replace function public.has_active_license()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.user_has_active_license(auth.uid());
$$;

-- ---------- RLS + grants ----------

alter table public.licenses enable row level security;

create policy "Users can read own licenses"
on public.licenses
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.licenses from anon, authenticated;
grant select on public.licenses to authenticated;   -- read-own ONLY; no insert/update/delete => cannot self-grant
grant all on public.licenses to service_role;

revoke all on function public.grant_license(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.revoke_license(text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.license_cutoff() from public, anon;
revoke all on function public.user_has_active_license(uuid) from public, anon;
revoke all on function public.has_active_license() from public, anon;

grant execute on function public.grant_license(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.revoke_license(text, text, uuid, text, jsonb) to service_role;
grant execute on function public.license_cutoff() to authenticated, service_role;
grant execute on function public.user_has_active_license(uuid) to authenticated, service_role;
grant execute on function public.has_active_license() to authenticated, service_role;
