create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_stripe_customer_id_key
  on public.profiles(stripe_customer_id)
  where stripe_customer_id is not null;

create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null default 'usd',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, currency)
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.billing_accounts(id) on delete restrict,
  type text not null,
  provider text not null,
  model text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  estimated_cost_usd_micros bigint not null check (estimated_cost_usd_micros >= 0),
  reserved_amount_usd_micros bigint not null default 0 check (reserved_amount_usd_micros >= 0),
  final_cost_usd_micros bigint check (final_cost_usd_micros >= 0),
  provider_job_id text,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table public.model_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  operation text not null default 'chat',
  display_name text not null,
  markup_bps integer not null default 2000 check (markup_bps >= 0),
  minimum_charge_usd_micros bigint not null default 1 check (minimum_charge_usd_micros >= 0),
  reserve_amount_usd_micros bigint not null default 10000 check (reserve_amount_usd_micros > 0),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, model, operation)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null
    check (kind in ('purchase', 'promo', 'reserve', 'settle', 'release', 'adjustment', 'refund')),
  amount_usd_micros bigint not null check (amount_usd_micros <> 0),
  balance_after_usd_micros bigint not null check (balance_after_usd_micros >= 0),
  source text not null,
  source_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, source_id, kind)
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete set null,
  provider text not null,
  model text not null,
  operation text not null,
  input_units bigint not null default 0 check (input_units >= 0),
  output_units bigint not null default 0 check (output_units >= 0),
  reasoning_units bigint not null default 0 check (reasoning_units >= 0),
  cached_units bigint not null default 0 check (cached_units >= 0),
  gateway_generation_id text,
  raw_provider_cost numeric(18, 9) not null default 0 check (raw_provider_cost >= 0),
  charged_amount_usd_micros bigint not null check (charged_amount_usd_micros >= 0),
  markup_amount_usd_micros bigint not null default 0 check (markup_amount_usd_micros >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index billing_accounts_user_id_idx on public.billing_accounts(user_id);
create index ledger_entries_account_created_idx on public.ledger_entries(account_id, created_at desc);
create index ledger_entries_user_created_idx on public.ledger_entries(user_id, created_at desc);
create index generation_jobs_user_created_idx on public.generation_jobs(user_id, created_at desc);
create index generation_jobs_status_created_idx on public.generation_jobs(status, created_at);
create index model_pricing_rules_enabled_idx on public.model_pricing_rules(enabled, provider, model);
create index usage_events_user_created_idx on public.usage_events(user_id, created_at desc);
create index usage_events_job_id_idx on public.usage_events(job_id);
create index usage_events_gateway_generation_id_idx on public.usage_events(gateway_generation_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_billing_accounts_updated_at
before update on public.billing_accounts
for each row execute function public.set_updated_at();

create trigger set_generation_jobs_updated_at
before update on public.generation_jobs
for each row execute function public.set_updated_at();

create trigger set_model_pricing_rules_updated_at
before update on public.model_pricing_rules
for each row execute function public.set_updated_at();

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
    'vercel-ai-gateway',
    'anthropic/claude-sonnet-4.6',
    'chat',
    'Claude Sonnet 4.6',
    2000,
    1,
    50000,
    jsonb_build_object('provider_model_id', 'anthropic/claude-sonnet-4.6')
  ),
  (
    'vercel-ai-gateway',
    'anthropic/claude-opus-4.7',
    'chat',
    'Claude Opus 4.7',
    2000,
    1,
    100000,
    jsonb_build_object('provider_model_id', 'anthropic/claude-opus-4.7')
  ),
  (
    'vercel-ai-gateway',
    'anthropic/claude-haiku-4.5',
    'chat',
    'Claude Haiku 4.5',
    2000,
    1,
    10000,
    jsonb_build_object('provider_model_id', 'anthropic/claude-haiku-4.5')
  ),
  (
    'vercel-ai-gateway',
    'openai/gpt-5.5',
    'chat',
    'GPT-5.5',
    2000,
    1,
    100000,
    jsonb_build_object('provider_model_id', 'openai/gpt-5.5')
  )
on conflict (provider, model, operation) do update
set display_name = excluded.display_name,
    markup_bps = excluded.markup_bps,
    minimum_charge_usd_micros = excluded.minimum_charge_usd_micros,
    reserve_amount_usd_micros = excluded.reserve_amount_usd_micros,
    metadata = excluded.metadata,
    enabled = true,
    updated_at = now();

create or replace function public.ensure_billing_account(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_account_id uuid;
begin
  select email into v_email
  from auth.users
  where id = p_user_id;

  if not found then
    raise exception 'user_not_found';
  end if;

  insert into public.profiles (id, email)
  values (p_user_id, v_email)
  on conflict (id) do update
    set email = excluded.email;

  insert into public.billing_accounts (user_id)
  values (p_user_id)
  on conflict (user_id, currency) do update
    set updated_at = now()
  returning id into v_account_id;

  return v_account_id;
end;
$$;

create or replace function public.create_profile_and_billing_account()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.ensure_billing_account(new.id);
  return new;
end;
$$;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_and_billing_account();

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.sync_profile_email();

create or replace function public.insert_ledger_entry(
  p_account_id uuid,
  p_user_id uuid,
  p_kind text,
  p_amount_usd_micros bigint,
  p_source text,
  p_source_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.ledger_entries
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing public.ledger_entries%rowtype;
  v_current_balance bigint;
  v_next_balance bigint;
  v_tx public.ledger_entries%rowtype;
begin
  if p_amount_usd_micros = 0 then
    raise exception 'ledger_entry_amount_usd_micros_must_not_be_zero';
  end if;

  if p_source is null or length(trim(p_source)) = 0 then
    raise exception 'ledger_entry_source_required';
  end if;

  if p_source_id is null or length(trim(p_source_id)) = 0 then
    raise exception 'ledger_entry_source_id_required';
  end if;

  perform 1
  from public.billing_accounts
  where id = p_account_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'billing_account_not_found';
  end if;

  select *
  into v_existing
  from public.ledger_entries
  where source = p_source
    and source_id = p_source_id
    and kind = p_kind;

  if v_existing.id is not null then
    if v_existing.account_id <> p_account_id
      or v_existing.user_id <> p_user_id
      or v_existing.amount_usd_micros <> p_amount_usd_micros then
      raise exception 'idempotency_key_reused_with_different_ledger_entry';
    end if;

    return v_existing;
  end if;

  select coalesce(sum(amount_usd_micros), 0)::bigint
  into v_current_balance
  from public.ledger_entries
  where account_id = p_account_id;

  v_next_balance := v_current_balance + p_amount_usd_micros;

  if v_next_balance < 0 then
    raise exception 'insufficient_balance';
  end if;

  insert into public.ledger_entries (
    account_id,
    user_id,
    kind,
    amount_usd_micros,
    balance_after_usd_micros,
    source,
    source_id,
    metadata
  )
  values (
    p_account_id,
    p_user_id,
    p_kind,
    p_amount_usd_micros,
    v_next_balance,
    p_source,
    p_source_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_tx;

  return v_tx;
end;
$$;

create or replace function public.get_billing_balance()
returns table (
  account_id uuid,
  currency text,
  balance_usd_micros bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  perform public.ensure_billing_account(v_user_id);

  return query
  select
    ca.id as account_id,
    ca.currency,
    coalesce(sum(ct.amount_usd_micros), 0)::bigint as balance_usd_micros
  from public.billing_accounts ca
  left join public.ledger_entries ct on ct.account_id = ca.id
  where ca.user_id = v_user_id
  group by ca.id, ca.currency;
end;
$$;

create or replace function public.grant_balance(
  p_user_id uuid,
  p_amount_usd_micros bigint,
  p_source text,
  p_source_id text,
  p_kind text default 'purchase',
  p_metadata jsonb default '{}'::jsonb
)
returns public.ledger_entries
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
begin
  if p_amount_usd_micros <= 0 then
    raise exception 'balance_grant_amount_usd_micros_must_be_positive';
  end if;

  if p_kind not in ('purchase', 'promo', 'adjustment', 'refund') then
    raise exception 'invalid_balance_grant_kind';
  end if;

  v_account_id := public.ensure_billing_account(p_user_id);

  return public.insert_ledger_entry(
    v_account_id,
    p_user_id,
    p_kind,
    p_amount_usd_micros,
    p_source,
    p_source_id,
    p_metadata
  );
end;
$$;

create or replace function public.reserve_balance(
  p_user_id uuid,
  p_job_id uuid,
  p_amount_usd_micros bigint,
  p_metadata jsonb default '{}'::jsonb
)
returns public.ledger_entries
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  v_job public.generation_jobs%rowtype;
  v_tx public.ledger_entries%rowtype;
begin
  if p_amount_usd_micros <= 0 then
    raise exception 'balance_reservation_amount_usd_micros_must_be_positive';
  end if;

  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
    and user_id = p_user_id
  for update;

  if v_job.id is null then
    raise exception 'generation_job_not_found';
  end if;

  if v_job.final_cost_usd_micros is not null
    or v_job.status in ('succeeded', 'failed', 'cancelled') then
    raise exception 'generation_job_already_finalized';
  end if;

  v_account_id := public.ensure_billing_account(p_user_id);

  v_tx := public.insert_ledger_entry(
    v_account_id,
    p_user_id,
    'reserve',
    -p_amount_usd_micros,
    'job',
    p_job_id::text,
    p_metadata
  );

  update public.generation_jobs
  set account_id = v_account_id,
      reserved_amount_usd_micros = p_amount_usd_micros
  where id = p_job_id;

  return v_tx;
end;
$$;

create or replace function public.settle_balance_reservation(
  p_job_id uuid,
  p_final_cost_usd_micros bigint,
  p_output jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_adjustment bigint;
begin
  if p_final_cost_usd_micros < 0 then
    raise exception 'final_cost_usd_micros_must_not_be_negative';
  end if;

  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'generation_job_not_found';
  end if;

  if v_job.status = 'succeeded' and v_job.final_cost_usd_micros is not null then
    if v_job.final_cost_usd_micros <> p_final_cost_usd_micros then
      raise exception 'generation_job_already_settled_with_different_amount';
    end if;

    return v_job;
  end if;

  if v_job.status in ('failed', 'cancelled') then
    raise exception 'generation_job_already_released';
  end if;

  if v_job.account_id is null then
    raise exception 'generation_job_has_no_billing_account';
  end if;

  v_adjustment := v_job.reserved_amount_usd_micros - p_final_cost_usd_micros;

  if v_adjustment <> 0 then
    perform public.insert_ledger_entry(
      v_job.account_id,
      v_job.user_id,
      'settle',
      v_adjustment,
      'job',
      p_job_id::text,
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'reserved_amount_usd_micros', v_job.reserved_amount_usd_micros,
        'final_cost_usd_micros', p_final_cost_usd_micros
      )
    );
  end if;

  update public.generation_jobs
  set status = 'succeeded',
      final_cost_usd_micros = p_final_cost_usd_micros,
      output = coalesce(p_output, public.generation_jobs.output),
      completed_at = coalesce(completed_at, now())
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

create or replace function public.release_balance_reservation(
  p_job_id uuid,
  p_status text default 'failed',
  p_error text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  if p_status not in ('failed', 'cancelled') then
    raise exception 'release_status_must_be_failed_or_cancelled';
  end if;

  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'generation_job_not_found';
  end if;

  if v_job.status = 'succeeded' then
    raise exception 'generation_job_already_succeeded';
  end if;

  if v_job.status in ('failed', 'cancelled') and v_job.final_cost_usd_micros = 0 then
    return v_job;
  end if;

  if v_job.account_id is null then
    raise exception 'generation_job_has_no_billing_account';
  end if;

  if v_job.reserved_amount_usd_micros > 0 then
    perform public.insert_ledger_entry(
      v_job.account_id,
      v_job.user_id,
      'release',
      v_job.reserved_amount_usd_micros,
      'job',
      p_job_id::text,
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('reserved_amount_usd_micros', v_job.reserved_amount_usd_micros)
    );
  end if;

  update public.generation_jobs
  set status = p_status,
      final_cost_usd_micros = 0,
      error = p_error,
      completed_at = coalesce(completed_at, now())
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

alter table public.profiles enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.model_pricing_rules enable row level security;
alter table public.usage_events enable row level security;

create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "Users can read own balance accounts"
on public.billing_accounts
for select
to authenticated
using (user_id = auth.uid());

create policy "Users can read own ledger entries"
on public.ledger_entries
for select
to authenticated
using (user_id = auth.uid());

create policy "Users can read own generation jobs"
on public.generation_jobs
for select
to authenticated
using (user_id = auth.uid());

create policy "Authenticated users can read enabled model pricing rules"
on public.model_pricing_rules
for select
to authenticated
using (enabled = true);

create policy "Users can read own usage events"
on public.usage_events
for select
to authenticated
using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit)
values ('generated-media', 'generated-media', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy "Users can read own generated media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'generated-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

revoke all on public.profiles from anon, authenticated;
revoke all on public.billing_accounts from anon, authenticated;
revoke all on public.ledger_entries from anon, authenticated;
revoke all on public.generation_jobs from anon, authenticated;
revoke all on public.model_pricing_rules from anon, authenticated;
revoke all on public.usage_events from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.billing_accounts to authenticated;
grant select on public.ledger_entries to authenticated;
grant select on public.generation_jobs to authenticated;
grant select on public.model_pricing_rules to authenticated;
grant select on public.usage_events to authenticated;

grant all on public.profiles to service_role;
grant all on public.billing_accounts to service_role;
grant all on public.ledger_entries to service_role;
grant all on public.generation_jobs to service_role;
grant all on public.model_pricing_rules to service_role;
grant all on public.usage_events to service_role;

revoke all on function public.ensure_billing_account(uuid) from public, anon, authenticated;
revoke all on function public.create_profile_and_billing_account() from public, anon, authenticated;
revoke all on function public.sync_profile_email() from public, anon, authenticated;
revoke all on function public.insert_ledger_entry(uuid, uuid, text, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_billing_balance() from public, anon;
revoke all on function public.grant_balance(uuid, bigint, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_balance(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.settle_balance_reservation(uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.release_balance_reservation(uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.get_billing_balance() to authenticated;
grant execute on function public.get_billing_balance() to service_role;
grant execute on function public.ensure_billing_account(uuid) to service_role;
grant execute on function public.grant_balance(uuid, bigint, text, text, text, jsonb) to service_role;
grant execute on function public.reserve_balance(uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.settle_balance_reservation(uuid, bigint, jsonb, jsonb) to service_role;
grant execute on function public.release_balance_reservation(uuid, text, text, jsonb) to service_role;
