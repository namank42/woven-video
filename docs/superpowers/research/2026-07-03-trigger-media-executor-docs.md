# Docs Digest - Trigger.dev Media Executor - 2026-07-03

## Trigger.dev Cloud / SDK (context7: /websites/trigger_dev)

- Tasks are defined with `task()` from `@trigger.dev/sdk`; scheduled tasks use `schedules.task()`.
- `trigger.config.ts` uses `defineConfig({ project, dirs, retries, maxDuration })`.
- The CLI flow is `npx trigger.dev@latest login`, `npx trigger.dev@latest init`, `npx trigger.dev@latest dev`, and `npx trigger.dev@latest deploy`.
- Trigger.dev Cloud runtime/API calls use `TRIGGER_SECRET_KEY`. CI or non-interactive CLI deploy authentication uses `TRIGGER_ACCESS_TOKEN`.
- A Next.js App Router server action or route handler can trigger a task with `tasks.trigger<typeof task>("task-id", payload)`.
- A task object can also be triggered directly with `myTask.trigger(payload, options)`.
- Trigger options support `idempotencyKey`, `concurrencyKey`, `queue`, `tags`, and machine presets. Queue options can include a `name` and `concurrencyLimit`; v4 docs also show dynamic queues with `queue: "paid-users"` plus `concurrencyKey`.
- `wait.for(...)` pauses task execution. Trigger.dev docs state waits longer than 5 seconds checkpoint the task, and Trigger.dev Cloud does not count waits toward compute cost or duration.
- Tasks support retry settings at the task level and default retry settings in `trigger.config.ts`.
- Scheduled tasks can be defined in code with `schedules.task({ id, cron, run })`, which is suitable for media-job reconciliation sweeps.
- Example docs show durable video-processing workflows with idempotency keys, child tasks, external API calls, downloads, uploads, and database updates.

## Design Implications For Woven Hosted Media

- Use Trigger.dev Cloud as the media executor in both local and production environments.
- Keep Supabase as the source of truth for job state, billing reservations, usage events, model catalog, and output asset metadata.
- Trigger one `process-media-job` run per Woven media job with `idempotencyKey = jobId`.
- Use queue/concurrency controls for provider/model classes, and use `concurrencyKey` for per-user limits when needed.
- Use `wait.for(...)` between provider polls so Fal waiting time is durable and cheap.
- Use `schedules.task(...)` for reconciliation that retriggers stale queued/waiting jobs idempotently.
- Do not keep the always-on polling worker as the supported execution path; refactor shared execution logic around processing a specific `jobId`.

## Sources

- Context7 `/websites/trigger_dev`, queried 2026-07-03:
  - task definition and Next.js triggering docs
  - task trigger options with idempotency, queues, concurrency keys, and tags
  - wait/checkpoint behavior and cloud compute accounting
  - schedules and retry examples
  - CLI login/init/dev/deploy workflow
