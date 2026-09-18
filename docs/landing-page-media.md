# Landing Page Media

This repo uses two different Cloudflare R2 media paths on the landing page.
Do not mix them up.

## Hero Video

The large homepage app demo video in `app/page.tsx` is hosted from the
`woven-media` R2 bucket and served through:

```text
https://media.woven.video
```

Current convention:

```text
woven-media/woven-hero-v<N>.mp4
woven-media/woven-hero-v<N>.png
```

The current hero source is:

```tsx
poster="https://media.woven.video/woven-hero-v6.png"
<source src="https://media.woven.video/woven-hero-v6-60fps.mp4" type="video/mp4" />
```

### Encode A New Hero

Use the source aspect ratio. Do not force the vertical reel-tile dimensions.
Inspect the source frame rate first. Preserve normal 30 or 60 fps recordings;
60 fps retains smooth UI motion. Normalize only abnormal recorder metadata or
when an explicit size/motion tradeoff calls for it. Do not upscale smaller sources.

```bash
ffmpeg -i /path/to/source.mp4 \
  -vf "fps=60,scale='min(2160,iw)':-2:flags=lanczos" \
  -c:v libx264 -preset slow -crf 23 -profile:v main -pix_fmt yuv420p \
  -an -movflags +faststart \
  /private/tmp/woven-hero-v<N>.mp4
```

Generate a poster from the encoded file:

```bash
ffmpeg -ss 1 -i /private/tmp/woven-hero-v<N>.mp4 \
  -frames:v 1 \
  /private/tmp/woven-hero-v<N>.png \
  -y -hide_banner -loglevel error
```

Then check dimensions and size:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,avg_frame_rate,duration \
  -of default=noprint_wrappers=1 \
  /private/tmp/woven-hero-v<N>.mp4

ls -lh /private/tmp/woven-hero-v<N>.mp4 /private/tmp/woven-hero-v<N>.png
```

Update the `<video width={...} height={...}>` dimensions in `app/page.tsx` to
match the encoded output. Example: the `win-final.mp4` source was `4358x2456`,
so the 2160-wide web encode became `2160x1218`.

### Current asset verification (September 8, 2026)

Source: `~/Desktop/hero-2.mp4`, 2000x1078, 60 fps, 32.4 seconds,
22,188,934 bytes. The published `woven-hero-v6-60fps.mp4` preserves those
dimensions and frame rate, uses H.264 Main/yuv420p and fast-start MP4, and is
2,716,922 bytes (87.8% smaller). Poster: `woven-hero-v6.png`.
No crop was needed (cropdetect confirmed the full source rectangle). The
existing rounded web wrapper handles the window corners. Verified full MP4
decoding, fast-start atom order, public 60 fps metadata, and desktop/mobile
autoplay and layout. A regression check covers the hero source, poster, dimensions,
and playback attributes. An unreferenced
30 fps trial encode exists at `woven-hero-v5.mp4`; it is not the hero source.

### Upload Hero Assets

Wrangler uses the Cloudflare token from the Luna docs env file.

```bash
source ~/Desktop/lunalang/docs/.env
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID=3b145bbc1d3b820ecabbeda0730f2af8

wrangler r2 object put woven-media/woven-hero-v<N>.mp4 \
  --file /private/tmp/woven-hero-v<N>.mp4 \
  --content-type video/mp4 \
  --remote

wrangler r2 object put woven-media/woven-hero-v<N>.png \
  --file /private/tmp/woven-hero-v<N>.png \
  --content-type image/png \
  --remote
```

Verify the public URLs:

```bash
curl -I https://media.woven.video/woven-hero-v<N>.mp4
curl -I https://media.woven.video/woven-hero-v<N>.png
```

Expected: `HTTP/2 200`, correct `content-type`, and a file size in the low-MB
range for the video.

### Bezel Note

If the source came from the custom recorder and already has no black window
bezel, do not run the debezel workflow. If a future screen recording has black
margins or rounded-corner black wedges, use the `debezel-screen-recording`
skill first, then upload the resulting web encode.

## Reel Tiles

The smaller vertical reel tiles in the "Made with Woven" section use a separate
workflow documented in `docs/reel-catalog.md` and `scripts/encode-web-reel.sh`.

Those assets are hosted from:

```text
lunalang-content
https://media.wovenlabs.net
```

`scripts/encode-web-reel.sh` intentionally scales to `540x960` for 9:16 reel
tiles. Do not use it for the landscape hero video.

## Feature Clips (September 2026)

The `#features` section on `/` includes an agent-edit preview, caption and
transition switchers, text animations, and an SFX soundboard. Video previews
check reduced-motion preferences before autoplaying and expose pause controls.
The agent preview lives in `components/agent-edit-preview.tsx`.

