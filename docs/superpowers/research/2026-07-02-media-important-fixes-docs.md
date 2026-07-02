# Docs Digest - Media Important Fixes - 2026-07-02

## Next.js Route Handlers - `next@16.2.3` installed

- Route handlers live in `app/**/route.ts` and expose Web `Request`/`Response` APIs.
- Dynamic route params are promises in this Next version, but the routes in this plan do not add new dynamic params.
- `export const runtime = "nodejs"` is the right runtime for Node crypto, Supabase admin calls, and webhook verification.
- Use `await request.arrayBuffer()` before JSON parsing when a signature verifier needs the exact raw request body.
- Source: local docs in `node_modules/next/dist/docs`, already digested in `docs/superpowers/research/2026-07-01-hosted-generations-docs.md`.

## Cloudflare R2 Workers API - context7 `/websites/developers_cloudflare_r2`

- A Worker with an R2 binding can delete objects with `await env.MY_BUCKET.delete(key)`.
- The binding also supports batch deletion with `await env.MY_BUCKET.delete(keys)`, where `keys` is an array; Cloudflare documents a maximum of 1000 keys per call.
- R2 object deletion is strongly consistent. After a successful delete, a following read for the same key should not see the object.
- R2 lifecycle rules can be used as a backup cleanup path by prefix and age, but application cleanup should still delete temp inputs and expired outputs directly.
- Source: Context7 Cloudflare R2 docs, queried 2026-07-02.

## Fal Queue + Webhooks - `@fal-ai/client@1.10.1` installed

- The installed SDK exposes `fal.queue.submit(endpointId, { input, webhookUrl, abortSignal })`.
- `webhookUrl` is optional on the SDK type and sends a callback to the given URL when the queued request completes.
- The installed SDK does not expose a webhook-verification helper; verification has to live in app code.
- Fal webhook signature docs use these headers:
  - `x-fal-webhook-request-id`
  - `x-fal-webhook-user-id`
  - `x-fal-webhook-timestamp`
  - `x-fal-webhook-signature`
- The signed message is:

```text
<request-id>\n<user-id>\n<timestamp>\n<sha256-hex-raw-body>
```

- Validate the timestamp within a 5-minute tolerance before accepting the payload.
- The signature is hex-encoded Ed25519 and must verify against Fal JWKS public keys.
- The current digest did not include a stable JWKS URL. The implementation plan therefore uses a required `FAL_WEBHOOK_JWKS_URL` env var instead of hard-coding an unverified endpoint.
- Source: Context7 Fal docs, queried 2026-07-02; installed SDK source/types in `node_modules/@fal-ai/client/src/queue.d.ts`.

## Supabase CLI + Local DB

- `supabase start` starts the local Supabase stack.
- `supabase db reset` recreates local Postgres and applies all migrations in `supabase/migrations`.
- Integration tests that exercise SQL RPC behavior should be opt-in and require a local Supabase URL/service role key, so the normal unit suite stays fast and does not require Docker.
- Source: Context7 Supabase CLI docs, queried 2026-07-02.

## Vercel Cron Jobs - official docs opened 2026-07-02

- Cron jobs are configured through `vercel.json` with a `crons` array containing `{ "path": "...", "schedule": "..." }`.
- Vercel invokes cron paths with HTTP `GET`.
- Cron requests include user agent `vercel-cron/1.0` and an `x-vercel-cron-schedule` header containing the cron expression.
- Vercel recommends setting `CRON_SECRET`; when present, Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>`.
- Pro plans support once-per-minute cron schedules, but this plan uses a daily schedule for media cleanup.
- Cron jobs are included on all plans, but each run consumes a normal Vercel Function invocation.
- Vercel says cron delivery can be missed or duplicated, so cleanup jobs should be idempotent and reconciliation-based.
- Source: official Vercel docs:
  - `https://vercel.com/docs/cron-jobs`
  - `https://vercel.com/docs/cron-jobs/manage-cron-jobs`
  - `https://vercel.com/docs/cron-jobs/usage-and-pricing`
