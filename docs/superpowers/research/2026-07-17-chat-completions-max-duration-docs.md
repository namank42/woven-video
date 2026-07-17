# Docs Digest — Hosted chat maximum duration — 2026-07-17

## Next.js (context7: `/vercel/next.js/v16.2.2`) — `16.2.3` installed

- An App Router `route.ts` file sets its maximum server-side execution time with a statically
  analyzable named export in seconds:

  ```ts
  export const maxDuration = 800;
  ```

- Deployment platforms read `maxDuration` from the Next.js build output and enforce the route's
  execution limit.
- The installed Next.js 16.2.3 guide at
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`
  documents the same named-export contract. Context7's closest versioned source was 16.2.2.
- Sources:
  - Context7 `/vercel/next.js/v16.2.2`
  - installed Next.js 16.2.3 documentation

## Vercel Functions (context7: `/websites/vercel`) — current platform docs

- For Next.js App Router functions, Vercel directs projects to configure duration in the route
  definition with the named `maxDuration` export rather than an App Router `config` object.
- With Fluid Compute, Pro functions default to 300 seconds and have a generally available maximum
  of 800 seconds. The Woven project is on Pro with Fluid Compute enabled.
- The duration includes request processing and sending streamed responses. If the invocation does
  not finish before the configured duration, Vercel terminates it with HTTP 504 and
  `FUNCTION_INVOCATION_TIMEOUT`.
- A route-level export limits the change to `/api/v1/chat/completions`; changing the project default
  in the Vercel dashboard would affect every function and is not required.
- Increasing the limit changes only the ceiling. Vercel bills Fluid Compute using active CPU time
  and provisioned memory time; waiting on model I/O does not count as active CPU time.
- Sources:
  - Context7 `/websites/vercel`
  - https://vercel.com/docs/functions/configuring-functions/duration
  - https://vercel.com/docs/functions/limitations
