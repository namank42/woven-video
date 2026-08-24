begin;

select plan(4);

select is(
  (
    select count(*)::integer
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'subscriptions'
  ),
  1,
  'subscriptions is published exactly once'
);

select ok(
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'subscriptions'
  ),
  'subscriptions has row level security enabled'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriptions'
      and policyname = 'Users can read own subscriptions'
      and roles @> array['authenticated']::name[]
      and cmd = 'SELECT'
  ),
  'subscriptions retains its authenticated SELECT policy'
);

select is(
  (
    select qual
    from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriptions'
      and policyname = 'Users can read own subscriptions'
  ),
  '(user_id = auth.uid())',
  'subscriptions SELECT policy restricts rows to the authenticated user'
);

select * from finish();

rollback;
