# Landing Page Archive — Agency Positioning (pre-product pivot)

This is a snapshot of the landing page copy from when Woven was sold as a
done-for-you short-form reel agency, before the pivot to a desktop-app product.
Saved here in case any of the framing, sections, or CTAs are worth bringing
back.

- Snapshot taken: 2026-04-30
- Source commit: `64c74c9` (HEAD on `main`)
- Files captured: `app/page.tsx`, `app/layout.tsx`, `app/opengraph-image.tsx`

## Why this version is being retired

By April 2026 the repo had grown beyond a marketing site:

- Supabase Auth with Google OAuth (`/login`, `/auth/callback`)
- Stripe-backed prepaid USD balance with top-ups from $5–$100
  (`/account`, `components/account/balance-top-up-form.tsx`)
- OpenAI-compatible hosted API for the desktop app at
  `/api/v1/models`, `/api/v1/billing/balance`,
  `/api/v1/chat/completions`
- Hosted model lineup via Vercel AI Gateway: Claude Sonnet 4.6,
  Opus 4.7, Haiku 4.5, GPT-5.5 — 20% markup
- Companion desktop app at `~/projects/woven-harness` — see `README.md`

The agency landing page no longer matched the product. The pivot is to a
product page in the spirit of conductor.build: download-the-app hero,
local-or-hosted story, pay-as-you-go pricing, no "book a discovery call".

The done-for-you Sprint may return later as a secondary "we'll do it for you"
strip. This archive preserves the copy if so.

## Site metadata (from `app/layout.tsx`)

```
siteTitle:       Woven — Short-form reels for modern brands
siteDescription: Woven helps modern brands consistently ship high-performing
                 reels for ads and content using Generative AI.
category:        Marketing and Advertising
keywords:        short-form video, brand reels, AI video agency,
                 generative AI video, Instagram Reels, TikTok ads, Shorts,
                 performance creative, UGC ads, AI spokesperson,
                 video content agency
```

## OpenGraph image copy (from `app/opengraph-image.tsx`)

```
H1:  Short-form reels to grow your brand.
Sub: High-performing reels for ads and content, built with Generative AI.
alt: Woven — Short-form reels for modern brands
```

## Hero

```
H1:  Short-form reels to grow your brand.
Sub: Woven helps {modern brands} consistently ship {short-form reels}
     for ads and content with {Generative AI}.
     (orange / emerald / violet pill highlights)
CTA: Book a discovery call → (https://cal.com/naman-woven/30min)
```

## Reel showcase (kept in the new design — recaptioned)

| Label             | Asset                                  |
| ----------------- | -------------------------------------- |
| AI presenter      | no-caption-web.mp4                     |
| Creator-style ad  | linger-brand-awareness-v13-web.mp4     |
| Lifestyle film    | loft-showcase-v20-web.mp4              |
| Animated story    | theo-honesty-v10-web.mp4               |
| Feature update    | drift-demo-v31-full.mp4                |

## Why Woven (features)

```
Section label: Why Woven
H2:            Generated, adapted, or both.
Body:          We use generative AI to create fresh assets when you need
               them, and work from your existing brand system when you
               already have the raw material. Most projects use both.
```

Feature grid:

- **Generative AI assets** — Fresh footage, talent, b-roll, and
  spokespersons — generated to fit your brand, no shoots required.
- **Or your existing assets** — Product shots, brand system, and raw footage
  you already have, transformed into polished reels.
- **Ads, content, launches** — The full commercial range — performance
  creative, UGC-style ads, feature drops, and campaign teasers.
- **Fast turnaround** — Pilots delivered in around 5 business days. Monthly
  engagements run on rolling batches.
- **No production overhead** — A systemized workflow replaces the bloat of
  a traditional agency or internal video team.

## Process

```
Section label: How it works
H2:            A simple, fast process.
Body:          Five steps from brief to delivery — less painful than a
               traditional agency engagement.
```

| Step | Title              | Body                                                                                       |
| ---- | ------------------ | ------------------------------------------------------------------------------------------ |
| 01   | Share your brief   | Brand guidelines, reference reels you like, existing assets, and the launch or feature.    |
| 02   | Script & Shot list | We develop the script and visual plan for each reel.                                       |
| 03   | Alignment          | You review and approve the direction before production begins.                             |
| 04   | Production         | A systemized workflow built for speed and consistency.                                     |
| 05   | Delivery           | Final reels ready for Reels, TikTok, Shorts, and paid social.                              |

