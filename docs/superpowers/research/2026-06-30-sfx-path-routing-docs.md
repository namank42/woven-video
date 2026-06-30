# Docs Digest - SFX Path Routing - 2026-06-30

## Vercel project routing and monorepos (context7: /websites/vercel, /websites/vercel_monorepos)
- Vercel supports hosting multiple projects under one domain by assigning the domain to a main project and proxying path requests to upstream project domains with `rewrites`.
- Vercel monorepos support importing the same Git repository multiple times with different Root Directory settings. Each imported directory becomes a separate Vercel Project.
- Vercel Microfrontends treat each application as an independent Vercel project. The applications can live in a monorepo or in separate repositories; path and production routing work the same either way.
- Microfrontends use a `microfrontends.json` file in the default application for path routing. For a single mounted static app, a normal rewrite is simpler.
- Source: https://vercel.com/docs/monorepos/monorepo-faq
- Source: https://vercel.com/docs/monorepos
- Source: https://vercel.com/docs/microfrontends
- Source: https://vercel.com/docs/microfrontends/path-routing

## Next.js rewrites and multi-zones (local docs: node_modules/next/dist/docs, Next 16.2.3 installed)
- `next.config.ts` can define external rewrites using `source` and `destination`.
- Multi-zones route requests for a path to a different app using rewrites from the default app.
- Cross-zone links should use plain `<a>` tags instead of `next/link`, because Next client prefetch/soft navigation is not meant to cross app boundaries.
- Source: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.md`
- Source: `node_modules/next/dist/docs/01-app/02-guides/multi-zones.md`

## Astro base paths (context7: /withastro/docs)
- Astro's `base` config defines the deployment base path. For `/sfx`, set `base: "/sfx"`.
- Astro's `site` config should be the deployed origin used for canonical URLs and sitemaps. For this migration, use `site: "https://www.woven.video"`.
- When `base` is used, static asset imports and URLs should be prefixed with the base path. Astro exposes it as `import.meta.env.BASE_URL`.
- Source: https://docs.astro.build/en/reference/configuration-reference/#base
- Source: https://docs.astro.build/en/reference/configuration-reference/#site

## Cloudflare Workers routes (official docs)
- Cloudflare Worker routes map URL patterns to Workers for host/path matches, and route patterns can include paths and wildcards.
- This would only be the right primary solution if `www.woven.video` traffic is intentionally routed through Cloudflare. The live `www.woven.video` response currently comes from Vercel, so the simpler path is Vercel routing.
- Source: https://developers.cloudflare.com/workers/configuration/routing/routes/
