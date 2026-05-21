-- Extend the Loops signup sync to also pass firstName (extracted from the
-- OAuth provider's full_name) so welcome-email subjects/bodies can address
-- new users by name.

create or replace function public.sync_loops_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_provider text;
  v_full_name text;
  v_first_name text;
  v_body jsonb;
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
  v_full_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '');
  v_first_name := nullif(split_part(v_full_name, ' ', 1), '');

  v_body := jsonb_build_object(
    'email', new.email,
    'userId', new.id::text,
    'eventName', 'signup',
    'source', 'signup',
    'userGroup', v_provider,
    'createdAt', to_char(new.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'mailingLists', jsonb_build_object('cmpf4t2w830fh0ixw5pivet5k', true)
  );

  if v_first_name is not null then
    v_body := v_body || jsonb_build_object('firstName', v_first_name);
  end if;

  begin
    perform net.http_post(
      url := 'https://app.loops.so/api/v1/events/send',
      body := v_body,
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
