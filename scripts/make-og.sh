#!/usr/bin/env bash
# Render the Open Graph image (1200x630) with headless Chromium.
#
#   scripts/make-og.sh [seed] [palette] [font] [out]
#
#   seed     painting seed (default 1)
#   palette  palette index or part of its name, e.g. "Blue Poles" (default: by seed)
#   font     font file in og/fonts (default MrDafoe-Regular.ttf)
#   out      output PNG (default og/og.png)
#
# Needs python3 and chromium (or google-chrome); og.html loads opentype.js
# from cdnjs, so it also needs network access.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
seed="${1:-1}"
palette="${2:-}"
font="${3:-MrDafoe-Regular.ttf}"
out="${4:-$root/og/og.png}"

browser="$(command -v chromium-browser || command -v chromium || command -v google-chrome || true)"
[ -n "$browser" ] || { echo "chromium or google-chrome not found" >&2; exit 1; }

port=$((20000 + RANDOM % 20000))
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root" >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null' EXIT
for _ in $(seq 50); do
  python3 -c "import socket; socket.create_connection(('127.0.0.1', $port), 0.2)" 2>/dev/null && break
  sleep 0.1
done

enc() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"; }
url="http://127.0.0.1:$port/og/og.html?seed=$seed&font=$(enc "$font")"
[ -n "$palette" ] && url="$url&palette=$(enc "$palette")"

"$browser" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --virtual-time-budget=60000 \
  --screenshot="$out" "$url" >/dev/null 2>&1

echo "$out"
