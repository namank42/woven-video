-- Adds an optional `logs` column to feedback for opt-in sidecar log attachments.
-- 200000-char cap (~200KB) gives generous headroom over the client's ~50KB target
-- while still bounding row size.
--
-- Also updates the Slack notify trigger so when logs are attached we flag it
-- with a 📎 in the footer and add a "View full row in Supabase" action button.
-- Logs themselves are not inlined in Slack — read the full row via Studio.

alter table public.feedback
  add column logs text
  check (logs is null or char_length(logs) <= 200000);

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
  v_footer text;
  v_subject text;
  v_subject_encoded text;
  v_mailto text;
  v_studio_url text;
  v_actions jsonb;
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

  v_footer := '_' || v_diagnostics || '_  •  `' || v_short_id || '`';
  if new.logs is not null then
    v_footer := v_footer || E'\n📎 _logs attached_';
  end if;

  v_blocks := jsonb_build_array(
    jsonb_build_object(
      'type', 'section',
      'text', jsonb_build_object(
        'type', 'mrkdwn',
        'text',
          '💬 *Feedback from* `' || coalesce(v_email, '(unknown)') || '`' ||
          E'\n\n> ' || replace(v_preview, E'\n', E'\n> ') ||
          E'\n\n' || v_footer
      )
    )
  );

  -- Build action buttons (Reply when email known, View in Supabase always).
  v_actions := '[]'::jsonb;

  if v_email is not null then
    v_subject := 'Re: Your Woven feedback [' || v_short_id || ']';
    v_subject_encoded := v_subject;
    v_subject_encoded := replace(v_subject_encoded, '%', '%25');
    v_subject_encoded := replace(v_subject_encoded, ' ', '%20');
    v_subject_encoded := replace(v_subject_encoded, ':', '%3A');
    v_subject_encoded := replace(v_subject_encoded, '[', '%5B');
    v_subject_encoded := replace(v_subject_encoded, ']', '%5D');
    v_mailto := 'mailto:' || v_email || '?subject=' || v_subject_encoded;

    v_actions := v_actions || jsonb_build_array(
      jsonb_build_object(
        'type', 'button',
        'text', jsonb_build_object('type', 'plain_text', 'text', 'Reply via email'),
        'url', v_mailto
      )
    );
  end if;

  -- Prod Studio link. Local triggers point at the prod ref by design —
  -- the secret should not be seeded locally for routine dev anyway.
  v_studio_url :=
    'https://supabase.com/dashboard/project/rlhjpovwwsqdeklhnvfl/sql/new?content=' ||
    'select%20*%20from%20public.feedback%20where%20id%20%3D%20%27' ||
    new.id::text || '%27%3B';

  v_actions := v_actions || jsonb_build_array(
    jsonb_build_object(
      'type', 'button',
      'text', jsonb_build_object('type', 'plain_text', 'text', 'View full row in Supabase'),
      'url', v_studio_url
    )
  );

  v_blocks := v_blocks || jsonb_build_array(
    jsonb_build_object('type', 'actions', 'elements', v_actions)
  );

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
