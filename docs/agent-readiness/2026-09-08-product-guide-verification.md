# Woven product guide — September 8, 2026

## Scope and sources

Public product documentation based on released harness commit `5c681eb7` (v0.1.85). The public website changelog also listed v0.1.85 during verification. The harness checkout was inspected read-only; no native code, app configuration, or user projects were changed. No fresh native-app QA or build was performed for this documentation task.

Evidence paths below are relative to `/Users/naman/projects/woven-harness`:

- Release/platform: CHANGELOG.md:5, scripts/appcast.xml:9-23, project.yml:17.
- Workspace/editor/agent workflow: Context/woven.md and Sidecar/src/tools/index.ts.
- Timeline and format controls: Sources/WovenHarness/ReelEditor/ReelEditorControlStrip.swift (source inventory references lines 894-1009); Sources/WovenHarness/ReelEditor/ReelTimelineEditing.swift; Sources/WovenHarness/ReelEditor/ReelTimelineCommands.swift.
- Import extensions/copy behavior: Sources/WovenHarness/ReelEditor/ReelAssetService.swift:12-20 and Sources/WovenHarness/ReelEditor/ReelMediaImportCoordinator.swift:204-215,324-383.
- Captions: Sources/WovenHarness/ReelEditor/ReelCaptionInspector.swift:3-24,299-497; Sources/WovenHarness/ReelEditor/ReelCaptionInspectorCommands.swift:155-201.
- Effects/SFX: Sources/WovenHarness/ReelEditor/ReelCatalogViews.swift:20-33,754-902; transitions in Sources/WovenHarness/ReelEditor/ReelTimelineCommands.swift:63-69,1192-1293.
- Picture/text controls: Sources/WovenHarness/ReelEditor/ReelPictureInspector.swift:123-320; Sources/WovenHarness/ReelEditor/ReelBuiltInInspector.swift:730-894.
- Export: Sources/WovenHarness/ReelEditor/ReelExportControlView.swift:146-169,302-308; Sources/WovenHarness/ReelEngine/NativeReelExporter.swift:496-528,740-761,943-960; Sources/WovenHarness/ReelEditor/ReelExportOperation.swift:142-214.
- Chat/media separation: Sources/WovenHarness/Stores/ModelAccessStore.swift; Sources/WovenHarness/Models/FeaturedProvider.swift; Sidecar/src/tools/media_generation.ts:580-611.
- Reference analysis and brand extraction: Skills/analyze-video/SKILL.md, Skills/extract-brand/SKILL.md, Sidecar/src/tools/identify_song.ts:19-20.
- Skills/memory/connections: Sidecar/src/skills/paths.ts:7-31, policy.ts; Sources/WovenHarness/Stores/ClaudeCodeMemorySync.swift; Sources/WovenHarness/Views/SettingsView.swift:190-215,440-447,1873-1944,2442-2547.
- Update behavior: CHANGELOG.md v0.1.80 and Sources/WovenHarness/Views/UpdateTopBarAccessory.swift.

## Delivery

`/guide` and `/guide/index.md` share one content source with 15 sections, covering getting started, projects, editing, media formats, effects/transitions, captions, audio, generation, reference analysis, brand extraction, skills/memory, models/MCP, export, local/online boundaries, and troubleshooting. Metadata, sitemap, footer, llms.txt, homepage Markdown, and recovery/agent guidance link the guide. `/docs` remains SFX-specific. Corrected the shared homepage FAQ to avoid claiming that all assets always stay on the Mac when online AI services are used.

Pricing and model availability link to current pricing instead of copying detailed rates. No full-offline, universal codec, external editor API, or direct social-publishing promise. The page states its source version and review date to support future updates.

## Verification

- Expected failing tests first: `/guide` did not negotiate Markdown; llms.txt/sitemap did not link it. Both pass after implementation.
- Local full suite: 632 passed, 27 skipped, including HTTP checks against the production build.
- Production build, TypeScript, targeted ESLint, and whitespace checks passed.
- Desktop/mobile browser inspection passed; guide sections and Markdown navigation are present. The export anchor lands below the header and the 390px page has no horizontal overflow.
- Independent source/implementation review corrected a stale 30/60 fps claim against Sources/WovenHarness/ReelEngine/ReelProjectFPS.swift:3-23 and Sources/WovenHarness/Stores/ReelProjectCreator.swift. Added caption replacement effects (Sources/WovenHarness/ReelEditor/ReelSelectionMoreView.swift:690-711), non-stacking effects (Sources/WovenHarness/ReelEngine/CameraEffects.swift:17-29), and transition bounds.

Independent follow-up review confirmed all four corrections with no new findings. Final reviewed build, lint, and full suite also passed (632 tests, 27 skipped).

## Production release

- Deployment: dpl_9F5vr2qSXNPdsxqST1MfekzMpsck.
- URL: https://woven-video-e3ey2p54c-wovengroup.vercel.app; canonical guide https://www.woven.video/guide.
- Production browser confirms the guide title and content.
- All 39 production HTTP checks passed: sitemap pages, product/SFX/agent Markdown and internal links, negotiation/cache/HEAD behavior, recovery responses, catalog resources, and guide section navigation.
- Release source is captured in the accompanying commit on the website release branch. The harness remains unchanged.
