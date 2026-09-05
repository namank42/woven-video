# Docs digest: telemetry production deployment — 2026-09-05

## Supabase CLI 2.101.0 and hosted functions

- Installed `supabase functions deploy --help` supports a single function name,
  `--project-ref`, `--no-verify-jwt`, `--use-api`, and `--import-map`.
- Pass the existing `supabase/functions/deno.json` explicitly for server-side
  bundling; implicit discovery failed to resolve the shared SDK bare import.
  The map pins `jsr:@supabase/supabase-js@2.105.1`.
- `verify_jwt=false` bypasses the gateway JWT-only check, not the function's
  application authentication. Keep exact public-key admission and Auth-backed
  user JWT verification; never fall back to anonymous on an invalid user JWT.
- Hosted functions expose legacy `SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY`, plus named-key JSON dictionaries
  `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS`.
- New publishable keys belong in `apikey`, not a Bearer header.
- Production evidence: the published legacy anon key matches the desktop key,
  while its SHA-256 differs from the hosted reserved anon-key metadata. REST
  accepts the desktop key, but the original strict runtime-key comparison
  rejects it. Use `WOVEN_TELEMETRY_PUBLIC_ANON_KEY` as an explicit deployment
  setting containing only the independently verified public legacy anon key;
  never a service/secret key. Keep the reserved-key fallback for local setups.

Sources: installed CLI help and Context7 `/supabase/cli`, `/supabase/supabase`:

- https://github.com/supabase/cli/blob/develop/apps/cli/docs/go-cli-reference.md
- https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/functions/secrets.mdx
- https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/getting-started/migrating-to-new-api-keys.mdx

The observed runtime/public-key mismatch is deployment evidence, not a claim
that the docs guarantee such a mismatch. Do not print credentials or env dumps.
