# Docs Digest - Kimi K3 Soft Retirement - 2026-09-04

Context7 is not connected in this workspace. The digest uses installed package
documentation/source and current official Supabase documentation instead.

## Supabase JavaScript (installed source) - v2.105.1

- A table read uses `.from("table").select("columns")` followed by chainable
  `.eq("column", value)` filters. Multiple `.eq()` filters combine as `AND`.
- The catalog query can therefore add `.eq("catalog_visible", true)` without a
  raw PostgREST filter or a new dependency.
- Keep `.select(...)` before filters, matching the official v2 examples and the
  repository's existing `listHostedChatModels()` and `getHostedChatModel()` calls.
- Source: installed `node_modules/@supabase/supabase-js/package.json` and
  https://supabase.com/docs/reference/javascript/using-filters-eq

## Supabase CLI - v2.101.0 installed

- `supabase db push --linked` applies all local migrations missing from the
  linked remote migration history, in timestamp order.
- `supabase db push --linked --dry-run` lists pending migrations without applying
  them and must be run before each production push.
- `supabase migration list --linked` compares local and remote migration history.
- Remote schema changes must be represented by migration files; do not bypass
  migration history through direct production schema edits.
- Because every pending migration is applied, the Phase 2 hard-disable migration
  must not be created until the seven-day and zero-traffic gates pass.
- Source: installed `supabase db push --help`,
  https://supabase.com/docs/reference/cli/introduction, and
  https://supabase.com/docs/guides/deployment/database-migrations

## Next.js Route Handlers - v16.2.3 installed

- App Router Route Handlers remain named HTTP method exports in `route.ts` and
  use Web `Request` and `Response` APIs.
- Route Handlers are uncached by default. The existing model route also declares
  `export const dynamic = "force-dynamic"`; no additional cache invalidation API
  is needed for the visibility filter.
- Database and network access are request-time dynamic operations in Next.js 16.
- Source: installed
  `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
