-- 20260523160000_extend_analytics_events_names.sql
-- Adds v2 event names: message_sent, app_foregrounded, feature_used, error_surfaced.
-- Replaces the CHECK constraint atomically — Postgres lets us drop+add in one
-- transaction so the table never has a stale constraint window.

alter table public.analytics_events
  drop constraint analytics_events_event_name_check;

alter table public.analytics_events
  add constraint analytics_events_event_name_check
  check (event_name = any (array[
    'app_launched',
    'session_started',
    'sheet_opened',
    'command_invoked',
    'feedback_submitted',
    'message_sent',
    'app_foregrounded',
    'feature_used',
    'error_surfaced'
  ]));
