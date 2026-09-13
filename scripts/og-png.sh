#!/usr/bin/env bash
# Render public/og.html -> public/og.png at 1200x630 with headless Chrome.
# Needs network for Google Fonts; the virtual-time budget lets them load first.
# Run from anywhere: `scripts/og-png.sh`. Set CHROME to point at another binary.
#
# Chrome's new headless (the only mode since 132) treats --window-size as the
# OUTER window, so the viewport comes out ~88px short and the card is silently
# clipped — a render that exits 0 and has the right pixel dimensions but has
# lost its tagline and date. So: render tall, crop the top 1200x630, and let
# scripts/og-crop.py fail the run if the card's edges are white.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (set CHROME=...)" >&2; exit 1; }

# Scratch space, and a restore path. The date stamp below rewrites og.html in
# place, so a render that fails after it would otherwise leave the HTML dated
# for a card that was never produced. Roll it back unless the run succeeds.
TMPD="$(mktemp -d -t og-render)"
RENDERED=0
cleanup() {
	[ "$RENDERED" = 1 ] || cp "$TMPD/og.html.bak" public/og.html
	rm -rf "$TMPD"
}
trap cleanup EXIT
cp public/og.html "$TMPD/og.html.bak"

# The card states a point-in-time figure, so the "As at" date is what keeps it
# honest. Stamp today's date before rendering: a re-render can never ship a
# stale date, and public/og.html stays the source of truth for the last render.
/usr/bin/python3 - <<'STAMP'
import datetime, re
d = datetime.date.today()
today = f"{d.day} {d:%b %Y}"
p = 'public/og.html'
s = open(p, encoding='utf-8').read()
out = re.sub(r'As at \d{1,2} [A-Z][a-z]{2} \d{4}', f'As at {today}', s)
if out != s:
	open(p, 'w', encoding='utf-8').write(out)
print(f'card dated: {today}')
STAMP

TMP="$TMPD/render.png"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
	--window-size=1200,800 --virtual-time-budget=8000 --screenshot="$TMP" \
	"file://$PWD/public/og.html" 2>/dev/null
/usr/bin/python3 scripts/og-crop.py "$TMP" public/og.png 1200 630
RENDERED=1
sips -g pixelWidth -g pixelHeight public/og.png
