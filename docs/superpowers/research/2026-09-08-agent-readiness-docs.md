# Woven agent readiness — protocol and implementation notes

## Sources checked

- Installed Next.js 16.2.3: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{proxy,route,not-found}.md`, `01-app/02-guides/backend-for-frontend.md`, and `05-config/01-next-config-js/rewrites.md`. Context7 `/vercel/next.js/v16.2.2` corroborates the APIs; the installed docs are authoritative for this checkout.
- https://acceptmarkdown.com/guides/accept-parsing and https://acceptmarkdown.com/guides/caching-cdn
- https://llmstxt.org/ (v2, including Markdown links and describedby discovery)
- https://developers.google.com/search/docs/appearance/site-names
- Installed negotiator 1.0.0 README: `new Negotiator({ headers: { accept } }).mediaType(availableTypes)` handles weights, specificity, and exclusions. Missing Accept means unrestricted; empty Accept accepts none. Charset is included in supported types to match explicit UTF-8 requests.
- `is-agentic` 1.0.1 package README and CLI, retrieved from npm into `/tmp/woven-is-agentic`. It retrieves a stored remote report; it does not force a new scan and cannot audit localhost directly.

## Design and scope

Keep static HTML pages and existing UI controls. Negotiate only GET/HEAD on `/` and `/docs`; leave RSC, mutations, auth, APIs, and the external `/sfx` rewrite alone. Prefer HTML for unconstrained requests. Return 406 when neither representation is acceptable. The proxy requests Vary: Accept, Accept-Encoding for both variants. Production HTTP testing revealed Next 16.2.3 unconditionally replaces HTML Vary in `next/dist/build/templates/app-page.js`; Markdown retains Accept and HTML retains Next RSC fields. Both variants explicitly set CDN-Cache-Control and Vercel-CDN-Cache-Control to no-store to prevent cross-variant CDN reuse. Full HTML Vary support needs a framework fix or an outer reverse proxy that appends Accept after Next renders. Markdown is private/no-store rather than assuming CDN custom cache-key behavior. Explicit `/index.md` and `/docs/index.md` provide predictable alternatives.

A catch-all route returns a short Markdown body with an explicit 404 and recovery links. Static files, actual routes, and SFX rewrites have precedence. A route handler prevents streaming from committing an accidental 200. Verify missing paths under several prefixes, not just root.

The server-rendered homepage already has sequential H1/H2/H3 headings. Add a noscript FAQ fallback that supplies readable answers without changing the JavaScript-enabled accordion. The latest stored audit describes a low content-to-markup ratio, unlike the earlier heading evidence.

Publish branded `/docs`, link it in the footer and sitemap, and publish `/llms.txt` with H1, blockquote, prose, then H2-delimited Markdown link lists. Documentation and its Markdown representation share content. Document current integration boundaries; do not invent OpenAPI operations, a public API key flow, or an MCP endpoint.

Preserve the live canonical host `https://www.woven.video`; apex already redirects there. Add site/organization alternate names for disambiguation. Search rankings and external listings are outside a code-only change.

## Verification plan

Proxy tests first: Markdown MIME/body, Vary, quality factors, wildcards, exclusions, case, charset, 406, HEAD, RSC and mutation passthrough. Resource tests: 404 status/recovery, llms format, shared FAQ content, sitemap docs, brand schema. Production-build HTTP smoke: every sitemap page, explicit Markdown files, all resource links, HTML/Markdown alternation, missing paths, robots, JSON-LD, raw HTML headings/content, and existing auth/SFX boundaries. Browser smoke: JavaScript-enabled appearance and accordion, plus readable FAQ with JavaScript disabled.

## Deployment follow-up

Deploy before claiming a score improvement. Verify the same HTTP checks on the canonical public host, request a fresh Is Agentic scan through its website, then retrieve the report with `npx is-agentic woven.video --json`. The CLI alone returns the last completed scan. Search Console access is needed for indexing inspection/submission. Supported public API/MCP/auth/webhook commitments and verified company listings require product decisions.

The content ratio check excludes script and style blocks from both text and markup, so JavaScript payload size does not obscure the HTML content metric. Raw HTML still contains more than 500 text characters regardless of that ratio definition.

## Verification results before deployment

- Baseline `is-agentic` 1.0.1: 72/100, stored scan `2026-09-08T04:50:54.906Z`.
- Production build passed with Next 16.2.3; production TypeScript check passed. Targeted ESLint and `git diff --check` passed.
- Full suite: 619 passed, 27 skipped (including opt-in database cases). Final focused suite after review: 54 passed.
- HTTP suite covers all 18 sitemap pages, three Markdown resources and their internal links, robots/sitemap syntax, negotiation, 406, HEAD, five nonexistent path patterns, JSON-LD, sequential headings and the no-JavaScript FAQ.
- Anonymous contact smoke uses non-secret Supabase placeholders locally because this checkout has no Supabase environment; no authenticated operations or form submissions were performed. The SFX rewrite returned its existing external app successfully.
- Browser QA: unchanged homepage appearance; FAQ opens normally with JavaScript; FAQ questions and answers are visible with JavaScript disabled; branded docs render in the existing marketing layout; a docs Markdown link navigates correctly.
- Independent review found standard Cache-Control missing on HTML. Added `private, no-store`, verified through production HTTP tests. No other actionable findings.
- Runtime HTML Vary is overwritten by Next 16.2.3. Standard Cache-Control plus CDN-specific no-store fields prevent variant mixing without changing page rendering. Markdown retains `Vary: Accept, Accept-Encoding`.
- Production canonical baseline: `https://woven.video` redirects once to `https://www.woven.video/`; missing URL already returns HTTP 404.
- Initial production rollback target: `dpl_zC1trMtSXyyDy9mFrJGywBWzw7w6`, `https://woven-video-nawy62xfv-wovengroup.vercel.app`.


## Second iteration

The first live force scan passed Markdown and recoverable 404 checks but stripped the noscript FAQ from its content-ratio calculation. Keep the existing accordion panels mounted so answers are present in ordinary server HTML; the noscript fallback still provides visible, accessible answers without script execution. Base UI 1.3.0 AccordionPanel declarations and implementation document keepMounted.

The scanner also interpreted negative MCP wording as an advertised service. Replace that wording with a precise integration boundary and publish a real, narrowly scoped public discovery API: GET /api/v1/site returns existing public product facts and resource URLs. It does not expose account, billing, generation, or editing operations. The exact proxy bypass prevents auth-cookie refresh on this cacheable public response. HEAD is bodyless; OPTIONS advertises methods; unsupported methods and unknown API URLs return RFC 9457 problem details. Existing private API routes keep their original handling.

OpenAPI 3.1.1 at /openapi.json describes this public interface only. Sources: https://spec.openapis.org/oas/v3.1.1.html and https://www.rfc-editor.org/rfc/rfc9457.html. /agents.md provides product-fit guidance and limits; llms.txt links the contract and guide. robots.txt allows only the exact public /api/v1/site URL while preserving the existing /api/ exclusion.

Ora refresh API checked at https://ora.ai/docs: POST /api/scan?include=essentials with body {"url":"https://woven.video","force":true} bypasses its six-hour freshness cache. Force scans have a stricter daily quota. Is Agentic has a separate Rescan action to refresh its stored public report.
