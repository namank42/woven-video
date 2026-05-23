-- Slack webhook URL lives in Supabase Vault. Seed it once with:
--   select vault.create_secret('<webhook-url>', 'slack_feedback_webhook_url');
-- A missing/empty secret makes the trigger a no-op (local & preview DBs).

create or replace function public.notify_slack_on_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_email text;
  v_preview text;
  v_short_id text;
  v_diagnostics text;
  v_subject text;
  v_subject_encoded text;
  v_mailto text;
  v_blocks jsonb;
begin
  select decrypted_secret
    into v_url
    from vault.decrypted_secrets
   where name = 'slack_feedback_webhook_url'
   limit 1;

  if v_url is null or v_url = '' then
    return new;
  end if;

  select email into v_email
    from auth.users
   where id = new.user_id
   limit 1;

  v_preview := left(new.message, 500);
  if char_length(new.message) > 500 then
    v_preview := v_preview || '…';
  end if;

  v_short_id := left(new.id::text, 8);
  v_diagnostics :=
    coalesce(new.app_version, '?') ||
    ' (' || coalesce(new.build_number, '?') || ') · ' ||
    coalesce(new.os_version, '?');

  v_blocks := jsonb_build_array(
    jsonb_build_object(
      'type', 'section',
      'text', jsonb_build_object(
        'type', 'mrkdwn',
        'text',
          '💬 *Feedback from* `' || coalesce(v_email, '(unknown)') || '`' ||
          E'\n\n> ' || replace(v_preview, E'\n', E'\n> ') ||
          E'\n\n_' || v_diagnostics || '_  •  `' || v_short_id || '`'
      )
    )
  );

  if v_email is not null then
    v_subject := 'Re: Your Woven feedback [' || v_short_id || ']';
    v_subject_encoded := v_subject;
    v_subject_encoded := replace(v_subject_encoded, '%', '%25');
    v_subject_encoded := replace(v_subject_encoded, ' ', '%20');
    v_subject_encoded := replace(v_subject_encoded, ':', '%3A');
    v_subject_encoded := replace(v_subject_encoded, '[', '%5B');
    v_subject_encoded := replace(v_subject_encoded, ']', '%5D');
    v_mailto := 'mailto:' || v_email || '?subject=' || v_subject_encoded;

    v_blocks := v_blocks || jsonb_build_array(
      jsonb_build_object(
        'type', 'actions',
        'elements', jsonb_build_array(
          jsonb_build_object(
            'type', 'button',
            'text', jsonb_build_object(
              'type', 'plain_text',
              'text', 'Reply via email'
            ),
            'url', v_mailto
          )
        )
      )
    );
  end if;

  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('blocks', v_blocks),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  exception when others then
    raise log 'slack feedback notify failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_feedback_created_slack_notify on public.feedback;
create trigger on_feedback_created_slack_notify
after insert on public.feedback
for each row execute function public.notify_slack_on_feedback();
