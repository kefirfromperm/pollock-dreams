#!/usr/bin/env bash
# Film Roman Town's plots (scripts/roman-town-plots.js) as vertical videos
# for Instagram Reels: 1080×1920, 30 fps, each with the town's own sound,
# what is in view heard as it is seen.
#
#   scripts/make-roman-town-reels.sh [outdir] [plot ...]
#
#   outdir   where the MP4s go (default reels)
#   plot     which plots (default all): dawn, market, baths, games, theatre,
#            night, flock
#
# Each is the town of its plot's seed (5, the one in the Open Graph image),
# roman-town-<plot>.mp4. The town is drawn by the graphics card; two at a
# time. Needs node, ffmpeg (libx264) and chromium; playwright-core is
# installed into a temporary directory if it can't be found.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
outdir="${1:-reels}"
shift $(($# < 1 ? $# : 1))
plots=("$@")
((${#plots[@]})) || plots=(dawn market baths games theatre night flock)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! node -e "require.resolve('playwright-core')" 2>/dev/null; then
  (cd "$tmp" && npm init -y >/dev/null && npm i --silent playwright-core >/dev/null)
  export NODE_PATH="$tmp/node_modules"
fi
mkdir -p "$outdir"

reel() {
  local plot=$1 out="$outdir/roman-town-$1.mp4"
  local seconds
  seconds=$(node -e "console.log(new Function(require('fs').readFileSync('$root/scripts/roman-town-plots.js', 'utf8') + ';return RomanTownPlots')()['$plot'].seconds)")
  local fade_out=$((seconds - 3))
  node "$root/scripts/render-roman-town.cjs" --plot "$plot" --wav "$tmp/$plot.wav" |
    ffmpeg -hide_banner -loglevel error -y -f image2pipe -framerate 30 -c:v png -i - \
      -vf "fade=t=in:st=0:d=1,fade=t=out:st=$fade_out:d=3" \
      -c:v libx264 -preset slow -crf 18 -maxrate 12M -bufsize 24M -profile:v high -pix_fmt yuv420p \
      "$tmp/$plot.mp4"
  # (the fires' crackle is a click sharp enough for the AAC to overshoot: its
  # very top taken off, and room left under the limit)
  ffmpeg -hide_banner -loglevel error -y -i "$tmp/$plot.mp4" -i "$tmp/$plot.wav" \
      -map 0:v -map 1:a -shortest -c:v copy \
      -af "lowpass=f=14000,alimiter=limit=0.6:level=false,afade=t=in:st=0:d=1.5,afade=t=out:st=$fade_out:d=3" \
      -c:a aac -b:a 256k -ar 48000 -movflags +faststart \
      -metadata title="Roman Town: $plot" "$out"
  echo "$out"
}

running=0
for plot in "${plots[@]}"; do
  reel "$plot" &
  if ((++running >= 2)); then wait -n; running=$((running - 1)); fi
done
wait
