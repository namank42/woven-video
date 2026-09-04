alter table public.profiles
  add column if not exists winback_suppressed boolean not null default false;
