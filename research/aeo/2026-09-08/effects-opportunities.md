# Effects, animated text and captions: acquisition opportunities

Audited September 8, 2026. Read-only inspection of /Users/naman/projects/woven-harness, clean main at 5c681eb7. No app changes or new visual/export QA performed. This extends the existing strategy; it does not add 20 landing pages or establish AI prompt frequencies.

## Actual capability

- 12 timeline effects: push-in, pull-out, punch, drift, shake, focus-zoom, whip-zoom, glitch, flash, blur-pulse, whip-pan, glass-break. Source: Sources/WovenHarness/ReelEditor/ReelCatalogViews.swift:20 and Sidecar/src/tools/reelSpecVocabulary.ts:14.
- 13 transitions excluding none: fade, slide-left/right/up, wipe, whoosh, zoom-blur, glitch, flash, dynamic-smear, pull-out, tv-glitch, pull-in. Source: Sidecar/src/tools/reelSpecVocabulary.ts:9; native presentation in ReelTransitionPresentation.swift.
- Four text entrance animations excluding none: fade-in, pop, slide-up, typewriter. Seven text styles: calligraphy, crossout, bold, subtitle, pill, plain, watermark. Three image entrance animations excluding none: fade-in, pop, slide-up. Source: same vocabulary:22 and ReelEntranceAnimationPicker.swift.
- Four caption modes: tiktok-highlight, subtitle, word-by-word, progressive-reveal. Word-by-word displays one active token; progressive-reveal accumulates tokens. Source: ReelCaptionPresentation.swift:95.
- Camera transforms and pixel effects have native implementation in CameraEffects.swift and ReelCompositor.swift. Agent vocabulary exposes all 12 effects. Code support is not proof that every natural-language request succeeds autonomously.

The September 8 agent-vfx-discovery plan records prior native/Sidecar checks, real-app Focus Zoom/Glass Break preview checks and later export/release checks. These are historical evidence, not a new end-to-end run. The older docs/effect-overlays.md lists only four effects and is stale relative to this checkout. Public download parity was not independently checked.

## Demand and priorities

New DataForSEO US English Google keyword overview: 20 phrases, $0.0144, retrieved September 8. Metrics are estimated average monthly searches, not AI query counts or unique audiences. KD is a Google estimate, not AI-answer difficulty; low KD does not establish easy ranking. Exact response metrics and update dates are in effects-demand.json.

| Priority | Topic and measured searches/month | Product fit and editorial decision |
|---|---|---|
| First | Animated captions 50; word by word captions 10; karaoke captions 70 | Strong caption-mode fit. Expand the planned /guides/video-captions with side-by-side examples. Verify highlighting before adopting the karaoke label; do not imply lyric alignment. Existing broader captions demand remains relevant. |
| First | Text animation 1,600; animated text 1,000; typewriter effect 320; typewriter text effect 40 | Strong fit for titles, hooks and callouts. A focused animated-text guide is a candidate after recording the four animations. Include a typewriter section initially. Broad text queries also have non-video intent. |
| First, as demos | Camera shake effect 170; video shake effect 50; zoom transition 140 | Show how to emphasize a moment with zoom or shake on /for/reels and /edit-videos-by-chatting. These give concrete demonstrations of selective editing. A focal point is not automatic subject tracking. |
| Second | Video transitions 590; glitch transition 210 | Build a visual gallery/tutorial with selected examples and timing advice. Start within the Reels workflow; split only if substantial distinct coverage warrants it. |
| Second, qualify intent | Glitch effect 6,600; video effects 1,600 | Large broad terms, but searches can concern photos, generators, presets or downloads. Use video-specific worked examples; do not make broad volume the reason for a flagship page. |
| Supporting demo | Glass breaking effect 170; CapCut text effects 90 | Glass Break is visually distinctive but may attract stock/SFX intent. Include a gallery example. CapCut queries require an honest equivalent-output comparison, not a claim of template parity. |
| Hold broad positioning | Kinetic typography 1,600 | Basic text entrances are a partial fit. Demonstrate a convincing sequence before claiming a full kinetic-typography maker, beat synchronization or advanced motion-design replacement. |

Additional measured phrases: text animation video 70; add animated text to video 10; zoom effect video 10. Do not sum related terms.

## Search-intent spot check

Current search results include an official [TechSmith typewriter tutorial](https://support.techsmith.com/hc/en-us/articles/360032837351-Create-the-Typewriter-Effect-by-Animating-Text-Video), a [VEED kinetic typography tool page](https://www.veed.io/create/animated-text-maker/kinetic-typography-maker) and a [FlexClip maker with templates](https://www.flexclip.com/create/kinetic-typography-video.html). This supports testing both tutorial and tool-page formats. It is a small intent check, not a controlled US SERP ranking audit or evidence that these products are recommended by AI.

## Content implementation recommendation

Preserve the first three destination priorities. Add creative finishing to their demonstrations and bring the captions demonstration forward. The existing 500 questions remain a backlog; the new feature audit reveals gaps and does not justify assigning every effect its own URL.

Record one source clip and its exported variants:

1. Caption treatment comparison: plain subtitle, active-word highlighting, one-word-at-a-time, progressive reveal.
2. A title/hook with fade, pop, slide-up and typewriter variants.
3. A before/after showing a timed punch/Focus Zoom and a restrained shake.
4. A short transition reel showing a few distinct transitions.
5. A Glass Break/Glitch example as a supporting visual.

For each, capture input, exact request, actual edits, final export and limits. Proposed prompts such as “Add a punch-in when I say this word” are test cases, not proven autonomous behavior. Check timing and readability in the exported file before publishing.

Use the demo near a direct written answer, followed by reproducible steps and a clear product action. A companion YouTube tutorial can demonstrate the same workflow. Evaluate citations, qualified visits and activations; avoid unsupported retention/virality claims.

Candidate questions to add or reconcile with the existing bank:

- How do I make captions appear one word at a time?
- How can I highlight the word currently being spoken?
- How do I add a typewriter title to a video?
- How do I animate a hook without learning motion graphics?
- How do I add a zoom at a specific moment?
- How do I add a camera shake effect to a video?
- How do I add a glitch transition between clips?
- Can I add and adjust video effects by describing the edit?

These are editorial hypotheses informed by measured topics, not observed AI question frequencies. Reconcile IDs and primary destinations when drafting, rather than changing the 500-question coverage counts now.
