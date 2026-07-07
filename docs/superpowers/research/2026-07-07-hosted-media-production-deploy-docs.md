# Docs Digest - Hosted Media Production Deploy - 2026-07-07

Gathered for deploying the `feat/credit-models` hosted-media backend to production.

## Trigger.dev Cloud / SDK (context7: `/triggerdotdev/trigger.dev`) - v4.5.0 installed

- Deploy tasks with the Trigger CLI. Current docs show `npx trigger.dev@latest deploy`,
  `pnpm dlx trigger.dev@latest deploy`, and CI deploys authenticated by
  `TRIGGER_ACCESS_TOKEN`.
- A production GitHub Actions deploy runs the deploy command without an `--env` flag;
  staging deploys use `--env staging`.
- Server code triggers tasks with `tasks.trigger<typeof task>("task-id", payload)`.
- Woven pins both `@trigger.dev/sdk` and the local `trigger.dev` CLI package at `4.5.0`;
  the repo script is `pnpm run trigger:deploy`, which runs `pnpm exec trigger deploy`.
- Source: Context7 `/triggerdotdev/trigger.dev`, queried 2026-07-07; repo
  `package.json`.

## Vercel Cron / Production Env (context7: `/websites/vercel`)

- Production deploys can be created with `vercel deploy --prod`; projects may also
  deploy production automatically from the production branch.
- Vercel cron jobs are configured in `vercel.json` with `crons: [{ path, schedule }]`.
  Cron jobs are invoked only for production deployments.
- Vercel cron invokes the production deployment URL with HTTP `GET`.
- If `CRON_SECRET` is configured, Vercel sends `Authorization: Bearer $CRON_SECRET`.
  Vercel recommends a random value of at least 16 characters.
- Cron requests also include `user-agent: vercel-cron/1.0` and
  `x-vercel-cron-schedule`.
- Source: Context7 `/websites/vercel`, queried 2026-07-07.

## Cloudflare Workers + R2 (context7: `/websites/developers_cloudflare_r2`)

- A Worker binds an R2 bucket in Wrangler config with an `r2_buckets` entry containing
  a JavaScript binding name and a bucket name.
- Wrangler JSONC supports R2 bucket bindings; Woven uses `MEDIA_BUCKET` bound to
  `woven-media` in production and `woven-media-dev` in the `dev` environment.
- R2 lifecycle rules can delete objects by prefix/age and abort incomplete multipart
  uploads. Woven uses explicit app cleanup for production deletion and a lifecycle
  safety net for dev smoke objects.
- Worker secrets are not stored in `wrangler.jsonc`; upload them with
  `wrangler secret put` per environment before deploy.
- Source: Context7 `/websites/developers_cloudflare_r2`, queried 2026-07-07; existing
  Woven digests `2026-07-05-local-real-r2-smoke-docs.md` and
  `2026-07-02-media-important-fixes-docs.md`.

## Existing Woven Docs Reused

- `docs/superpowers/research/2026-07-01-hosted-generations-docs.md`: Next route
  handler limits, R2/Worker upload shape, Fal and ElevenLabs provider implications.
- `docs/superpowers/research/2026-07-03-trigger-media-executor-docs.md`: Trigger
  task definitions, schedules, waits, queues, idempotency, and local/prod executor
  shape.
- `docs/superpowers/research/2026-07-05-media-review-fixes-docs.md`: Fal webhook
  path hints, Fal status/error semantics, Trigger idempotency TTL, and provider
  failure handling.
- `docs/superpowers/research/2026-07-05-local-real-r2-smoke-docs.md`: deployed dev
  Worker/R2 setup for local provider smoke tests.
