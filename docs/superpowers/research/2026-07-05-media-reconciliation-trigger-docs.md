# Docs Digest - Media Reconciliation Trigger Options - 2026-07-05

## Trigger.dev SDK (context7: /triggerdotdev/trigger.dev) - v4.5.0 installed

- Installed package: `@trigger.dev/sdk` v4.5.0.
- Backend/server code should trigger a task with a type-only task import plus `tasks.trigger<typeof taskType>(taskId, payload, options)` from `@trigger.dev/sdk`.
- Trigger options used by this design are current v4 option names: `idempotencyKey`, `concurrencyKey`, `queue`, and `tags`.
- `tags` can be a string or string array when triggering. Tags are visible/filterable in the Trigger.dev dashboard and via `runs.list({ tag })`.
- Trigger.dev currently limits a run to 10 tags. The media dispatch design must keep its tag list below that limit.
- Scheduled reconciliation can remain a code-defined scheduled task via `schedules.task({ id, cron, run })`. Docs show both a cron string and a cron object with `pattern` and `timezone`.
- `wait.for({ seconds })` remains the documented way to pause inside a task run. This supports the existing provider-polling loop design.

## Design Implications

- Keep `dispatchMediaJob` as the single wrapper around `tasks.trigger` so idempotency, queue, concurrency, and tags stay consistent across create, reconcile, and webhook dispatch sources.
- Add dispatch source to the wrapper payload/options instead of duplicating `tasks.trigger` calls at each caller.
- Use tags for observability, but keep the total under 10. The proposed tags are: `media`, `media-job:<jobId>`, `media-kind:<kind>`, `media-queue:<queueName>`, `media-model:<modelId>`, `media-dispatch-source:<source>`, and `media-user:<userId>`.
- Keep scheduled reconciliation as `schedules.task`; no new external scheduler is needed for this fix.

## Sources

- Context7 `/triggerdotdev/trigger.dev`, queried 2026-07-05:
  - task triggering from backend code with `tasks.trigger`
  - trigger options including `idempotencyKey`, `queue`, and `concurrencyKey`
  - run tags, tag filtering, and 10-tag limit
  - scheduled tasks with `schedules.task`
  - waits with `wait.for`
