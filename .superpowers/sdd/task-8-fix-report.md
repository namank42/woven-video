Task 8 verification fix report

Root cause:
- `lib/media/worker.ts` used `.then(...).catch(...)` on `admin.rpc(...)`, but the Supabase mock/client path is typed as `PromiseLike<void>` in this context, so `catch` was not available to TypeScript.
- `tests/media/fal-webhooks.test.ts` used `module` as a local identifier in several dynamic imports, which triggers `@next/next/no-assign-module-variable`.

Changes:
- Reworked `withLeaseHeartbeat` to use an async IIFE inside `setInterval` with `try/catch` instead of chaining `.catch(...)`.
- Renamed all local `module` bindings in the Fal webhook tests to `webhookModule`.

Commands and results:
- `./node_modules/.bin/tsc --noEmit` passed.
- `./node_modules/.bin/eslint` passed with two pre-existing warnings:
  - `app/opengraph-image.tsx` unused eslint-disable directive.
  - `workers/media/index.ts` anonymous default export warning.
- `./node_modules/.bin/vitest run tests/media/worker.test.ts tests/media/fal-webhooks.test.ts` passed: 2 files, 37 tests.

Files changed:
- `lib/media/worker.ts`
- `tests/media/fal-webhooks.test.ts`

Concerns:
- ESLint still reports the two unrelated warnings above, but no errors remain in the touched files.