### Agent fast-edit demo

Source: `~/Desktop/wovensocial/linger-demo-fast-social.mp4` — 2518x1440,
60 fps, 8.9s screen recording of the agent rebuilding the Linger reel from
one prompt. The source audio track is digital silence, so the web encode
strips it (`-an`), hero-style.

```bash
ffmpeg -i linger-demo-fast-social.mp4 \
  -vf "fps=60,scale='min(2160,iw)':-2:flags=lanczos" \
  -c:v libx264 -preset slow -crf 23 -profile:v main -pix_fmt yuv420p \
  -an -movflags +faststart \
  woven-agent-fast-edit-v1.mp4
```

Poster from the encoded file at 4s (full app view; the opening second is a
zoomed crop). Uploaded to the `woven-media` bucket:

```text
https://media.woven.video/woven-agent-fast-edit-v1.mp4  (2160x1236, 1.9 MB)
https://media.woven.video/woven-agent-fast-edit-v1.png
```

### Caption-style switcher

Source: five full-reel exports in `~/Desktop/wovensocial/exports/`
(`linger_*.mp4`, 1080x1920, 33.3s each). Two are byte-identical renders
(`…13-52-17` and `…13-54-50`), leaving the four harness caption types
(`ReelCaptionPresentation.validTypes`):

| Style | Source export |
|---|---|
| `highlight` (tiktok-highlight) | `linger_2026-09-11_13-51-34.mp4` |
| `word-by-word` | `linger_2026-09-08_22-13-48.mp4` |
| `progressive` (progressive-reveal) | `linger_2026-09-11_13-52-38.mp4` |
| `subtitles` | `linger_2026-09-11_13-52-17.mp4` |

Each was trimmed to the opening 0–10s hook and encoded with the reel-tile
pipeline (540x960, CRF 26, AAC 128k kept — the switcher has a mute toggle):

```bash
ffmpeg -t 10 -i <source>.mp4 \
  -vf "scale=540:960:flags=lanczos" \
  -c:v libx264 -preset slow -crf 26 -profile:v main -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ac 2 -movflags +faststart \
  linger-captions-<style>-web.mp4
```

Posters at 3s (talking head + visible captions), quality JPG. Uploaded to
the `lunalang-content` bucket under a dedicated prefix:

```text
https://media.wovenlabs.net/woven-features/linger-captions-<style>-web.mp4  (~1 MB each)
https://media.wovenlabs.net/woven-features/linger-captions-<style>-poster.jpg
```

Switching preserves playback position in a single `<video>` element;
inactive styles preload once the switcher nears the viewport.

### Transition switcher

Source: thirteen 6s exports in `~/Desktop/Shroomy Shorts/exports/`
(`reel-2026-09-18_05-13-33_2026-09-18_05-*.mp4`, 1080x1920) from the same
two-clip template (`reels/reel-2026-09-18_05-13-33.reel.json`: classic park
→ water park). Each export burns its own name in,
which confirmed the mapping. Current batch (shortened Sep 18 to 1.6s,
transition at 0.6–1.0s) runs in clean harness order:

`fade` (`…08-48-37`), `slide-left`, `slide-right`, `slide-up`, `wipe`,
`whoosh`, `zoom-blur`, `glitch`, `flash`, `dynamic-smear`, `pull-out`,
`tv-glitch`, `pull-in` (`…08-50-07`).

Encoded full-length, 540x960, CRF 26, `-an` — the sources have no
audio track, so the switcher hides the mute toggle. Posters at 0.9s
(mid-transition, label visible), except flash at 1.1s (0.9s is washed out).
Uploaded to the `lunalang-content` bucket:

```text
https://media.wovenlabs.net/woven-features/transition-<slug>-v4-web.mp4  (~0.3 MB each)
https://media.wovenlabs.net/woven-features/transition-<slug>-v4-poster.jpg
```

The version suffix is load-bearing: the edge caches video bytes ~4h and our
token cannot purge the zone, so re-exports ship under a bumped
`ASSET_VERSION` in `components/transition-switcher.tsx` instead of
overwriting. (v1/v3 = older batches, v2 = keys poisoned by a raced
first request that cached a 404 — never referenced, safe to ignore.)
After uploading a new version, verify each key with a unique query first
(`?verify=N`, separate cache entry), then request the bare URLs once to
warm the cache with good bytes.

