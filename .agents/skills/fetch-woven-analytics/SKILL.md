---
name: "fetch-woven-analytics"
description: "Fetch and summarize Woven product analytics from the prod Supabase DB. Use when asked to \"fetch analytics\", \"what have users been doing\", \"summarize prod analytics\", \"analytics by user\", \"did <user> create a reel\", or any read of the prod analytics_events stream. Resolves user_id to email and cross-references billing tables."
---

# Fetch Woven Analytics

Read-only pull + summary of the prod product-analytics stream (`analytics_events`)
for the Woven Harness desktop app. Resolves anonymous `user_id` UUIDs to emails,
and cross-references billing tables so "what did they do" can be answered with
"…and did they actually generate/render anything."

## When to use
- "fetch analytics" / "pull prod analytics" / "what have people been doing"
- "give it to me by user" / "breakdown per user" / "<user>'s activity"
- "did <user> create a reel / generate anything"
- Any read of `public.analytics_events` in prod

## How it connects (important context)
- The table stores **only `user_id` (a UUID)** — no email/PII. The migration was
  deliberately built flat & typed (no JSONB) to keep the privacy surface narrow.
- Reads go through **service-role tooling**, not the anon key (RLS blocks reads).
- There is **no DB password / psql access** locally — only `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY`. So we use the **PostgREST REST API** (`/rest/v1/…`)
  and the **GoTrue admin API** (`/auth/v1/admin/users`) with the service key.
- Prod project ref: `rlhjpovwwsqdeklhnvfl` ("Woven Video"). Creds live in `.env.prod`.

## Run it

```bash
set -a; source .env.prod >/dev/null 2>&1; set +a
python3 .agents/skills/fetch-woven-analytics/scripts/analytics.py            # overall + per-user table
python3 .agents/skills/fetch-woven-analytics/scripts/analytics.py --user rfro  # + chronological timeline
python3 .agents/skills/fetch-woven-analytics/scripts/analytics.py --json      # raw aggregated JSON
```

The script (stdlib only, no deps) pages through `analytics_events`, builds the
user→email map, counts each user's `generation_jobs` and `usage_events`, and prints:
overall totals, events-by-name, by-day, app versions, a per-user table, and an
optional single-user timeline (`--user <email|uuid|substring>`).

## Reading the output
- **Event enum** (what gets logged): `app_launched`, `session_started`,
  `sheet_opened`, `command_invoked`, `feedback_submitted`, `message_sent`,
  `app_foregrounded`, `feature_used`, `error_surfaced`. Detail lives in
  `event_target` (e.g. `feature_used → reel_editor_opened`).
- **`reel_editor_opened` ≠ a finished reel.** It fires on opening the editor
  (observed: always during onboarding, alongside `onboarding_first_reel_used`).
  There is **no "reel created/exported/rendered" event** in the enum.
- **To know if a reel/generation actually happened**, use the `gen` / `usg`
  columns: nonzero `generation_jobs` / `usage_events` = the user ran a
  **Woven-hosted, billed** generation. `0/0` = never did. Caveat: purely-local
  renders (own keys, on-device) wouldn't hit these tables, so `0/0` rules out a
  *billed* generation but can't 100% rule out a local-only export.
- **`access_mode_changed`** = the local-vs-Woven-hosted model toggle (see
  `docs/billing-architecture.md`); the table records that it changed, not the new value.

## Privacy
This joins emails to behavior via the service-role admin endpoint — fine for a
private internal look, but **keep emails out of anything public** (Slack posts,
committed files, the changelog). Don't write the raw output to a tracked file.

## Extending
- New event names land in `supabase/migrations/*extend_analytics_events_names*`.
  No script change needed — counts pick them up automatically.
- To capture *which* value a toggle changed to (e.g. which access mode), the app
  would need to encode it in `event_target` or a new column; the table has no
  slot for it today.