## Fit (Built for / Not a fit)

```
Section label: Who it's for
H2:            Built for modern brands. Narrow on purpose.
```

**Built for** — Teams already shipping, who want more reels.

- AI startups and software companies
- Consumer apps and SaaS tools
- Founder-led brands with active launches
- DTC and ecommerce with existing assets
- Teams that want more reels without hiring motion designers

**Not a fit** — Staying narrow is how we stay fast.

- Full live-action production from scratch
- Unlimited bespoke creative or strategy work
- Long-form video and documentary work
- "Make us go viral" with no assets or clarity

## Pilot Spotlight

```
Pill: Pilot engagement
H2:   The Launch Reel Sprint.
Sub:  A fixed-scope way to try Woven. Three polished reels built around
      one launch, feature, or campaign — using the assets you already have.
CTA:  Book a discovery call
```

Bullet grid:

- 3 vertical reels, 30–45s
- 3 creative angles
- 1 revision round per reel
- Delivered in ~5 business days
- Built from your assets
- Starting at $2,000

## Pricing

```
Section label: Pricing
H2:            Start small. Scale when it works.
Body:          Start with a pilot, then scale to a monthly engagement once
               you see the output.
```

### Launch Reel Sprint — $2,000 one-time *(highlighted, "Start here")*

> Three vertical reels for one campaign, launch, or feature. The easiest way
> to try Woven.

- 3 reels, 30–45 seconds each
- 3 creative angles from one brief
- 1 revision round per reel
- Delivered in ~5 business days

### Monthly — From $5,000 / month

> A steady stream of short-form reels for teams that need consistent output.

- 6 reels per month
- Mixed formats and use cases
- Rolling brief and feedback cycles
- Priority turnaround

### Custom — Let's talk

> Higher volume, dedicated capacity, or bespoke workflows for always-on
> creative programs.

- Higher monthly output
- Dedicated production lanes
- Custom formats and asset libraries
- Direct line to the Woven team

All three CTAs: **Book a discovery call** → `https://cal.com/naman-woven/30min`

## FAQ

```
Section label: FAQs
H2:            Common questions.
```

**What do you need from us to get started?**
Logo and brand guidelines, a link to your product or landing page, example
reels you like as references, any existing footage or screenshots, and the
key message, launch, or feature you want the reels to promote. The more
clarity on the message, the faster we move.

**How fast is delivery?**
The Launch Reel Sprint delivers three reels in around five business days
from the point we have your assets and brief. Monthly engagements run on
rolling batches with priority turnaround.

**How do revisions work?**
Each reel in the pilot includes one revision round. The goal is tight,
focused feedback — not open-ended changes. Monthly engagements operate on
the same principle across rolling batches.

**Can you create reels with a spokesperson or influencer?**
Yes. We can produce face-led, spokesperson-style, and influencer-style
creative using synthetic talent — no live shoot required.

**Who is Woven built for?**
Modern internet-native brands — AI and software companies, consumer apps,
SaaS tools, founder-led startups, and DTC brands — that already have assets
and want more short-form video without the overhead of a traditional agency
or internal video team.

**Do you do long-form video, live shoots, or social media management?**
No. Woven is intentionally focused on short-form brand reels under 60
seconds. That's how we stay fast and keep quality high.

## Final CTA

```
H2:   Let's make the reels.
Sub:  Book a discovery call. We'll look at your assets, what you're
      shipping, and whether a Launch Reel Sprint is the right next step.
CTA:  Book a discovery call → https://cal.com/naman-woven/30min
```

## Footer

```
© {year} Woven Labs. All rights reserved.

Nav: Work · Process · Pricing · FAQ · hello@woven.video
```

## JSON-LD (for reference)

The page rendered structured data describing Woven as an `Organization` +
`Service` (`serviceType: "Short-form video production"`). Each pricing tier
was emitted as an `Offer`. The product-page rewrite should replace `Service`
with `SoftwareApplication`.

## How to revive any of this

The full source for these sections is in commit `64c74c9` at `app/page.tsx`
— each section is its own component (`Hero`, `ReelShowcase`, `WhyWoven`,
`Process`, `Fit`, `PilotSpotlight`, `Pricing`, `FAQ`, `FinalCTA`,
`SiteFooter`). The `reels`, `features`, `processSteps`, `builtFor`,
`notAFit`, `pricing`, and `faqs` arrays at the top of the file hold all the
data.
