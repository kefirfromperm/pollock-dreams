#!/usr/bin/env bash
# Pictures of Roman Town for a carousel (Threads, Instagram): 1080×1350
# (4:5), a day in the town in nine, each a moment of one of its plots
# (scripts/roman-town-plots.js) as its reel has it, a little wider.
#
#   scripts/make-roman-town-carousel.sh [outdir]
#
#   outdir   where the JPEGs go (default carousel), roman-town-01-town.jpg …
#
# Needs node, ffmpeg and chromium; playwright-core is installed into a
# temporary directory if it can't be found.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
outdir="${1:-carousel}"

# n name plot second
SHOTS="01 town games 0
02 sunrise dawn 22
03 flock flock 32
04 forum market 24
05 baths baths 44
06 amphitheatre games 24
07 hunt games 44
08 theatre theatre 44
09 dusk night 38"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! node -e "require.resolve('playwright-core')" 2>/dev/null; then
  (cd "$tmp" && npm init -y >/dev/null && npm i --silent playwright-core >/dev/null)
  export NODE_PATH="$tmp/node_modules"
fi
mkdir -p "$outdir"

# each plot once, at all of its moments
for plot in $(awk '{ print $3 }' <<< "$SHOTS" | sort -u); do
  at=$(awk -v p="$plot" '$3 == p { print $4 }' <<< "$SHOTS" | sort -n | paste -sd,)
  node "$root/scripts/render-roman-town.cjs" --plot "$plot" --stills "$at" --width 1080 --height 1350 --out "$tmp" &
done
wait
while read -r n name plot at; do
  ffmpeg -hide_banner -loglevel error -y -i "$tmp/$plot-$(printf %05d "$at").png" -q:v 2 "$outdir/roman-town-$n-$name.jpg"
  echo "$outdir/roman-town-$n-$name.jpg"
done <<< "$SHOTS"
