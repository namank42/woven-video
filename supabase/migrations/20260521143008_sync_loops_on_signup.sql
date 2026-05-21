-- Loops API key lives in Supabase Vault. Seed it once with:
--   select vault.create_secret('<loops-api-key>', 'loops_api_key');
-- A missing/empty secret makes the trigger a no-op (local & preview DBs).

create extension if not exists pg_net;

create or replace function public.sync_loops_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_provider text;
begin
  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'loops_api_key'
   limit 1;

  if v_key is null or v_key = '' then
    return new;
  end if;

  v_provider := coalesce(new.raw_app_meta_data->>'provider', 'unknown');

  begin
    perform net.http_post(
      url := 'https://app.loops.so/api/v1/events/send',
      body := jsonb_build_object(
        'email', new.email,
        'userId', new.id::text,
        'eventName', 'signup',
        'source', 'signup',
        'userGroup', v_provider,
        'createdAt', to_char(new.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        -- editor mailing list — new signups auto-subscribe to product updates
        'mailingLists', jsonb_build_object('cmpf4t2w830fh0ixw5pivet5k', true)
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key,
        'Idempotency-Key', new.id::text
      )
    );
  exception when others then
    raise log 'loops signup sync failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_loops_sync on auth.users;
create trigger on_auth_user_created_loops_sync
after insert on auth.users
for each row execute function public.sync_loops_on_signup();
