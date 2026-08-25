begin;

select plan(9);

insert into auth.users (id, email, created_at)
values
  ('00000000-0000-0000-0000-000000000001', 'cutover-trialing@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000002', 'cutover-active@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000003', 'cutover-past-due@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000004', 'cutover-unpaid@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000005', 'cutover-canceled@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000006', 'cutover-incomplete@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000007', 'cutover-incomplete-expired@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000008', 'cutover-paused@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000009', 'cutover-unknown@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000010', 'cutover-active-plus-past-due@example.test', '2026-08-24T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000011', 'cutover-grandfathered@example.test', '2026-05-27T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000012', 'cutover-legacy-license@example.test', '2026-08-24T00:00:00Z');

insert into public.subscriptions (user_id, stripe_subscription_id, status)
values
  ('00000000-0000-0000-0000-000000000001', 'sub_cutover_trialing', 'trialing'),
  ('00000000-0000-0000-0000-000000000002', 'sub_cutover_active', 'active'),
  ('00000000-0000-0000-0000-000000000003', 'sub_cutover_past_due', 'past_due'),
  ('00000000-0000-0000-0000-000000000004', 'sub_cutover_unpaid', 'unpaid'),
  ('00000000-0000-0000-0000-000000000005', 'sub_cutover_canceled', 'canceled'),
  ('00000000-0000-0000-0000-000000000006', 'sub_cutover_incomplete', 'incomplete'),
  ('00000000-0000-0000-0000-000000000007', 'sub_cutover_incomplete_expired', 'incomplete_expired'),
  ('00000000-0000-0000-0000-000000000008', 'sub_cutover_paused', 'paused'),
  ('00000000-0000-0000-0000-000000000009', 'sub_cutover_unknown', 'future_status'),
  ('00000000-0000-0000-0000-000000000010', 'sub_cutover_active_plus_past_due', 'active'),
  ('00000000-0000-0000-0000-000000000010', 'sub_cutover_active_plus_past_due_delinquent', 'past_due'),
  ('00000000-0000-0000-0000-000000000011', 'sub_cutover_grandfathered', 'past_due'),
  ('00000000-0000-0000-0000-000000000012', 'sub_cutover_legacy_license', 'past_due');

insert into public.licenses (user_id, source, source_id)
values (
  '00000000-0000-0000-0000-000000000012',
  'test',
  'cutover-legacy-license'
);

select ok(
  public.user_has_access('00000000-0000-0000-0000-000000000001'),
  'trialing subscriptions grant access'
);

select ok(
  public.user_has_access('00000000-0000-0000-0000-000000000002'),
  'active subscriptions grant access'
);

select ok(
  not exists (
    select 1
    from public.subscriptions
    where user_id in (
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000006',
      '00000000-0000-0000-0000-000000000007',
      '00000000-0000-0000-0000-000000000008',
      '00000000-0000-0000-0000-000000000009'
    )
      and public.user_has_access(user_id)
  ),
  'delinquent, terminal, and unknown subscriptions do not grant access'
);

select ok(
  public.user_has_access('00000000-0000-0000-0000-000000000010'),
  'an active subscription still grants access alongside a past-due row'
);

select ok(
  public.user_has_access('00000000-0000-0000-0000-000000000011'),
  'grandfathered access remains active alongside a past-due row'
);

select ok(
  public.user_has_access('00000000-0000-0000-0000-000000000012'),
  'an active legacy license remains active alongside a past-due row'
);

select ok(
  (
    select bool_and(public.user_trial_used(user_id))
    from public.subscriptions
    where stripe_subscription_id like 'sub_cutover_%'
  ),
  'every subscription status still records trial use'
);

select is(
  has_function_privilege('anon', 'public.user_has_access(uuid)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute user_has_access'
);

select is(
  has_function_privilege('authenticated', 'public.user_has_access(uuid)', 'EXECUTE'),
  true,
  'authenticated callers retain user_has_access execution'
);

select * from finish();

rollback;
