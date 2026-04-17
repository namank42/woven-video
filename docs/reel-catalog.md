# Reel catalog

Production roadmap for the 5 reels on the landing page (`ReelShowcase` in `app/page.tsx`). Each slot is a different commercial format — together they demonstrate range across Woven's ICP (AI/SaaS + DTC + founder-led brands). Update the **Status** row as reels ship.

---

## The 5 slots

| # | Label (on site) | Status | R2 path |
|---|---|---|---|
| 1 | AI presenter | ✅ shipped | `week-14/april-2-final-web.mp4` |
| 2 | Product launch | ⏳ placeholder | — |
| 3 | Creator-style ad | ⏳ placeholder | — |
| 4 | Lifestyle film | ✅ shipped | `woven-reels/loft-showcase-v20-web.mp4` |
| 5 | Animated story | ✅ shipped | `woven-reels/theo-honesty-v10-web.mp4` |

---

## 1. AI presenter ✅

**What it demonstrates**: face-led creative with synthetic talent — no shoot, no casting.

**Format**: polished spokesperson delivering a message direct-to-camera, emphasis captions, tight 15-25s.

**Refs**: Duolingo face-led ads, creator-style "teaching" reels.

**Currently using**: luna-lang Chinese-learning reel (`april-2-final`) as a sample. Replace when a brand-aligned version is produced.

---

## 2. Product launch ⏳

**What it demonstrates**: SaaS/AI feature launches — the format the ICP (AI startups, productivity tools) buys most.

**Format**: UI motion / screen capture driving the reel. No face, no voiceover. Static typography slams as emphasis, timed to cuts or music. **No heavy kinetic typography** — it reads dated.

**Arc** (~20s):
1. Hook text (5s) — feature name or bold claim
2. UI motion demonstrating the feature (10-15s) — screen capture, clean cuts
3. Brand card (2-3s)

**Quality bar / refs**:
- **Arc Browser** launch reels — screen capture + keyword text slams
- **Raycast** feature drops — tight UI motion, minimal text
- **Linear** announcements on X — clean typography over interface motion
- **Granola** / **Cursor** — vertical product launches showing real usage

**Production notes**: pick a fictional (or aspirational real) SaaS. Make it feel like a reel a real company would actually ship — not a motion-design demo.

---

## 3. Creator-style ad ⏳

**What it demonstrates**: performance creative for paid social — the "ads" half of Woven's pitch.

**Format**: vertical selfie-camera (real or synthetic creator), casual setting, emphasis captions word-by-word. **Kinetic typography works here** — caption emphasis is the native pattern.

**Arc options** (15-25s):
1. **Hook → Agitate → Solve → CTA** — "Stop using [X]" → brief pain → product reveal → "link in bio"
2. **POV transformation** — "POV: you just discovered X" → before/after → reveal

**Quality bar / refs**:
- **AG1 / Athletic Greens** TikTok ads ("here's why my mornings changed")
- **Ridge Wallet** / **Manscaped** hook-driven DR ads
- **Raycast** creator testimonials
- Any "problem/agitate/solve" TikTok ad format

---

## 4. Lifestyle film ✅

**What it demonstrates**: cinematic brand / DTC mood work — the "content" half of the pitch, no talking head.

**Format**: montage of product in context, moody music, no voiceover, minimal text. Shallow DOF, slow motion, warm grade. Closing type card with brand + tagline.

**Arc options** (15-25s):
1. **Setting → Mood → Product beat** — establish environment → 3-5 vignettes conveying feeling → hero product shot → tagline card
2. **Day-in-the-life** — morning ritual → product woven throughout → quiet closing beat

**Quality bar / refs**:
- **Lululemon** — runners at sunrise with product close-ups
- **On Running** — kinetic slow-mo + text slam
- **Glossier** / **Rhode Skin** — pastel lighting, skin texture, morning rituals
- **Apple "Shot on iPhone"** ads — wide-to-intimate, music-driven
- **Allbirds** / **Outdoor Voices** — people moving through nature/city, fabric macro

---

## 5. Animated story ✅

**What it demonstrates**: creative range with zero footage, zero talent, zero brand assets. Also maps to the "content" side of the pitch — this is the piece that has a chance of going viral on its own.

**Format**: Pixar-quality character animation (doable in-house). **Short-story content type**, not a mascot spot — story-led, emotional, narrative. 20-30s.

**Arc**:
- **Micro three-act** — setup (5s: character + world) → conflict (10s: something goes wrong) → resolution (5-10s: growth or punchline)
- OR **single emotional beat** — one small moment drawn out with feeling, Pixar-short style

The tightest arc of the lineup — under 30 seconds has to earn every second. Audience expects a beginning-middle-end.

**Quality bar / refs**:
- **Duolingo** Duo shorts (character + micro story)
- **Apple** holiday animated shorts ("Share the Joy," "Loretta")
- **Airbnb "Belong Anywhere"** animated shorts
- **Pixar shorts** directly — the actual bar, not a cheaper fallback

**Production notes**: one character, one setting, one emotional beat. Resist the urge to over-scope.

---

## Technical specs

All web versions use the same encoder pipeline — see `scripts/encode-web-reel.sh`.

| Spec | Value | Why |
|---|---|---|
| Resolution | 540 × 960 | Covers iPhone Pro Max 3×, ~2.6× desktop 2× retina, exact half of 1080p |
| Codec | H.264 main profile, `yuv420p` | Universal compatibility |
| CRF | 26, preset slow | Visually lossless at this size, good compression |
| Audio | AAC 128 kbps stereo | Kept — the tile has a mute toggle, reels should be playable |
| `-movflags` | `+faststart` | moov atom at front so `<video>` streams before full download |
| Output suffix | `-web.mp4` | Kept alongside source so `publish-reel` flow still uses the 1080p original for IG/YT |
| R2 prefix | `week-XX/<filename>-web.mp4` | Mirrors `publish-reel` skill's prefix convention |
| Public base | `https://media.wovenlabs.net` | — |
| Target file size | ~2-4 MB | ~10× reduction from 20 MB 1080p source |

### To produce a new reel

```bash
./scripts/encode-web-reel.sh /path/to/source.mp4 --upload week-15
```

Prints the public URL. Then add it to `reels[]` in `app/page.tsx`:

```ts
{
  label: "Product launch",
  gradient: "from-...", // kept as fallback for the placeholder state
  videoUrl: "https://media.wovenlabs.net/week-15/<filename>-web.mp4",
},
```

That's it — the `ReelTile` component auto-switches from gradient placeholder to the `<video>` and renders the mute/play controls.

---

## Next up

Slot **2 (Product launch)** — highest-value category for the explicit ICP (AI startups, SaaS), and the easiest to produce quickly (UI motion, no characters).

After that: slots 3 and 4 in parallel if possible (different skill sets, no dependency), slot 5 last because it's the hardest to nail.
