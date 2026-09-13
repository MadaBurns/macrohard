#!/bin/bash
# Launch-day monitor. One screen, rerunnable, costs nothing (no model calls).
# Run it every half hour while the link is circulating.
#
#   scripts/watch.sh            # snapshot
#   scripts/watch.sh --tail 30  # snapshot, then sample the live log for 30s
#   scripts/watch.sh --loop     # re-run the snapshot every 5 minutes
#
# Everything here is read-only. Nothing it prints is inferred: each number is
# labelled with where it came from, because a launch-day dashboard that guesses
# is worse than no dashboard.
set -u
BASE="${BASE:-https://macrohard.nz}"
NS="${NS:-6316a73ae2504d40818759e3294d4ecf}"
CWD="$(cd "$(dirname "$0")/.." && pwd)"
# Private scratch dir, not fixed /tmp names: a predictable path in a world-writable
# directory lets a pre-created symlink redirect these writes, and the log sample can
# contain request data.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
TAIL_SECS=0
LOOP=0
while [ $# -gt 0 ]; do
	case "$1" in
		--tail) TAIL_SECS="${2:-20}"; shift 2 ;;
		--loop) LOOP=1; shift ;;
		*) echo "unknown flag: $1" >&2; exit 2 ;;
	esac
done

dim()  { printf '\033[2m%s\033[0m\n' "$1"; }
good() { printf '  \033[32m%-22s\033[0m %s\n' "$1" "$2"; }
warn() { printf '  \033[33m%-22s\033[0m %s\n' "$1" "$2"; }
bad()  { printf '  \033[31m%-22s\033[0m %s\n' "$1" "$2"; }
# Pick a colour from a used/limit ratio: green under 70%, amber under 90%, red at/over.
byload() {
	local label="$1" text="$2" used="$3" limit="$4"
	if [ "$limit" -le 0 ]; then warn "$label" "$text"; return; fi
	local pct=$(( used * 100 / limit ))
	if   [ "$pct" -ge 90 ]; then bad  "$label" "$text"
	elif [ "$pct" -ge 70 ]; then warn "$label" "$text"
	else                         good "$label" "$text"; fi
}

kvget() { # key -> value, or empty when absent
	npx --no-install wrangler kv key get --namespace-id "$NS" "$1" --remote --cwd "$CWD" 2>/dev/null | tail -1
}

