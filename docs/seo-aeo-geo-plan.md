# Woven SEO / AEO / GEO Optimization Plan

**Site:** https://www.woven.video  
**Primary goal:** Get cited by answer engines (ChatGPT, Perplexity, Grok, Gemini, Claude, Copilot).  
**Secondary goal:** Rank on Google/Bing for winnable keywords in the AI video / short-form niche.  
**Created:** June 21, 2026  
**Last updated:** June 21, 2026  
**Status:** Planning — not yet implemented

---

## Table of contents

1. [Strategy summary](#strategy-summary)
2. [Keyword research](#keyword-research)
3. [Keyword tiers & page map](#keyword-tiers--page-map)
4. [Timeline expectations](#timeline-expectations)
5. [How answer engines select sources](#how-answer-engines-select-sources)
6. [Current state audit](#current-state-audit)
7. [Priority stack](#priority-stack)
8. [URL structure](#url-structure)
9. [Phase 1 — Make woven.video the canonical answer](#phase-1--make-wovenvideo-the-canonical-answer)
10. [Phase 2 — Winnable keyword pages](#phase-2--winnable-keyword-pages)
11. [Phase 3 — Platform-specific tactics](#phase-3--platform-specific-tactics)
12. [Phase 4 — Freshness loop](#phase-4--freshness-loop)
13. [Phase 5 — Secondary citations (distribution)](#phase-5--secondary-citations-distribution)
14. [Technical SEO hardening](#technical-seo-hardening)
15. [Schema markup plan](#schema-markup-plan)
16. [Content backlog](#content-backlog)
17. [Implementation sprint order](#implementation-sprint-order)
18. [What to deprioritize](#what-to-deprioritize)
19. [Success metrics](#success-metrics)
20. [Open questions](#open-questions)

---

## Strategy summary

**Dual strategy:** Answer-engine citation first, traditional SEO on winnable terms second.

Woven's site already has a strong technical foundation: HTTPS, canonical URLs, dynamic OG images, sitemap, explicit AI crawler access, and homepage JSON-LD with Organization, WebSite, SoftwareApplication, and FAQPage schema.

The gaps are:

- **Thin site architecture** — only 4 indexable marketing pages
- **No keyword-targeted landing pages** — missing comparison, feature, and Mac-wedge pages
- **Missing trust pages** — no Privacy Policy or Terms
- **Incomplete entity signals** — Organization schema lacks `sameAs`, `contactPoint`
- **GEO content gaps** — few statistics, citations, or answer-first definitions outside FAQs
- **Schema gaps on secondary pages** — pricing, changelog, contact lack structured data
- **Utility pages indexable** — `/login`, `/account` not noindexed

**Core principle:** woven.video should be the **canonical fact source** for anything an AI or search engine might say about Woven — pricing, models, platform support, features, comparisons.

**Keyword insight:** Real volume data shows clear winnable targets (KD 6–27) alongside head terms (KD 50+) that are a long game. Build for the winnable terms first.

---

## Keyword research

*Source: external keyword research, June 2026. KD = Keyword Difficulty (0–100 scale, lower = easier to rank).*

### Head terms — high value, hard (long game)

| Keyword | Volume/mo | KD | Notes |
|---------|-----------|-----|-------|
| `ai video generator` | 246,000 | — | Huge, broad, very competitive |
| `ai video editor` | 27,100 | 50 | Core category term |
| `text to video ai` | 9,900 | — | Broad generative intent |
| `free ai video editor` | 3,600 | — | Lean on 7-day trial messaging if targeted |

### Winnable now — prioritize these

| Keyword | Volume/mo | KD | Page |
|---------|-----------|-----|------|
| `capcut alternative` | 2,400 | **27** | `/vs/capcut` |
| `best ai video editor` | 2,400 | **27** | `/best-ai-video-editor` |
| `ai voiceover generator` | 2,400 | **6** | `/ai-voiceover` ⚠️ |
| `ai video editing software` | 1,900 | **22** | `/` + `/about` |
| `ai reels maker` | 880 | — | `/for/reels` |
| `opus clip alternative` | 480 | — | `/vs/opus-clip` |

### Comparison / switcher intent — low volume, high purchase intent + AEO gold

| Keyword | Volume/mo | KD | CPC | Page |
|---------|-----------|-----|-----|------|
| `descript alternative` | 170 | — | **$17.62** | `/vs/descript` |
| `descript vs capcut` | 110 | 22 | — | `/vs/capcut` or `/vs/descript` |
| `alternative to descript` | — | — | — | `/vs/descript` |
| `capcut alternative` | 2,400 | 27 | — | `/vs/capcut` |
| `opus clip alternative` | 480 | — | — | `/vs/opus-clip` |

### Niche but ownable — Mac wedge

| Keyword | Volume/mo | KD | Page |
|---------|-----------|-----|------|
| `ai video editor for mac` | ~10–20 | — | `/ai-video-editor-mac` |
| `best ai video editor for mac` | ~10–20 | — | `/ai-video-editor-mac` |

Low traffic individually, but Mac-native is Woven's unique positioning — near-instant win, worth a dedicated page.

### ⚠️ AI voiceover gate

`ai voiceover generator` (2,400/mo, **KD 6**) is the easiest win in the dataset — but only build `/ai-voiceover` if Woven **actually generates voice from script** in the app today.

| What exists today | Evidence |
|-------------------|----------|
| Marketing claims voice generation | Homepage: "generates the footage and voice" |
| Auto captions from voiceover | ElevenLabs Scribe STT, `$0.01/min` on pricing |
| Standalone TTS / voiceover generator | **Unconfirmed in desktop app** |

**Decision rule:**

- If script → AI voice works in app → build `/ai-voiceover` in Sprint 2 (high priority)
- If voice = captions only (STT) → skip `ai voiceover generator`; target caption-related terms instead
- If partial/beta → wait; don't rank for a feature that isn't shippable

---

## Keyword tiers & page map

### Tier 1 — Build first (winnable + high AEO value)

| Page | Primary keyword | Vol | KD | AEO prompt |
|------|-----------------|-----|-----|------------|
| `/vs/capcut` | capcut alternative | 2,400 | 27 | "CapCut alternative for Mac" |
| `/ai-voiceover` | ai voiceover generator | 2,400 | 6 | "AI voiceover for short-form video" |
| `/ai-video-editor-mac` | ai video editor for mac | ~20 | — | "Best AI video editor for Mac" |

### Tier 2 — High intent, smaller volume

| Page | Primary keyword | Vol | KD | AEO prompt |
|------|-----------------|-----|-----|------------|
| `/vs/descript` | descript alternative | 170 | — | "Descript alternative" |
| `/vs/opus-clip` | opus clip alternative | 480 | — | "Opus Clip alternative" |
| `/for/reels` | ai reels maker | 880 | — | "AI Reels maker" |

### Tier 3 — Broader, needs careful execution

| Page | Primary keyword | Vol | KD | AEO prompt |
|------|-----------------|-----|-----|------------|
| `/best-ai-video-editor` | best ai video editor | 2,400 | 27 | "What's the best AI video editor?" |
| `/` + `/about` | ai video editing software | 1,900 | 22 | "What is Woven?" |
| `/for/tiktok` | — | — | — | "AI video editor for TikTok on Mac" |
| `/for/youtube-shorts` | — | — | — | "AI YouTube Shorts editor" |

### Tier 4 — Foundation (not keyword-driven, but required)

| Page | Purpose |
|------|---------|
| `/` | Branded + entity anchor |
| `/pricing` | Commercial intent: "How much does Woven cost?" |
| `/about` | Fact sheet / entity page for AI extraction |
| `/changelog` | Freshness signal |
| `/contact` | Trust + support |
| `/privacy`, `/terms` | E-E-A-T trust |

### Tier 5 — Long game (do not start here)

| Keyword | Volume | KD | Why wait |
|---------|--------|-----|----------|
| `ai video editor` | 27,100 | 50 | Crowded; CapCut, Descript, Runway dominate |
| `ai video generator` | 246,000 | — | Far too broad and competitive |
| `free ai video editor` | 3,600 | — | Only if trial messaging is central |

---

## Timeline expectations

SEO and AEO timelines differ. KD estimates apply to **Google ranking**; AI citation has no guaranteed schedule.

### Branded queries (fastest)

*"What is Woven?", "How much does Woven cost?", "Woven video editor"*

| Milestone | Timing |
|-----------|--------|
| AI bots crawl updated pages | Days to ~2 weeks after deploy |
| Correct branded answers | ~2–6 weeks after Sprint 1–2 |
| woven.video cited as source | ~1–3 months with consistent freshness |

### Winnable keywords (KD 6–27)

*`capcut alternative`, `ai voiceover generator`, `best ai video editor`*

| Milestone | Timing |
|-----------|--------|
| Pages indexed | ~2–4 weeks after publish |
| Google ranking traction | ~1–3 months (KD 6 faster, KD 27 slower) |
| AI citations for comparison queries | ~1–3 months |
| Reliable citations | ~3–6 months |

### Mac wedge + use-case pages

*`ai video editor for mac`, `ai reels maker`*

| Milestone | Timing |
|-----------|--------|
| Rank for Mac terms | Weeks (tiny volume, low competition) |
| Use-case AI citations | ~2–4 months |

### Head terms (long game)

*`ai video editor` (27k, KD 50), `ai video generator` (246k)*

| Milestone | Timing |
|-----------|--------|
| Meaningful visibility | ~6–12+ months |
| Requires sustained content + distribution + authority |

### What speeds it up

1. Ship Sprint 1 foundation + Sprint 2 keyword pages quickly
2. Changelog entry every release (recency signal for ChatGPT)
3. Monthly citation accuracy check — fix anything AI gets wrong
4. Seed third-party mentions (Reddit, X, YouTube)

---

## How answer engines select sources

AI systems evaluate content based on:

| Signal | What it means for Woven |
|--------|-------------------------|
| **Clarity** | Direct answers, not marketing fluff |
| **Authority** | Branded primary source on owned domain |
| **Comprehensiveness** | Covers follow-up questions on the same page |
| **Recency** | Recently updated product info (changelog, pricing) |
| **Structure** | FAQs, tables, headings that match user questions |
| **Factual density** | Specific numbers: $99/yr, 7-day trial, model rates |
| **Crawlability** | AI bots can reach and parse public pages |

### Princeton GEO methods (priority order)

| Method | Visibility boost | Woven application |
|--------|-----------------|-------------------|
| Cite sources | +40% | Link to Anthropic/OpenAI/Apple docs when mentioning models or macOS |
| Statistics addition | +37% | Pricing, trial length, token rates, caption costs |
| FAQ schema | +40% AI visibility | Expand FAQ + JSON-LD on all landing pages |
| Authoritative tone | +25% | Confident, factual copy (already strong) |
| Easy to understand | +20% | Short paragraphs, plain language |
| Technical terms | +18% | Model names, token pricing, macOS-native |
| Fluency optimization | +15–30% | Clear flow, no filler |
| **Keyword stuffing** | **-10%** | **Avoid** |

**Best combination:** Fluency + statistics + FAQ schema.

---

## Current state audit

*Audited against seo-aeo-best-practices, seo-audit, and seo-geo skills. Live check of https://www.woven.video on June 21, 2026.*

### What's working

| Area | Status | Location |
|------|--------|----------|
| Metadata base | ✅ | `app/layout.tsx` — `metadataBase`, title template |
| Per-page metadata | ✅ | `app/pricing/page.tsx`, `app/changelog/page.tsx`, `app/contact/page.tsx` |
| Open Graph / Twitter | ✅ | Dynamic `app/opengraph-image.tsx` at 1200×630 |
| Homepage JSON-LD | ✅ | `app/page.tsx` — Organization, WebSite, SoftwareApplication, FAQPage |
| AI crawler access | ✅ | `app/robots.ts` — GPTBot, PerplexityBot, ClaudeBot, Google-Extended, etc. |
| Sitemap | ✅ | `app/sitemap.ts` — 4 public pages |
| FAQ content + schema | ✅ | 7 Q&As on homepage with matching JSON-LD |
| Changelog freshness | ✅ | `app/changelog/page.tsx` with dated releases |
| Checkout noindex | ✅ | `app/checkout/*/page.tsx` |
| Canonical URLs | ✅ | Per-page `alternates.canonical` |
| Pricing tables in HTML | ✅ | Static, crawlable model rate tables on `/pricing` |
| "AI voiceover" in keywords | ✅ | `app/layout.tsx` keywords array (no dedicated page yet) |

### Issues found

| Priority | Issue | Impact |
|----------|-------|--------|
| **P0** | No keyword-targeted landing pages | Missing 2,400/mo winnable terms |
| **P0** | No Privacy Policy / Terms of Service | E-E-A-T trust; SaaS billing credibility |
| **P0** | `/login`, `/account` indexable (no `noindex`) | Thin utility pages dilute crawl signals |
| **P1** | `robots.txt` allows `/api/*` | Wastes crawl budget on non-content URLs |
| **P1** | Homepage meta description ~255 chars | Truncated in SERPs; weak CTR |
| **P1** | Pricing page has no JSON-LD | AI can't reliably extract pricing/offers |
| **P1** | Organization schema missing `sameAs`, `contactPoint` | Weak entity signals |
| **P1** | SoftwareApplication `Offer` incomplete | Missing trial, `availability`, `priceValidUntil` |
| **P1** | Only 4 indexable pages | Not enough surface area to rank or be cited |
| **P2** | Changelog H1 is `sr-only` | Weaker on-page keyword signal |
| **P2** | Sitemap `lastModified` uses `new Date()` at build | Inaccurate freshness signals |
| **P2** | No `/about` fact sheet | No dense entity anchor page |
| **P2** | Footer missing legal links | Trust + internal linking gap |

---

## Priority stack

| Priority | Focus | Why |
|----------|--------|-----|
| **P0** | Foundation + crawl hygiene | Trust, schema, FAQs — everything else builds on this |
| **P1** | Winnable keyword pages | `/vs/capcut`, `/ai-voiceover`, `/ai-video-editor-mac` |
| **P2** | Comparison + use-case pages | `/vs/descript`, `/vs/opus-clip`, `/for/reels` |
| **P3** | Freshness loops | Changelog, "last updated" dates |
| **P4** | Distribution | Reddit, YouTube, X — secondary citation sources |
| Deprioritize | Head terms, keyword stuffing | KD 50+ and -10% GEO penalty |

---

## URL structure

**Decision:** Use short, intent-matching paths.

| Pattern | Example | Rationale |
|---------|---------|-----------|
| `/vs/{competitor}` | `/vs/capcut` | Matches "X alternative" search intent |
| `/for/{platform}` | `/for/reels` | Short use-case paths |
| `/ai-{feature}` | `/ai-voiceover` | Feature keyword landing pages |
| `/ai-video-editor-mac` | — | Explicit Mac wedge |
| `/best-ai-video-editor` | — | Roundup/comparison hub |

*Previously planned `/compare/capcut` → changed to `/vs/capcut` per keyword research.*

---

## Phase 1 — Make woven.video the canonical answer

**Timeline:** Week 1  
**Goal:** Trust, schema, FAQs — the base layer everything else builds on.

### 1.1 Answer-first copy blocks

**Homepage** (under hero):

> Woven is a native macOS AI video editor. You script, generate footage, and assemble short-form video by chatting — built for Instagram Reels, TikTok, and YouTube Shorts. Try free for 7 days, then $99/year.

**Pricing** (top of page):

> Woven costs $99/year ($8.25/month) after a 7-day free trial. Hosted AI models are optional prepaid credits from $5; you can also bring your own Anthropic/OpenAI keys or sign in with ChatGPT.

**Contact:**

> Contact Woven Labs at hello@woven.video for questions about trials, billing, or the macOS app.

### 1.2 Expand FAQ coverage

Current: 7 FAQs on homepage. Target: 15+ across homepage and pricing.

| User prompt | Answer location |
|-------------|-----------------|
| What is the best AI video editor for Mac? | `/ai-video-editor-mac` + FAQ |
| What is a CapCut alternative for Mac? | `/vs/capcut` |
| How does Woven compare to CapCut? | `/vs/capcut` |
| How does Woven compare to Descript? | `/vs/descript` |
| Can Woven generate AI voiceover? | `/ai-voiceover` + FAQ |
| Can Woven make TikTok videos? | `/for/tiktok` + FAQ |
| Does Woven work offline? | FAQ |
| What file formats does Woven export? | FAQ |
| How do I bring my own API keys? | FAQ + pricing |
| What is Woven's refund policy? | FAQ + terms |
| Does Woven support Windows or Linux? | FAQ |
| Can I use ChatGPT with Woven? | FAQ |
| How much do hosted AI models cost? | Pricing FAQ |
| What is included in the free trial? | Pricing FAQ |
| Who makes Woven? | `/about` |

### 1.3 Crawl hygiene

- Add `noindex` to `/login` and `/account`
- Update `app/robots.ts` to `Disallow: /api/`, `/account/`, `/login/`, `/checkout/`
- Keep AI bots allowed on public marketing pages

### 1.4 Legal / trust pages

- Add `/privacy` and `/terms`
- Link from footer on every page
- Add to sitemap at priority 0.3

### 1.5 Search Console + Bing Webmaster

- Verify `www.woven.video` property
- Submit sitemap
- Baseline: indexed pages, CWV, any manual actions

---

## Phase 2 — Winnable keyword pages

**Timeline:** Weeks 2–4  
**Goal:** Capture KD 6–27 terms and own comparison/use-case prompts.

### 2.1 `/vs/capcut` — highest leverage (2,400/mo, KD 27)

**Target keywords:** `capcut alternative`, `descript vs capcut`

**Page format:**

1. H1: "CapCut Alternative for Mac — Woven"
2. One-sentence verdict at top
3. Comparison table (feature × Woven × CapCut)
4. "When to choose Woven" / "When to choose CapCut"
5. Mac-native angle throughout
6. FAQ section with FAQPage schema
7. CTA: 7-day free trial

### 2.2 `/ai-voiceover` — easiest SEO win (2,400/mo, KD 6) ⚠️

**Target keyword:** `ai voiceover generator`

**Only build if script → AI voice works in the desktop app.**

**Page format:**

1. H1: "AI Voiceover for Short-Form Video — Woven"
2. Answer-first: how Woven generates voice as part of reel assembly
3. Workflow: script → voice → edit → export
4. Mention auto captions from voiceover ($0.01/min) as related feature
5. Mac-native, short-form focus (Reels, TikTok, Shorts)
6. FAQ + schema
7. **Not** a fake standalone Murf/ElevenLabs clone page — honest feature positioning

### 2.3 `/ai-video-editor-mac` — Mac wedge (~20/mo, instant win)

**Target keywords:** `ai video editor for mac`, `best ai video editor for mac`

**Page format:**

1. H1: "AI Video Editor for Mac — Woven"
2. Lead with Mac-native positioning (file system, local projects, no uploads)
3. Comparison to web-based alternatives
4. Pricing + trial CTA
5. FAQ + schema

### 2.4 `/vs/descript` — high commercial intent (170/mo, CPC $17.62)

**Target keywords:** `descript alternative`, `alternative to descript`

Same format as `/vs/capcut`. Emphasize chat-driven short-form vs Descript's podcast/long-form editing.

### 2.5 `/vs/opus-clip` (480/mo)

**Target keyword:** `opus clip alternative`

Same comparison format. Opus Clip is clip-extraction; Woven is full creation — clear differentiation.

### 2.6 `/for/reels` (880/mo)

**Target keyword:** `ai reels maker`

1. Answer-first definition for Reels use case
2. Example workflow (step-by-step)
3. Pricing reminder
4. FAQ + schema

### 2.7 `/best-ai-video-editor` (2,400/mo, KD 27) — careful execution

**Target keyword:** `best ai video editor`

**Must be credible** — not a disguised sales page:

- Include Woven honestly among 5–8 tools
- Clear criteria: Mac-native, chat-driven, pricing, short-form focus
- Comparison table with multiple tools
- "When to choose Woven" section
- FAQ + schema

### 2.8 `/about` fact sheet

Dense entity anchor page for AI extraction. Target `ai video editing software` (1,900/mo, KD 22) as secondary keyword.

| Section | Content |
|---------|---------|
| Product definition | What Woven is, category, platform |
| Pricing | Trial, annual, credits — exact numbers |
| Supported models | Exact names + model IDs |
| Capabilities | What it does (including voice, if confirmed) |
| Limitations | No Windows, etc. |
| Company | Woven Labs, contact email |
| Last updated | Visible date + `dateModified` in schema |

### 2.9 PDF guide (Perplexity optimization)

- Create: "Short-form video workflow on Mac with Woven"
- Host at: `/guides/short-form-workflow.pdf`
- Link from homepage and use-case pages

---

## Phase 3 — Platform-specific tactics

| Engine | What it favors | Woven action |
|--------|----------------|--------------|
| **ChatGPT** | Branded domain authority; content updated <30 days | Changelog every release; keyword pages with FAQ schema |
| **Perplexity** | FAQ schema; PerplexityBot allowed ✅; PDFs | FAQ on every landing page; publish PDF guide |
| **Grok** | X/Twitter ecosystem signals | Product updates on X linking to changelog; `sameAs` in schema |
| **Gemini / Google AI Overviews** | E-E-A-T, structured data | About page, privacy/terms, comparison pages |
| **Claude** | Factual density, structural clarity | Pricing tables ✅; comparison tables on `/vs/*` pages |
| **Copilot (Bing)** | Bing index + page speed | Bing Webmaster Tools; target LCP < 2.5s |

---

## Phase 4 — Freshness loop

| Cadence | Action | Citation signal |
|---------|--------|-----------------|
| Every release | Changelog entry + bump `dateModified` | "Woven added X in v0.42" |
| Monthly | Update pricing FAQ if models/rates change | Accurate cost answers |
| Quarterly | Refresh `/vs/*` comparison pages | "As of [month] 2026, Woven supports…" |
| Always | Visible "Last updated" on pricing, about, comparison pages | Freshness in HTML + schema |

### Changelog improvements

- Replace `sr-only` H1 with visible "Changelog" heading
- Add `ItemList` schema with `datePublished` per release
- Use latest release date as sitemap `lastModified` for `/changelog`

---

## Phase 5 — Secondary citations (distribution)

| Channel | Action | Why |
|---------|--------|-----|
| **Reddit** | Genuine answers in r/VideoEditing, r/macapps, r/artificial linking to `/vs/capcut`, FAQ anchors | AI trains on Reddit |
| **YouTube** | Demo videos linking to `/pricing`, `/for/reels`, `/ai-voiceover` | Transcript + description = citable |
| **Product Hunt / HN** | Launch posts linking back to woven.video | Citable third-party source |
| **Review roundups** | "Best AI video editor Mac" listicles | Commercial intent queries |
| **X / Twitter** | Product updates linking to changelog | Grok ecosystem signal |

---

## Technical SEO hardening

### Crawl & index

- [ ] `noindex` on `/login`, `/account`
- [ ] `Disallow: /api/`, `/account/`, `/login/`, `/checkout/` in `robots.ts`
- [ ] Keep all AI bots allowed on public pages
- [ ] Submit sitemap to Google Search Console and Bing Webmaster Tools

### Meta descriptions

Trim homepage to ~155 chars:

> Woven is the AI video editor for Mac. Script, generate, and assemble Reels, TikToks, and Shorts by chatting. 7-day free trial.

Each new landing page gets a unique, keyword-rich description (150–160 chars).

### Performance (secondary priority)

- Hero video: poster image as LCP candidate
- Lazy-load below-fold reel videos
- Target LCP < 2.5s on mobile

### Sitemap accuracy

Replace `new Date()` at build time with real dates. Add all new pages as they're created.

---

## Schema markup plan

### Shared module

Create `lib/seo/schema.ts` with reusable generators.

### Per-page schema

| Page | Schema types |
|------|-------------|
| `/` | `@graph`: Organization, WebSite, SoftwareApplication, FAQPage, WebPage |
| `/pricing` | SoftwareApplication + Offer + FAQPage |
| `/about` | Organization (full entity) + WebPage |
| `/changelog` | WebPage + ItemList |
| `/contact` | ContactPage + Organization.contactPoint |
| `/vs/*` | WebPage + FAQPage |
| `/for/*` | WebPage + FAQPage |
| `/ai-voiceover` | WebPage + FAQPage (+ `SoftwareApplication` if appropriate) |
| `/ai-video-editor-mac` | WebPage + FAQPage + SoftwareApplication |
| `/best-ai-video-editor` | WebPage + FAQPage + ItemList |
| All pages | BreadcrumbList |

### Organization enrichment

```json
{
  "@type": "Organization",
  "name": "Woven",
  "legalName": "Woven Labs",
  "url": "https://www.woven.video",
  "logo": { "@type": "ImageObject", "url": "https://www.woven.video/woven-logo.png" },
  "sameAs": ["https://twitter.com/...", "https://linkedin.com/company/..."],
  "contactPoint": {
    "@type": "ContactPoint",
    "email": "hello@woven.video",
    "contactType": "customer support",
    "availableLanguage": "English"
  }
}
```

### Validation

- [Google Rich Results Test](https://search.google.com/test/rich-results?url=https://www.woven.video)
- [Schema.org Validator](https://validator.schema.org/?url=https://www.woven.video)

---

## Content backlog

### New pages to create

| Page | Priority | Sprint | Primary keyword | Vol | KD |
|------|----------|--------|-----------------|-----|-----|
| `/about` | P0 | 1 | ai video editing software | 1,900 | 22 |
| `/privacy` | P0 | 1 | — | — | — |
| `/terms` | P0 | 1 | — | — | — |
| `/vs/capcut` | **P1** | **2** | capcut alternative | 2,400 | 27 |
| `/ai-voiceover` | **P1** | **2** | ai voiceover generator | 2,400 | 6 |
| `/ai-video-editor-mac` | **P1** | **2** | ai video editor for mac | ~20 | — |
| `/vs/descript` | P2 | 3 | descript alternative | 170 | — |
| `/vs/opus-clip` | P2 | 3 | opus clip alternative | 480 | — |
| `/for/reels` | P2 | 3 | ai reels maker | 880 | — |
| `/best-ai-video-editor` | P2 | 4 | best ai video editor | 2,400 | 27 |
| `/for/tiktok` | P3 | 4 | — | — | — |
| `/for/youtube-shorts` | P3 | 4 | — | — | — |
| `/guides/short-form-workflow.pdf` | P3 | 4 | — | — | — |

### Existing pages to update

| Page | Changes |
|------|---------|
| `app/page.tsx` | Answer-first block, expand FAQ to 15+, enrich schema, target `ai video editing software` |
| `app/pricing/page.tsx` | Answer-first block, pricing FAQ, SoftwareApplication schema |
| `app/changelog/page.tsx` | Visible H1, ItemList schema, real sitemap dates |
| `app/contact/page.tsx` | ContactPage schema |
| `app/layout.tsx` | Trim meta description |
| `app/robots.ts` | Disallow utility paths |
| `app/sitemap.ts` | Add all new pages, fix lastModified |
| `components/site-footer.tsx` | Legal links, about link, comparison links |
| `app/(auth)/login/page.tsx` | Add noindex metadata |
| `app/account/layout.tsx` | Add noindex metadata |

### New code to create

| File | Purpose |
|------|---------|
| `lib/seo/schema.ts` | Shared JSON-LD generators |
| `lib/seo/faqs.ts` | Centralized FAQ data (page content + schema) |
| `lib/seo/keywords.ts` | Keyword → page mapping constants |
| `components/seo/json-ld.tsx` | Reusable JSON-LD render component |

---

## Implementation sprint order

### Sprint 1 — Foundation (Week 1)

Trust, schema, FAQs. Required before keyword pages.

- [ ] Create `lib/seo/schema.ts`, `lib/seo/faqs.ts`, `lib/seo/keywords.ts`
- [ ] Expand homepage FAQ to 15+ with answer-first format
- [ ] Add answer-first definition block to homepage
- [ ] Add FAQPage JSON-LD from centralized FAQ data
- [ ] Create `/about` fact sheet page
- [ ] Create `/privacy` and `/terms` pages
- [ ] Add footer links (about, privacy, terms)
- [ ] Add `noindex` to `/login` and `/account`
- [ ] Update `robots.ts` to disallow utility paths
- [ ] Trim homepage meta description
- [ ] Enrich Organization schema (`sameAs`, `contactPoint`)
- [ ] Submit sitemap to Search Console + Bing Webmaster Tools

### Sprint 2 — Highest-leverage keyword pages (Week 2)

Data-driven priority: winnable terms with highest volume.

- [ ] **Confirm AI voiceover feature** in desktop app (gate for `/ai-voiceover`)
- [ ] Create `/vs/capcut` (2,400/mo, KD 27)
- [ ] Create `/ai-voiceover` (2,400/mo, KD 6) — if feature confirmed
- [ ] Create `/ai-video-editor-mac` (Mac wedge, instant win)
- [ ] Add answer-first block + FAQ + schema to pricing page
- [ ] Add SoftwareApplication + Offer schema to pricing
- [ ] Add visible "Last updated" date to pricing
- [ ] Fix sitemap `lastModified` dates
- [ ] Add all new pages to sitemap
- [ ] Validate schema in Rich Results Test

### Sprint 3 — Comparisons + use cases (Week 3)

- [ ] Create `/vs/descript` (170/mo, CPC $17.62)
- [ ] Create `/vs/opus-clip` (480/mo)
- [ ] Create `/for/reels` (880/mo)
- [ ] Add changelog ItemList schema + visible H1
- [ ] Add ContactPage schema to contact page
- [ ] Add FAQPage schema to all Sprint 2–3 pages

### Sprint 4 — Broader coverage (Week 4)

- [ ] Create `/best-ai-video-editor` (2,400/mo, KD 27) — credible roundup format
- [ ] Create `/for/tiktok`
- [ ] Create `/for/youtube-shorts`
- [ ] Create PDF workflow guide
- [ ] Internal linking pass: cross-link all landing pages

### Ongoing

- [ ] Changelog entry every release
- [ ] Monthly pricing FAQ review
- [ ] Quarterly `/vs/*` page refresh
- [ ] Monthly AI citation check (see metrics below)
- [ ] Monthly Google ranking check for Tier 1–2 keywords
- [ ] Distribution: Reddit, YouTube, X posts

---

## What to deprioritize

| Item | Why |
|------|-----|
| `ai video editor` (27k, KD 50) | Long game — 6–12+ months |
| `ai video generator` (246k) | Far too broad and competitive |
| `free ai video editor` (3,600) | Only if trial messaging becomes central |
| Long-form generic blog SEO | Low AEO value without FAQ/schema structure |
| Keyword stuffing | -10% GEO penalty |
| hreflang / international SEO | Single-locale site |
| Blocking AI training crawlers | Reduces citation visibility |
| `/compare/runway` | Lower priority than Opus Clip (480/mo) and CapCut (2,400/mo) |

---

## Success metrics

### Primary — answer engine citation

| Signal | How to measure | 90-day target |
|--------|---------------|---------------|
| AI mentions | Monthly prompt check (see below) | woven.video cited for branded + comparison queries |
| Citation accuracy | Compare AI answers to current pricing/models | 90%+ accurate |
| AI referral traffic | Vercel Analytics referrers | Baseline → growth |
| Indexed pages | Google Search Console | 4 → 15+ |

### Secondary — traditional SEO

| Signal | How to measure | 90-day target |
|--------|---------------|---------------|
| `capcut alternative` ranking | GSC + manual Google check | Top 20 → Top 10 |
| `ai voiceover generator` ranking | GSC + manual check | Top 10 (KD 6) |
| `ai video editor for mac` ranking | GSC + manual check | Top 3 |
| `descript alternative` ranking | GSC + manual check | Top 10 |
| Branded search impressions | GSC | Growth |

### Monthly AI citation check

Run in ChatGPT, Perplexity, Grok, Gemini, and Claude:

1. "What is Woven video editor?"
2. "How much does Woven cost?"
3. "What is the best AI video editor for Mac?"
4. "CapCut alternative for Mac"
5. "Woven vs CapCut"
6. "Woven vs Descript"
7. "AI voiceover generator for short-form video"
8. "Can Woven make TikTok videos?"
9. "What AI models does Woven support?"
10. "Opus Clip alternative"

Record: cited? accurate? which third-party sources cited instead?

### Monthly SEO ranking check

Google search (incognito) for Tier 1–2 keywords:

1. `capcut alternative`
2. `ai voiceover generator`
3. `ai video editor for mac`
4. `descript alternative`
5. `best ai video editor`
6. `ai reels maker`

---

## Open questions

| # | Question | Blocks |
|---|----------|--------|
| 1 | **Does Woven generate AI voiceover from script today?** | `/ai-voiceover` page (2,400/mo, KD 6) |
| 2 | Social profiles for `sameAs` — Twitter/X, LinkedIn, GitHub URLs? | Organization schema |
| 3 | Comparison page tone — how directly to name competitors? | `/vs/*` pages |
| 4 | Legal pages — generator/template or custom? | `/privacy`, `/terms` |
| 5 | PDF guide — who writes the workflow content? | Sprint 4 |
| 6 | Distribution — existing Reddit/YouTube/X presence? | Phase 5 |

---

## References

- `.agents/skills/seo-aeo-best-practices/` — metadata, schema, EEAT, AEO
- `~/.agents/skills/seo-audit/` — technical SEO audit framework
- `~/.agents/skills/seo-geo/` — GEO methods, platform algorithms, Princeton research
- External keyword research — volume/KD data, June 2026
- Princeton GEO paper: [arXiv:2311.09735](https://arxiv.org/abs/2311.09735)