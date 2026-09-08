# SFX documentation replacement — September 8, 2026

Replaced the generic developer page at https://www.woven.video/docs with documentation for the existing Woven SFX product. The footer now says SFX docs. The HTML page and Markdown counterpart share their content source.

The guide covers skill installation, local stdio MCP configuration, search/pull/list tools, library path selection, direct catalog use, sound/code licensing, and troubleshooting. It distinguishes SFX from the Woven Mac editor. Removed /api/v1/site and /openapi.json, their discovery links, and the dedicated robots/proxy exceptions; both retired paths now return 404. Retained Markdown negotiation, agent guidance, sitemap discovery, recoverable errors, and homepage improvements.

## Verification

- Full suite against the local production build: 625 passed, 27 skipped.
- Production HTTP suite: all 35 checks passed, including sitemap pages, Markdown resources and internal links, negotiation, retired endpoints, API recovery, and the live SFX catalog/example audio.
- Next.js production build and TypeScript passed locally and on Vercel; targeted ESLint and git diff --check passed.
- Published woven-sfx-mcp 0.2.1 tested in an isolated temporary directory: initialized stdio MCP, listed three tools, searched camera shutter (five results), downloaded camera-shutter-release.wav (102,444 bytes; RIFF/WAVE validated), and confirmed the file in sfx_list_installed. User MCP configuration was not changed.
- Desktop and 390px mobile browser inspection passed. Page width stayed 390px; long code samples scroll inside their containers.
- External setup and license links return 200.
- Production browser confirms the new title, content, and footer link.

## Deployment and source

- Production deployment: dpl_8D4ZuYhYBtoxAL6mdAXk9r7yup1Y
- Deployment URL: https://woven-video-drucyvz1j-wovengroup.vercel.app
- Canonical docs: https://www.woven.video/docs
- Source: /Users/naman/.codex/worktrees/c87d/woven-video. The production deployment preceded this release commit; the committed implementation preserves the deployed SFX correction.
- The earlier 99/100 report predates this correction. No new audit score is claimed.

## Remaining scope

The separately deployed SFX site and its npm package were not modified. Client-specific setup is linked to the SFX project's maintained reference. No additional API or paid-service credentials are required for this documentation change.