snapshot() {
	local day; day="$(date -u +%Y-%m-%d)"
	echo
	printf '\033[1mmacrohard watch\033[0m  %s  (UTC day %s)\n' "$(date -u +%H:%M:%SZ)" "$day"
	dim "$BASE"

	# --- reachability -------------------------------------------------------
	echo
	echo "reachability"
	local r code ms
	r=$(curl -sS -o /dev/null -w '%{http_code}|%{time_total}' --max-time 15 "$BASE/" 2>/dev/null || echo "000|0")
	code="${r%%|*}"; ms="${r##*|}"
	if [ "$code" = 200 ]; then good "front page" "200 in ${ms}s"
	else                       bad  "front page" "HTTP $code — the site is not serving"; fi

	# --- receipts freshness -------------------------------------------------
	echo
	echo "receipts (the numbers on the page)"
	curl -sS --max-time 20 "$BASE/api/receipts" -o "$TMP/receipts.json" 2>/dev/null
	MH_RECEIPTS="$TMP/receipts.json" python3 - <<'PY' 2>/dev/null || bad "receipts" "could not read /api/receipts"
import json, datetime, sys, os
d = json.load(open(os.environ['MH_RECEIPTS']))
if d.get('status') != 'ok':
    print('\033[33m  %-22s\033[0m %s' % ('receipts', 'status=%s (warming)' % d.get('status'))); sys.exit(0)
gen = datetime.datetime.fromisoformat(d['generatedAt'].replace('Z', '+00:00'))
age = (datetime.datetime.now(datetime.timezone.utc) - gen).total_seconds() / 60
# 45 min is the staleness window in src/index.ts; past ~90 the cron itself is failing.
colour = 32 if age < 45 else (33 if age < 90 else 31)
print('\033[%dm  %-22s\033[0m %.0f min old  (cron is */30)' % (colour, 'snapshot age', age))
commits = d['agentCommits']
print('\033[%dm  %-22s\033[0m %s' % (32 if commits else 31,
      'agent commits',
      ('%d of %d  (%.0f%%)' % (commits, d['totalCommits'], d['agentShare'])) if commits
      else '0 of %d — A FALSE ZERO WOULD SHOW HERE' % d['totalCommits']))
print('\033[2m  %-22s\033[0m stale=%s  ledger=%d rows  repos=%d\033[0m'
      % ('', d.get('stale'), len(d['ledger']), len(d['repos'])))
# The token is an optimisation the cron loses without: a 401 on the last refresh
# means the snapshot was read anonymously (60/hr, shared egress) and will go stale
# first. Only a rejection is a fact here; "not rejected" also covers "no token set".
if d.get('tokenRejected'):
    print('\033[31m  %-22s\033[0m GitHub refused GITHUB_TOKEN on the last refresh — rotate it' % 'token')
else:
    print('\033[2m  %-22s\033[0m not rejected on the last refresh (absent or accepted)\033[0m' % 'token')
cut = d.get('truncated') or []
if cut:
    print('\033[33m  %-22s\033[0m %s hit the %s-commit ceiling; that total is a floor'
          % ('truncated', ', '.join(cut), d.get('commitCeiling')))
PY

	# --- spend --------------------------------------------------------------
	echo
	echo "spend (KV counters, UTC day — reset at 00:00Z)"
	local staff_cap og_cap staff_used og_used
	staff_cap=$(python3 -c "
import json,re
s=open('$CWD/wrangler.jsonc').read()
s=re.sub(r'//.*','',s); s=re.sub(r',(\s*[}\]])',r'\1',s)
print(json.loads(s)['vars']['STAFF_DAILY_CAP'])" 2>/dev/null || echo 0)
	og_cap=$(python3 -c "
import json,re
s=open('$CWD/wrangler.jsonc').read()
s=re.sub(r'//.*','',s); s=re.sub(r',(\s*[}\]])',r'\1',s)
print(json.loads(s)['vars']['OG_DAILY_CAP'])" 2>/dev/null || echo 0)
	staff_used=$(kvget "cap:$day");   staff_used="${staff_used:-0}"
	og_used=$(kvget "ogcap:$day");    og_used="${og_used:-0}"
	case "$staff_used" in (*[!0-9]*) staff_used=0 ;; esac
	case "$og_used"    in (*[!0-9]*) og_used=0 ;; esac
	byload "model calls" "$staff_used / $staff_cap   (past this, everyone gets a standing proposal)" "$staff_used" "$staff_cap"
	byload "share renders" "$og_used / $og_cap   (past this, the generic card serves)" "$og_used" "$og_cap"

	# --- reach --------------------------------------------------------------
	echo
	echo "reach"
	local n
	n=$(curl -sS --max-time 15 "$BASE/api/stats" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin)['restructured'])" 2>/dev/null || echo "?")
	good "organisations built" "$n  (only real generations count; fallbacks do not)"
	echo
}

sample_tail() {
	echo "log sample — ${TAIL_SECS}s (errors and exceptions only)"
	dim "a quiet sample is not proof of health; it only means nothing failed in this window"
	local out="$TMP/tail.json"
	: > "$out"
	npx --no-install wrangler tail macrohard --format json --cwd "$CWD" > "$out" 2>/dev/null &
	local pid=$!
	sleep "$TAIL_SECS"
	kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
	python3 - "$out" <<'PY'
import json, sys, collections
raw = open(sys.argv[1]).read()
objs, depth, buf = [], 0, ''
for ch in raw:
    if ch == '{': depth += 1
    if depth > 0: buf += ch
    if ch == '}':
        depth -= 1
        if depth == 0 and buf:
            try: objs.append(json.loads(buf))
            except Exception: pass
            buf = ''
reqs = 0
problems = collections.Counter()
for e in objs:
    if (e.get('event') or {}).get('request'): reqs += 1
    if e.get('outcome') not in (None, 'ok'): problems['outcome=' + str(e['outcome'])] += 1
    for ex in e.get('exceptions') or []:
        problems['exception: ' + str(ex.get('message'))[:80]] += 1
    for log in e.get('logs') or []:
        if log.get('level') == 'error':
            problems['error: ' + ' '.join(str(m) for m in log.get('message', []))[:80]] += 1
print('  requests sampled: %d' % reqs)
if not problems:
    print('  \033[32mno errors in the sample\033[0m')
for msg, n in problems.most_common(10):
    print('  \033[31m%3d×\033[0m %s' % (n, msg))
PY
	echo
}

while :; do
	snapshot
	[ "$TAIL_SECS" -gt 0 ] && sample_tail
	[ "$LOOP" -eq 1 ] || break
	dim "sleeping 5 min — ctrl-c to stop"
	sleep 300
done
