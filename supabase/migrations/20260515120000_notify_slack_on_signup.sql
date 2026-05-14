-- Slack webhook URL lives in Supabase Vault. Seed it once with:
--   select vault.create_secret('<webhook-url>', 'slack_signup_webhook_url');
-- A missing/empty secret makes the trigger a no-op (local & preview DBs).

create extension if not exists pg_net;

create or replace function public.notify_slack_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select decrypted_secret
    into v_url
    from vault.decrypted_secrets
   where name = 'slack_signup_webhook_url'
   limit 1;

  if v_url is null or v_url = '' then
    return new;
  end if;

  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'text', '🎉 New signup: ' || coalesce(new.email, '(no email)')
      ),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  exception when others then
    raise log 'slack signup notify failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_slack_notify on auth.users;
create trigger on_auth_user_created_slack_notify
after insert on auth.users
for each row execute function public.notify_slack_on_signup();
