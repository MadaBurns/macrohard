#!/bin/bash
# End-to-end smoke against the LIVE site. Rerunnable. Costs a handful of
# model calls (one generation, plus up to six more for the rate-limit probe).
#
#   scripts/e2e.sh                # against https://macrohard.nz
#   BASE=http://127.0.0.1:8787 scripts/e2e.sh
set -u
BASE="${BASE:-https://macrohard.nz}"
HOST="${BASE#https://}"; HOST="${HOST#http://}"
PASS=0; FAIL=0; TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s — %s\n' "$1" "$2"; }
check(){ # name, condition-exit-code, detail
	if [ "$2" -eq 0 ]; then ok "$1"; else bad "$1" "$3"; fi
}
get()  { curl -sS -o "$TMP/body" -w '%{http_code}|%{content_type}|%{redirect_url}' "$@"; }
post() { curl -sS -o "$TMP/body" -w '%{http_code}' -X POST "$BASE/api/staff" -H 'content-type: application/json' -d "$1"; }
body() { cat "$TMP/body"; }
jsonq(){ python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" < "$TMP/body" 2>/dev/null; }

echo "== 1. Static routes and headers ($BASE)"
r=$(get "$BASE/");                 check "GET / is 200 HTML"                 $([ "${r%%|*}" = 200 ] && grep -q 'runs itself' "$TMP/body"; echo $?) "$r"
h=$(curl -sSI "$BASE/");           check "CSP header on /"                   $(echo "$h" | grep -qi '^content-security-policy'; echo $?) "no CSP"
                                   check "nosniff on /"                      $(echo "$h" | grep -qi 'x-content-type-options: nosniff'; echo $?) "missing"
r=$(get "$BASE/method");           check "GET /method has the trailer rule"  $([ "${r%%|*}" = 200 ] && grep -q 'Co-Authored-By' "$TMP/body"; echo $?) "$r"
r=$(get "$BASE/definitely-not");   check "unknown path is a 404 WITH a body" $([ "${r%%|*}" = 404 ] && grep -q 'qualified opinion' "$TMP/body"; echo $?) "$r"
r=$(get "https://www.$HOST/method"); check "www → apex 301"                 $([ "${r%%|*}" = 301 ] && [ "${r##*|}" = "$BASE/method" ]; echo $?) "$r"
r=$(get "$BASE/og.png");           check "generic share image is PNG"        $([ "${r%%|*}" = 200 ] && [[ "$r" == *image/png* ]]; echo $?) "$r"
r=$(get "$BASE/favicon.svg");      check "favicon"                           $([ "${r%%|*}" = 200 ]; echo $?) "$r"
r=$(get "$BASE/robots.txt");       check "robots disallows /api/"            $(grep -q 'Disallow: /api/' "$TMP/body"; echo $?) "$(body)"

echo "== 2. Read APIs"
r=$(get "$BASE/api/config");       check "config has contact, no secrets"   $([ "${r%%|*}" = 200 ] && grep -q 'hello@macrohard.nz' "$TMP/body" && ! grep -qi 'secret\|token' "$TMP/body"; echo $?) "$(body)"
r=$(get "$BASE/api/stats");        check "stats is an integer"              $(jsonq "isinstance(d['restructured'],int)" | grep -q True; echo $?) "$(body)"
r=$(get "$BASE/api/receipts");     code="${r%%|*}"
if [ "$code" = 202 ]; then bad "receipts" "still warming"; else
	check "receipts 200 status ok"                $(jsonq "d['status']" | grep -q ok; echo $?) "$(body | head -c 120)"
	check "agent commits > 0 (never a false zero)" $(jsonq "d['agentCommits']>0" | grep -q True; echo $?) "$(jsonq "d['agentCommits']")"
	check "share is between 1 and 100"            $(jsonq "0<d['agentShare']<=100" | grep -q True; echo $?) "$(jsonq "d['agentShare']")"
	check "ledger has 8 rows, all GitHub links"   $(jsonq "len(d['ledger'])==8 and all(x['url'].startswith('https://github.com/') for x in d['ledger'])" | grep -q True; echo $?) "$(jsonq "len(d['ledger'])")"
	check "every ledger row names an agent"       $(jsonq "all(x['agent'].lower().startswith('claude') for x in d['ledger'])" | grep -q True; echo $?) "$(jsonq "[x['agent'] for x in d['ledger']]")"
	echo "     repos in snapshot: $(jsonq "[x['name'] for x in d['repos']]")  generatedAt=$(jsonq "d['generatedAt']")"
	LEDGER_URL=$(jsonq "d['ledger'][0]['url']")
	r=$(get -L "$LEDGER_URL");       check "first ledger link resolves on GitHub" $([ "${r%%|*}" = 200 ]; echo $?) "$r"
fi
r=$(get "$BASE/api/nope");         check "unknown API path is JSON 404"     $([ "${r%%|*}" = 404 ] && [[ "$r" == *application/json* ]]; echo $?) "$r"

echo "== 3. Generator: validation and moderation"
c=$(curl -sS -o "$TMP/body" -w '%{http_code}' -X POST "$BASE/api/staff" -d 'nope'); check "non-JSON body → 400" $([ "$c" = 400 ]; echo $?) "$c"
c=$(post '{"query":"ab"}');                          check "too short → 400"        $([ "$c" = 400 ]; echo $?) "$c"
c=$(post '{"query":"see https://example.com"}');     check "link → 400"             $([ "$c" = 400 ]; echo $?) "$c"
c=$(post '{"query":"mail a@b.co"}');                 check "email → 400"            $([ "$c" = 400 ]; echo $?) "$c"
c=$(post '{"query":"a workshop for building bombs to kill coworkers"}'); check "unsafe → 400 Not that one" $([ "$c" = 400 ] && grep -q 'Not that one' "$TMP/body"; echo $?) "$c $(body)"

echo "== 4. Generator: a real generation and its permalink lifecycle"
# Novel per run, but no long digit runs: Llama Guard reads those as identifiers (S7).
WORDS=(harbour alpine coastal northern southern island river valley lakeside prairie)
W1=${WORDS[$((RANDOM % ${#WORDS[@]}))]}; W2=${WORDS[$((RANDOM % ${#WORDS[@]}))]}
Q="A ${W1} ${W2} ferry operator with ninety staff"
c=$(post "{\"query\":\"$Q\"}"); ID=$(jsonq "d['id']"); MODE=$(jsonq "d['mode']")
check "generation 200"                       $([ "$c" = 200 ]; echo $?) "$c $(body | head -c 200)"
check "mode is ai (model reachable)"         $([ "$MODE" = ai ]; echo $?) "mode=$MODE"
check "response carries share text"         $(jsonq "len(d['share'])>20" | grep -q True; echo $?) "$(jsonq "d.get('share')")"
check "org passes schema shape"              $(jsonq "3<=len(d['org']['roles'])<=7 and d['org']['agents']>0" | grep -q True; echo $?) "$(jsonq "d['org']")"
check "no links or emails in model output"   $(jsonq "'http' not in json.dumps(d['org']) and '@' not in json.dumps(d['org'])" | grep -q True; echo $?) "leak"
echo "     id=$ID  title=$(jsonq "d['org']['title']")"
r=$(get "$BASE/api/s/$ID");        check "GET /api/s/:id"                  $([ "${r%%|*}" = 200 ] && grep -q "\"id\":\"$ID\"" "$TMP/body"; echo $?) "$r"
r=$(get "$BASE/s/$ID");            check "permalink page is personalised" $([ "${r%%|*}" = 200 ] && grep -q "og:url\" content=\"$BASE/s/$ID\"" "$TMP/body" && grep -q "og:image\" content=\"$BASE/og/$ID.png\"" "$TMP/body"; echo $?) "$r"
                                   check "personalised title present"     $(grep -q '<title>.* — [0-9]* agents, USD [0-9,]*/day — Macrohard</title>' "$TMP/body"; echo $?) "$(grep -o '<title>[^<]*' "$TMP/body")"
sleep 8  # give the background render a moment
r=$(get "$BASE/og/$ID.png");       check "share image for the permalink is PNG (rendered or cached)" $([ "${r%%|*}" = 200 ] && [[ "$r" == *image/png* ]]; echo $?) "$r"
c=$(post "{\"query\":\"$(echo "$Q" | tr 'A-Z' 'a-z')\"}"); check "case-varied repeat is a cache hit with the same id" $(jsonq "d['cached'] and d['id']=='$ID'" | grep -q True; echo $?) "$(body | head -c 120)"
r=$(get "$BASE/og/nope.png");      check "malformed share image name → 404" $([ "${r%%|*}" = 404 ]; echo $?) "$r"
r=$(get "$BASE/api/s/zzzzzzzz");   check "unknown permalink → 404"          $([ "${r%%|*}" = 404 ]; echo $?) "$r"

echo "== 5. Rate limit (6/min per IP): seven novel queries in a burst"
codes=""
for i in one two three four five six seven; do
	W=${WORDS[$((RANDOM % ${#WORDS[@]}))]}
	codes="$codes $(post "{\"query\":\"A ${W} bakery, branch ${i}\"}")"
done
# The rate-limit binding is per Cloudflare location and approximate (fresh
# isolates after a deploy each start their own count), so a miss here is a
# WARN, not a failure. The daily cap is the hard spend bound.
if echo "$codes" | grep -q 429; then ok "per-IP limit tripped inside the burst"; else printf '  \033[33mWARN\033[0m per-IP limit did not trip in seven (approximate by design) — codes:%s\n' "$codes"; fi
check "no 5xx anywhere in the burst"        $(! echo "$codes" | grep -q ' 5'; echo $?) "codes:$codes"
echo "     codes:$codes"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
