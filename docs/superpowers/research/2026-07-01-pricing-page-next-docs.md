# Docs Digest - Pricing Page Next.js Rendering - 2026-07-01

## Next.js (context7: /vercel/next.js/v16.2.2) - v16.2.3 installed
- The installed project uses Next.js `16.2.3`.
- For static metadata, export a `Metadata` object from `page.tsx` or `layout.tsx`.
- `metadata` and `generateMetadata` are Server Component-only exports.
- Use the static `metadata` object when metadata does not depend on request-time data.
- Dynamic metadata, external data fetches, request-specific APIs, or database reads can make rendering dynamic; the pricing page should avoid those for the public rate table.
- Plain imported TypeScript data modules are safe for this design because they do not introduce request-time behavior.
- Sources:
  - Context7 `/vercel/next.js/v16.2.2`, query about static App Router pricing page and Metadata
  - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`
