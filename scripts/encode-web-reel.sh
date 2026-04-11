#!/usr/bin/env bash
#
# encode-web-reel.sh — encode a vertical reel for the woven.video landing page.
#
# WHY THESE PARAMETERS
#
# The landing page shows reels in a 9:16 grid: 5 columns on desktop (~205 CSS
# px per tile) and a horizontal scroll-snap carousel on mobile (~280 CSS px
# per tile). Worst-case physical pixels (iPhone Pro Max @ 3x DPR) land around
# 490x870. 540x960 covers every realistic viewport/DPR combination, is exactly
# half the 1080x1920 source (clean downscale), and drops the file ~10x.
#
# CRF 26 @ preset slow is the standard web sweet spot for h264 — visually
# lossless at this size, good compression. Audio kept at 128 kbps AAC because
# the landing-page player has a mute toggle and the reels should be playable.
# +faststart moves the moov atom to the front so <video> can start streaming
# before the entire file lands.
#
# USAGE
#
#   ./scripts/encode-web-reel.sh <input.mp4>
#   ./scripts/encode-web-reel.sh <input.mp4> --upload <r2-prefix>
#
# Examples:
#
#   ./scripts/encode-web-reel.sh ~/Desktop/april-2-final-h264.mp4
#   ./scripts/encode-web-reel.sh ~/Desktop/april-2-final-h264.mp4 --upload week-14
#
# The output is written next to the input with a -web.mp4 suffix. With
# --upload, the file is also pushed to the lunalang-content R2 bucket under
# the given prefix, and the public https://media.wovenlabs.net URL is printed.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <input.mp4> [--upload <r2-prefix>]" >&2
  exit 1
fi

INPUT="$1"
UPLOAD_PREFIX=""

if [[ $# -ge 3 && "$2" == "--upload" ]]; then
  UPLOAD_PREFIX="$3"
fi

if [[ ! -f "$INPUT" ]]; then
  echo "error: input file not found: $INPUT" >&2
  exit 1
fi

# Derive output path: replace any trailing -h264.mp4 or .mp4 with -web.mp4
DIR="$(dirname "$INPUT")"
BASE="$(basename "$INPUT")"
STEM="${BASE%.mp4}"
STEM="${STEM%-h264}"
OUTPUT="${DIR}/${STEM}-web.mp4"

echo "→ encoding $INPUT"
echo "  output:   $OUTPUT"

ffmpeg -i "$INPUT" \
  -vf "scale=540:960:flags=lanczos" \
  -c:v libx264 -preset slow -crf 26 -profile:v main -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ac 2 \
  -movflags +faststart \
  "$OUTPUT" -y -hide_banner -loglevel error

IN_SIZE=$(stat -f%z "$INPUT" 2>/dev/null || stat -c%s "$INPUT")
OUT_SIZE=$(stat -f%z "$OUTPUT" 2>/dev/null || stat -c%s "$OUTPUT")
IN_MB=$(awk "BEGIN {printf \"%.1f\", $IN_SIZE / 1048576}")
OUT_MB=$(awk "BEGIN {printf \"%.1f\", $OUT_SIZE / 1048576}")
RATIO=$(awk "BEGIN {printf \"%.0f\", (1 - $OUT_SIZE / $IN_SIZE) * 100}")

echo "  ${IN_MB} MB → ${OUT_MB} MB (${RATIO}% smaller)"

if [[ -z "$UPLOAD_PREFIX" ]]; then
  echo "✓ done. pass --upload <r2-prefix> to also push to R2."
  exit 0
fi

# Upload to R2 via wrangler. Credentials come from the lunalang .env — same
# source of truth as the publish-reel skill at ~/.claude/skills/publish-reel.
ENV_FILE="$HOME/Desktop/lunalang/docs/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found — can't authenticate with Cloudflare" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID=3b145bbc1d3b820ecabbeda0730f2af8

R2_KEY="${UPLOAD_PREFIX}/$(basename "$OUTPUT")"
echo "→ uploading to r2://lunalang-content/${R2_KEY}"

pnpx wrangler r2 object put "lunalang-content/${R2_KEY}" \
  --file "$OUTPUT" \
  --content-type "video/mp4" \
  --remote

PUBLIC_URL="https://media.wovenlabs.net/${R2_KEY}"
echo "✓ live at ${PUBLIC_URL}"
