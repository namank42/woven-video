# Docs Digest — Next.js Model Catalog Route — 2026-07-12

## Next.js (context7: `/vercel/next.js/v16.2.2`) — v16.2.3 installed

- App Router Route Handlers are exported HTTP-method functions in `app/**/route.ts` and use the Web
  `Request` and `Response` APIs directly.
- `Response.json(body, init?)` is the supported native JSON response path used by the existing model
  catalog and API error helper.
- Route Handlers are not cached by default. `export const dynamic = "force-dynamic"` explicitly keeps
  the authenticated catalog request-time and uncached.
- The selection-policy validation can return a `Response.json` error before asynchronous Gateway
  enrichment; it does not require `NextRequest`, `NextResponse`, or a different route convention.
- Sources: Context7 `/vercel/next.js/v16.2.2`; installed
  `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` for v16.2.3.
