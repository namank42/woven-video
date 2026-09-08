# Woven agent readiness — September 8, 2026

## Subsequent product correction

The generic developer documentation and read-only site-information API were replaced with documentation for the existing Woven SFX skill, MCP tools, and catalog. The historical 99/100 result below predates that replacement and must not be represented as a new scan of the current deployment. See [SFX replacement verification](2026-09-08-sfx-verification.md).

## Original audit result

The deployed canonical website scores **99/100** in Is Agentic, classified as **Strong technical baseline**. All **11 essential checks pass (80/80)**. The fresh report is timestamped `2026-09-08T05:14:24.552+00:00`.

- Report: https://is-agentic.com/scan/www.woven.video
- Reproduce: `npx is-agentic www.woven.video --json`
- Saved response: [2026-09-08-is-agentic.json](2026-09-08-is-agentic.json)
- The original apex report/command (`woven.video`) still serves its old 72/100 result from `04:50:54.906Z`, even after Is Agentic acknowledged archiving a fresh scan. Use the actual canonical hostname above to retrieve the current result. Both hostnames lead to the same production website.

## Delivered

- Real Markdown 404 responses with homepage, llms.txt, docs, and sitemap recovery links. Unknown API URLs instead return RFC 9457 JSON problem details.
- Server-rendered FAQ answers using the existing accordion and a no-JavaScript fallback. The scanner reports 6,096 characters, sequential H1/H2/H3 headings, and 7.6% content ratio.
- Correct Markdown negotiation at `/` and `/docs`, honoring Accept quality factors, exclusions, wildcards, and 406. HEAD responses omit bodies. Markdown has `Vary: Accept, Accept-Encoding`. Explicit standard and CDN no-store headers prevent representation mixing; Next 16.2.3 overwrites Vary only on HTML responses.
- Public `/docs`, `/index.md`, `/docs/index.md`, `/llms.txt`, `/agents.md`, and `/openapi.json`.
- Read-only `/api/v1/site` returns public product facts and resource URLs. No credentials required; no generation, editing, billing, or account access. The auth-refresh proxy bypass is exact and never adds session cookies to this cacheable public response.
- Branded metadata/schema, footer discovery, sitemap entry, and exact robots permission for the public discovery endpoint.

## Deployment

- Current production: `dpl_3zBuSA2Cty8mGqBTHngfE4J4Johc`
- Deployment URL: https://woven-video-fxtuforms-wovengroup.vercel.app
- Canonical: https://www.woven.video
- Original rollback target: `dpl_zC1trMtSXyyDy9mFrJGywBWzw7w6` (https://woven-video-nawy62xfv-wovengroup.vercel.app).
- Two production iterations. The second resolves the audit's noscript omission and adds the narrowly scoped discovery contract.
- Source checkout: `/Users/naman/.codex/worktrees/c87d/woven-video`, based on `1fcd3476ad2d224ec6c4aa6c847f0a26db733ac7` (origin/main at deployment). This deployment preceded source integration; the subsequent release commit includes the SFX correction described above.

## Verification

- Final full regression suite: 624 tests passed, 27 skipped (70 test files passed, 1 skipped), including the production HTTP checks.
- Next.js production builds and TypeScript checks passed locally and on Vercel.
- Targeted ESLint and whitespace checks passed.
- 34 real HTTP checks pass on production: all 18 sitemap pages; Markdown files and their internal links; OpenAPI/API/agent guide; robots and sitemap; negotiation, unsupported formats, HEAD, 404/405 errors, cache headers, schema data, and ordinary HTML content.
- OpenAPI 3.1.1 validated with Redocly CLI's minimal ruleset.
- Browser QA: desktop homepage appearance, working accordion with JavaScript, readable FAQ without JavaScript, desktop/mobile docs layout, and navigation to Markdown.
- Two independent code-review passes completed. Fixed standard cache control and tightened the robots Allow pattern after review.

## Remaining recommendations

Search Console indexing inspection and consistent verified external listings would improve brand/developer name searches. A physical company address must be supplied before adding it to Organization data; an About page needs approved company information. Public API deprecation commitments and any rate-limiting policy should be product decisions. A separate CLI or media-generation integration is unnecessary for the current read-only site-information contract. The function-calling warning says there are no typed inputs: this operation intentionally takes no parameters.
