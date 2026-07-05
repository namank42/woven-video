# Docs Digest - Local Real R2 Provider Smoke - 2026-07-05

## Cloudflare R2 Workers API (context7: `/websites/developers_cloudflare_r2`)

- A Cloudflare Worker can bind an R2 bucket as an environment binding and use `env.MY_BUCKET.put(key, value, options)`, `env.MY_BUCKET.get(key, options)`, and `env.MY_BUCKET.delete(keyOrKeys)`.
- `put()` accepts `ReadableStream`, `ArrayBuffer`, typed arrays, string, `Blob`, or `null`, so streaming `request.body` into R2 from an upload route is supported.
- `put()` supports HTTP metadata, including content type. `get()` returns an object body stream plus metadata; `object.writeHttpMetadata(headers)` and `object.httpEtag` are the documented response helpers.
- R2 writes and deletes are documented as strongly consistent after the Promise resolves. `delete()` supports one key or an array of up to 1000 keys per call.
- R2 lifecycle rules can delete objects by age, date, or prefix and can abort incomplete multipart uploads. A dev bucket can use lifecycle cleanup as a backup for orphaned local smoke-test objects.
- R2 buckets are private by default. Public buckets and `r2.dev` exist, but Woven should keep objects private and serve them through token-checked Worker routes rather than exposing raw bucket URLs.
- Source: Context7 `/websites/developers_cloudflare_r2`, queried 2026-07-05:
  - `r2/api/workers/workers-api-reference/index.md`
  - `r2/api/workers/workers-api-usage/index.md`
  - `r2/get-started/workers-api/index.md`
  - `r2/objects/upload-objects/index.md`
  - `r2/buckets/object-lifecycles/index.md`
  - `r2/buckets/public-buckets/index.md`

## Cloudflare Workers / Wrangler Environments (context7: `/websites/developers_cloudflare_workers`)

- Wrangler environments support separate deploy targets from one Worker project. Deploying an environment creates a distinct Worker name based on the top-level Worker name and environment name.
- Environment-specific Wrangler config can override routes and vars, which is enough for separate production and dev media domains such as `media.woven.video` and `media-dev.woven.video`.
- Worker variables and bindings are configured in Wrangler config, while secrets are uploaded separately with `wrangler secret put` or set in the Cloudflare dashboard.
- Docs show environment-specific routes and vars under `env.<name>`, including multiple production routes.
- Source: Context7 `/websites/developers_cloudflare_workers`, queried 2026-07-05:
  - `workers/wrangler/environments`
  - Worker variables, secrets, and bindings docs

## Design Implications For Woven

- Use the existing Worker upload/download shape for real local provider smoke tests, but deploy a public dev Worker environment instead of using `wrangler dev` on `localhost`.
- Bind the dev Worker to a separate `woven-media-dev` R2 bucket and route it through `https://media-dev.woven.video`.
- Keep production completion semantics Worker-owned: after upload, production Worker calls the production app internal completion endpoint.
- For local smoke tests, avoid a public tunnel by adding an explicit local completion path after successful PUT. The local app creates the pending asset row, the dev Worker stores bytes in `woven-media-dev`, and the local backend marks the local Supabase asset uploaded.
- Normal automated tests should not hit Cloudflare. Real R2/Fal should be opt-in provider smoke only, with lifecycle cleanup on `woven-media-dev` as a safety net.
