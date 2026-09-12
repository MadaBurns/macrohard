#!/usr/bin/env bash
# Render public/og.html -> public/og.png at 1200x630 with headless Chrome.
# Needs network for Google Fonts; the virtual-time budget lets them load first.
# Run from anywhere: `scripts/og-png.sh`. Set CHROME to point at another binary.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (set CHROME=...)" >&2; exit 1; }
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
	--virtual-time-budget=8000 --screenshot="$PWD/public/og.png" "file://$PWD/public/og.html" 2>/dev/null
sips -g pixelWidth -g pixelHeight public/og.png
