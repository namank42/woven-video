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
poster="https://media.woven.video/woven-hero-v4.png"
<source src="https://media.woven.video/woven-hero-v4.mp4" type="video/mp4" />
```

### Encode A New Hero

Use the source aspect ratio. Do not force the vertical reel-tile dimensions.
For screen recordings, force `fps=30` because recorder exports can carry very
high nominal frame-rate metadata.

```bash
ffmpeg -i /path/to/source.mp4 \
  -vf "fps=30,scale=2160:-2:flags=lanczos" \
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

Update the `<video width={2160} height={...}>` height in `app/page.tsx` to
match the encoded output. Example: the `win-final.mp4` source was `4358x2456`,
so the 2160-wide web encode became `2160x1218`.

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
