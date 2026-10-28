#!/usr/bin/env bash
# Render the endless paintings as vertical videos for Instagram Reels: 1080×1920,
# 30 fps, each with its own music.
#
#   scripts/make-reels.sh [seconds] [outdir] [page ...]
#
#   seconds  length of each reel (default 45)
#   outdir   where the MP4s go (default reels)
#   page     which paintings (default all three)
#
# Each painting uses the seed of its preview in the gallery. Pour Dreams fills
# its canvas slowly, so its reel starts once it has been painting for a while;
# the music starts past its quiet opening, so a short reel isn't all intro.
# Pour Dreams' paint gurgles in the music as it is poured, where it is poured.
# Needs node, ffmpeg (libx264) and chromium; playwright-core is installed into
# a temporary directory if it can't be found.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
seconds="${1:-45}"
outdir="${2:-reels}"
shift $(($# < 2 ? $# : 2))
fps=30 music_from=30

# page seed skip
REELS="pollock-dreams 7 0
rectangle-dreams 23 0
pour-dreams 5 90"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! node -e "require.resolve('playwright-core')" 2>/dev/null; then
  (cd "$tmp" && npm init -y >/dev/null && npm i --silent playwright-core >/dev/null)
  export NODE_PATH="$tmp/node_modules"
fi
mkdir -p "$outdir"

reel() {
  local page=$1 seed=$2 skip=$3 out="$outdir/$1-reel-$2.mp4"
  local fade_out=$((seconds - 3))
  # the picture first, noting how the painting pours, so the music can gurgle with it
  node "$root/scripts/render-frames.cjs" --page "$page.html" --seed "$seed" --seconds "$seconds" --fps "$fps" \
      --width 1080 --height 1920 --skip "$skip" --pours "$tmp/$page.json" |
    ffmpeg -hide_banner -loglevel error -y -f image2pipe -framerate "$fps" -c:v png -i - \
      -vf "fade=t=in:st=0:d=1,fade=t=out:st=$fade_out:d=3" \
      -c:v libx264 -preset slow -crf 17 -maxrate 25M -bufsize 50M -profile:v high -pix_fmt yuv420p \
      "$tmp/$page.mp4"
  node "$root/scripts/render-music.cjs" --page "$page.html" --seed "$seed" --seconds $((music_from + seconds)) \
      --pours "$tmp/$page.json" --from "$music_from" > "$tmp/$page.wav"
  ffmpeg -hide_banner -loglevel error -y -i "$tmp/$page.mp4" -ss "$music_from" -i "$tmp/$page.wav" \
      -map 0:v -map 1:a -shortest -c:v copy \
      -af "afade=t=in:st=0:d=1.5,afade=t=out:st=$fade_out:d=3" \
      -c:a aac -b:a 256k -ar 48000 -movflags +faststart \
      -metadata title="$page ($seed)" "$out"
  echo "$out"
}

pids=()
while read -r page seed skip; do
  if (($# == 0)) || [[ " $* " == *" $page "* ]]; then
    reel "$page" "$seed" "$skip" & pids+=($!)
  fi
done <<< "$REELS"
for p in "${pids[@]}"; do wait "$p"; done
