#!/usr/bin/env bash
# Render the infinite painting as a Full HD video with its ambient fractal music.
#
#   scripts/make-video.sh [seed] [seconds] [out]
#
#   seed     painting and music seed (default 1950)
#   seconds  length (default 600)
#   out      output MP4 (default pollock-infinite-<seed>.mp4)
#
# Needs node, ffmpeg (libx264) and chromium; playwright-core is installed into
# a temporary directory if it can't be found. 30 fps; a 10-minute video takes
# about 50 minutes to render.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
seed="${1:-1950}"
seconds="${2:-600}"
out="${3:-pollock-infinite-$seed.mp4}"
fps=30

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! node -e "require.resolve('playwright-core')" 2>/dev/null; then
  (cd "$tmp" && npm init -y >/dev/null && npm i --silent playwright-core >/dev/null)
  export NODE_PATH="$tmp/node_modules"
fi

node --max-old-space-size=8000 "$root/scripts/make-music.cjs" --seed "$seed" --seconds "$seconds" > "$tmp/music.wav"

fade_out=$((seconds - 5))
node "$root/scripts/render-frames.cjs" --seed "$seed" --seconds "$seconds" --fps "$fps" |
  ffmpeg -hide_banner -loglevel error -y -f image2pipe -framerate "$fps" -c:v png -i - \
    -vf "fade=t=in:st=0:d=2,fade=t=out:st=$fade_out:d=5" \
    -c:v libx264 -preset slow -crf 14 -profile:v high -pix_fmt yuv420p "$tmp/video.mp4"

ffmpeg -hide_banner -loglevel error -y -i "$tmp/video.mp4" -i "$tmp/music.wav" \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart \
  -metadata title="Pollock Dreams: Infinite ($seed)" "$out"

echo "$out"
