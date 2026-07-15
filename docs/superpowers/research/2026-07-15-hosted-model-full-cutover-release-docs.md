# Docs Digest — Hosted Model Full Cutover Release — 2026-07-15

## Supabase CLI (context7: `/supabase/cli`) — v2.101.0 installed

- `supabase migration list` compares local migration files with the linked project's remote migration history.
- `supabase db push --dry-run` prints the pending linked-project migrations without applying them.
- `supabase db push` applies pending local migrations to the linked production project; `--linked` is the default.
- `supabase migration repair` changes migration-history state and is reserved for an actual history mismatch. It is not a routine release or rollback command.
- A rollback after production cutover must be a new forward migration. Do not edit or repair a migration that production has already recorded.
- Source: Context7 `/supabase/cli`, queried 2026-07-15 from the official Supabase CLI reference.

## Vercel (context7: `/websites/vercel`)

- Official CLI production deployment is `vercel deploy --prod`; production can be inspected with `vercel list --prod`, `vercel inspect`, and production logs.
- Vercel can roll production traffic back to a previous deployment with `vercel rollback <deployment-url-or-id>` and verify it with `vercel rollback status`.
- An existing good deployment can also be promoted with `vercel promote <deployment-url>`.
- This repository does not have a locally installed Vercel CLI or a checked-in `.vercel` link. Its verified production path is Git integration: GitHub status for current `main` commit `8f9f21d` reports a successful Vercel production deployment in project `wovengroup/woven-video`.
- Therefore the release plan uses an approved PR plus merge to `main` as the production deploy trigger, and GitHub's Vercel commit status as the deployment gate. Vercel dashboard rollback is the fallback if CLI access is unavailable.
- Source: Context7 `/websites/vercel`, queried 2026-07-15 from the official Vercel CLI/deployment/rollback documentation; repository GitHub deployment status checked read-only on 2026-07-15.