Component: `components/transition-switcher.tsx`. Shared playback logic
(position-preserving switch, viewport preloading, controls) lives in
`components/switcher-player.tsx` and is reused by the caption and text
switchers. All switchers are manual (no auto-cycle); transitions default to
slide-left, text defaults to typewriter.

The player has a subtle seek bar with the 0.6–1.0s transition window marked
(all clips share the template timing) plus a `0:00 / 0:01` readout. Clicking
the bar seeks, so visitors can replay the moment; it is a
keyboard-operable `slider` for accessibility.

### Text-animation switcher

Source: nine 1.5s exports in `~/Desktop/Shroomy Shorts/exports/text-animations/`
(`reel-2026-09-18_05-59-02_2026-09-18_06-*.mp4`, 1080x1920), all animating the
same "Build Your World" title. Unlike transitions, the clips carry no
burned-in style name, so the mapping was verified per clip: typewriter shows
partial text mid-clip, word-spring reveals word by word, pop overshoots +17%
then settles, fade-out drops brightness at fixed position, shrink contracts,
slide-out moves +28px at full brightness, pulse oscillates bright area,
float oscillates vertical centroid ±9px, shimmer keeps a dim base with a
jumping bright band. Export order matches the list order:

`pop` (`…06-47-11`), `word-spring`, `typewriter`, `fade-out`, `shrink`,
`slide-out`, `pulse`, `float`, `shimmer` (`…06-49-57`).

Encoded full-length, 540x960, CRF 26, `-an` (silent, no mute toggle).
Posters at 0.75s (mid-hold, text settled). Versioned keys (v1 = first batch):

```text
https://media.wovenlabs.net/woven-features/text-<slug>-v2-web.mp4  (~0.24 MB each)
https://media.wovenlabs.net/woven-features/text-<slug>-v2-poster.jpg
```

Component: `components/text-animation-switcher.tsx` (centered player above
grouped pills, two rows per group). No timeline — 1.5s loops replay constantly. Pills group by
Entrances / Exits / Loops.

### SFX soundboard

Source: the open woven-sfx catalog (`woven.video/sfx/catalog.json`, 35
sounds). No local assets and no R2 upload — the board streams twelve curated
one-shots straight from the SFX CDN on tap, and draws each pad's waveform
from the matching peaks JSON behind the `/sfx` rewrite (see `next.config.ts`):

| Pad | Sound | Length | Volume | Key |
|---|---|---|---|---|
| Fast whoosh | `fast-whoosh` | 0.4s | 0.45 | 1 |
| Pop | `pop-hand` | 0.3s | 0.4 | 2 |
| Glitch | `glitch-logo` | 0.6s | 0.4 | 3 |
| Bass impact | `bass-impact` | 2.5s | 0.55 | 4 |
| Scratch | `record-scratch` | 1.3s | 0.4 | 5 |
| Ding | `notification-ding` | 2.0s | 0.4 | 6 |
| Deep whoosh | `deep-whoosh` | 3.2s | 0.45 | 7 |
| Shutters | `camera-shutter-8-shots` | 1.1s | 0.4 | 8 |
| Coins | `several-coins` | 1.4s | 0.4 | 9 |
| Explosion | `explosion` | 3.2s | 0.45 | 0 |
| Swish | `swish-whoosh-large` | 0.8s | 0.45 | Q |
| Message pop | `message-pop-reply` | 0.9s | 0.4 | W |

```text
https://assets.sfx.woven.video/sfx/<id>.wav   (60–570 KB each, tap-to-play only)
/sfx/peaks/<id>.json                          (waveform peaks, fetched near viewport)
```

Component: `components/sfx-soundboard.tsx`, paired beside the text
showcase (4 rows match the player + pills height). One shared `Audio`
element: tapping a pad stops whatever is playing, tapping again stops, and
volumes come from the catalog `default_volume` values. The playing pad's
waveform fills left to right (rAF progress, like the `/sfx` cards) and its
duration swaps to "Playing". Each pad has a keyboard shortcut that works
while focus is inside the board. Peaks are resampled from ~32 buckets to 20
bars so the narrow pads render chunky rounded bars instead of spiky
slivers. A footer links to `/sfx` for the full 35-sound library. To swap
the curation, edit the `PADS` list (ids must exist in the catalog) — no
encode or upload step.
