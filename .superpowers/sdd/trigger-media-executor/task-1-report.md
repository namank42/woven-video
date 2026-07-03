# Task 1 Report: Add Trigger.dev SDK, Config, And Dispatch Helper

## Implemented
- Added `@trigger.dev/sdk` to `package.json` and updated `pnpm-lock.yaml`.
- Replaced the media worker scripts with the Trigger.dev script set from the task brief.
- Added `trigger.config.ts` with `TRIGGER_PROJECT_REF` validation, `./trigger` discovery, dev retries, and `maxDuration: 3_600`.
- Added `trigger/media.ts` with the `process-media-job` Trigger task stub.
- Added `lib/media/trigger-dispatch.ts` with:
  - `DispatchMediaJobPayload`
  - `DispatchMediaJobResult`
  - `dispatchMediaJob(...)`
  - `mediaQueueForKind(...)`
  - `mediaConcurrencyKey(...)`
- Added `tests/media/trigger-dispatch.test.ts` covering:
  - Trigger dispatch payload/options
  - queue selection for image/video/audio

## Verification
- Red phase: added the dispatch test before the implementation existed.
- Green phase: ran `npm exec --yes pnpm@10 exec vitest run tests/media/trigger-dispatch.test.ts`
- Result: 1 file passed, 2 tests passed.

## Notes
- The local shell did not have a `pnpm` binary, so the package add and test runs were executed through `npm exec --yes pnpm@10 ...` to match the repository's existing pnpm store layout.
- The task helper currently dispatches `process-media-job` with idempotency key equal to `jobId`, per-user concurrency, queue selection by kind, and media/model/user tags.
