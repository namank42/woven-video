-- First end-user write target in the schema. Inserts only; RLS restricts each
-- row's user_id to the inserting user's auth.uid(). All other access goes
-- through the service role (admin tooling joins auth.users for user details).

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  message text not null check (char_length(btrim(message)) between 1 and 10000),
  app_version text check (app_version is null or char_length(app_version) <= 64),
  build_number text check (build_number is null or char_length(build_number) <= 32),
  os_version text check (os_version is null or char_length(os_version) <= 128),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant insert on public.feedback to authenticated;
grant all on public.feedback to service_role;

create policy "Users can insert own feedback"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

create index feedback_created_at_idx on public.feedback (created_at desc);
