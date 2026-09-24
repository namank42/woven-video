-- PostgREST pre-request guard against supabase/postgres#2377
-- (https://github.com/supabase/postgres/issues/2377, open, no upstream fix
-- at the time of writing). On supabase/postgres 17.6.1.111 -- the image
-- this project's production also runs -- calling any function the caller
-- has no EXECUTE grant on segfaults the Postgres backend and restarts the
-- whole database. This reproduces locally through PostgREST with the
-- anon/publishable key, even for a trivial function. 48 functions in
-- `public` are currently locked to service_role only (billing, media jobs,
-- telemetry, diagnostics): anyone holding the public app key could crash
-- the database on demand.
--
-- The fix: a db-pre-request hook that checks, for every /rpc/<fn> call,
-- whether current_user (the Postgres role PostgREST authenticated the
-- request as -- anon, authenticated, or service_role) has EXECUTE on some
-- overload of that function in the resolved schema. If not, it raises
-- 42501 (insufficient_privilege) itself, which PostgREST turns into a
-- clean error response -- the function is never actually invoked, so the
-- crash never happens.
--
-- This must never block a call that would otherwise have succeeded: it
-- only turns "would have segfaulted" into "gets a clean permission error
-- instead".
--
-- To remove this guard once Supabase ships an upstream fix for #2377 and
-- the fixed image is what this project runs, in this exact order (resetting
-- and reloading first keeps PostgREST from trying to call a pre-request
-- hook that no longer exists):
--   alter role authenticator reset pgrst.db_pre_request;
--   notify pgrst, 'reload config';
-- and only then:
--   drop function public.pgrst_pre_request();
--   drop function public.pgrst_pre_request_url_decode(text);

-- Percent-decodes a URL path segment. Used only to normalize each segment
-- of request.path before comparing it against pg_proc.proname; a segment
-- with no "%" sequences passes through unchanged, so this is safe even if
-- request.path already arrives decoded.
create or replace function public.pgrst_pre_request_url_decode(input text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select convert_from(
    coalesce(
      (
        select string_agg(
          case
            when t.pct is not null then decode(t.pct, 'hex')
            else convert_to(t.lit, 'UTF8')
          end,
          ''::bytea
        )
        from regexp_matches(input, '%([0-9A-Fa-f]{2})|([^%]+)', 'g') as m(g)
        cross join lateral (select m.g[1] as pct, m.g[2] as lit) as t
      ),
      ''::bytea
    ),
    'UTF8'
  );
$$;

revoke all on function public.pgrst_pre_request_url_decode(text)
  from public, anon, authenticated;
grant execute on function public.pgrst_pre_request_url_decode(text)
  to anon, authenticated, service_role;

create or replace function public.pgrst_pre_request() returns void
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_path text := coalesce(current_setting('request.path', true), '');
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
  v_headers jsonb;
  v_schema text;
  v_fn text;
  v_segments text[];
begin
  -- Mirror PostgREST's own routing exactly, not a shortcut on the raw
  -- string: PostgREST splits the path on literal "/" bytes first, THEN
  -- percent-decodes each segment independently. A prefix check against the
  -- raw path (e.g. requiring it to literally start with "/rpc/") misses
  -- "/%72pc/<fn>" (%72 decodes to "r"), which PostgREST still routes as an
  -- RPC call -- a real bypass, since that call would reach the crash path
  -- with the guard never even inspecting it.
  select array_agg(public.pgrst_pre_request_url_decode(seg) order by ord)
  into v_segments
  from unnest(string_to_array(split_part(v_path, '?', 1), '/'))
    with ordinality as t(seg, ord)
  where seg <> '';

  if v_segments is null or array_length(v_segments, 1) <> 2
    or v_segments[1] <> 'rpc'
  then
    return;
  end if;
  v_fn := v_segments[2];
  if v_fn = '' then
    return;
  end if;

  -- Resolve the target schema exactly as PostgREST does: Content-Profile
  -- for a write method (POST, PATCH, PUT, DELETE -- how every RPC call in
  -- this codebase is made), Accept-Profile for everything else (GET, HEAD,
  -- and so on). PostgREST has already validated whichever header applies
  -- against the exposed schemas (supabase/config.toml [api].schemas)
  -- before this hook runs, so the value is used directly here -- no
  -- hardcoded schema allowlist, and no need to re-validate it.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception
    when others then
      v_headers := null;
  end;
  if v_method in ('POST', 'PATCH', 'PUT', 'DELETE') then
    v_schema := nullif(v_headers ->> 'content-profile', '');
  else
    v_schema := nullif(v_headers ->> 'accept-profile', '');
  end if;
  v_schema := coalesce(v_schema, 'public');

  -- Overload-safe: block only when NOT ONE overload of this name in the
  -- resolved schema is executable by current_user. If some overload is
  -- executable, let PostgREST resolve and dispatch to it normally -- this
  -- guard must never block a call that would otherwise have succeeded.
  -- (No overloaded name exists in public/graphql_public today, verified
  -- against the local database; this still has to hold for the future.)
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = v_schema
      and p.proname = v_fn
      and p.prokind = 'f'
  ) and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = v_schema
      and p.proname = v_fn
      and p.prokind = 'f'
      and has_function_privilege(current_user, p.oid, 'execute')
  ) then
    -- 42501 = insufficient_privilege. PostgREST maps this to a clean HTTP
    -- error response instead of ever invoking the function, so the crash
    -- never happens.
    raise exception 'permission denied for function %', v_fn
      using errcode = '42501';
  end if;
  -- No matching proname at all: not our concern, PostgREST 404s on its own
  -- without ever invoking anything.
end;
$$;

revoke all on function public.pgrst_pre_request() from public, anon, authenticated;
grant execute on function public.pgrst_pre_request() to anon, authenticated, service_role;

-- Fail closed: if authenticator already points pgrst.db_pre_request at some
-- other function, do not silently overwrite it (that could disable an
-- unrelated hook someone else is relying on). Stop and make a human
-- resolve the conflict instead.
do $$
declare
  v_config text[];
  v_existing text;
begin
  select rolconfig into v_config from pg_roles where rolname = 'authenticator';
  if v_config is not null then
    select regexp_replace(cfg, '^pgrst\.db_pre_request=', '')
    into v_existing
    from unnest(v_config) as cfg
    where cfg like 'pgrst.db_pre_request=%';
  end if;

  if v_existing is not null and v_existing <> 'public.pgrst_pre_request' then
    raise exception
      'authenticator.pgrst.db_pre_request is already set to % (not public.pgrst_pre_request); refusing to overwrite an unrelated pre-request hook. Resolve manually, then reapply this migration.',
      v_existing;
  end if;
end $$;

alter role authenticator set pgrst.db_pre_request = 'public.pgrst_pre_request';

-- Without this, PostgREST keeps its already-loaded config (no pre-request
-- hook) until its next restart or config change, so the guard would not
-- actually be live despite the role setting being correct.
notify pgrst, 'reload config';
