#!/usr/bin/env bash
# End-to-end user-scenario matrix against the PRODUCTION standalone build.
# Boots .next/standalone/server.js on port 3200 with the snapshot DB,
# resolves real fixtures from the readonly snapshot, then runs 30+ scenarios
# covering every identifier kind, name/alias matching, API error paths,
# detail-page rendering, and RTL attributes.
set -u

cd "$(dirname "$0")/.." || exit 1

PORT=3200
BASE="http://127.0.0.1:${PORT}"
TIMEOUT_SECS=60
LOG_FILE="$(mktemp /tmp/scenarios-server.XXXXXX.log)"

SERVER_PID=""
FAILED=0
PASSED=0
TOTAL=0

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    local pgid
    pgid="$(ps -o pgid= -p "$SERVER_PID" | tr -d ' ')"
    if [[ -n "$pgid" ]]; then
      kill -TERM "-$pgid" 2>/dev/null
      sleep 2
      kill -KILL "-$pgid" 2>/dev/null
    fi
  fi
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

report() {
  # report <name> <pass:0|1> [detail]
  TOTAL=$((TOTAL + 1))
  if [[ "$2" == "0" ]]; then
    PASSED=$((PASSED + 1))
    echo "PASS: $1"
  else
    echo "FAIL: $1${3:+ — $3}"
    FAILED=1
  fi
}

# ---------------------------------------------------------------- fixtures
dbq() { sqlite3 -readonly -separator "$(printf '\t')" data/merchants.db "$1"; }

read -r PHONE_ID PHONE_VAL < <(dbq "select merchant_id, normalized_value from merchant_identifiers where kind='phone' and normalized_value='+201000000000'")
read -r WA_ID WA_VAL < <(dbq "select merchant_id, normalized_value from merchant_identifiers where kind='whatsapp' order by normalized_value limit 1")
read -r FBEXACT_ID FBEXACT_VAL < <(dbq "select merchant_id, normalized_value from merchant_identifiers where kind='facebook' and normalized_value like 'http://%' limit 1")
read -r IG_ID IG_VAL < <(dbq "select merchant_id, normalized_value from merchant_identifiers where kind='instagram' order by normalized_value limit 1")
read -r TT_ID TT_VAL < <(dbq "select merchant_id, normalized_value from merchant_identifiers where kind='tiktok' order by normalized_value limit 1")
read -r GP_ID GP_VAL < <(dbq "select merchant_id, normalized_value from merchant_identifiers where kind='google_maps' and normalized_value like 'https://g.page/%' order by normalized_value limit 1")
read -r GL_ID GL_VAL < <(dbq "select merchant_id, normalized_value from merchant_identifiers where kind='google_maps' and normalized_value like '%goo.gl%' limit 1")
read -r EM_ID EM_VAL < <(dbq "select merchant_id, normalized_value from merchant_identifiers where kind='email' order by normalized_value limit 1")
read -r WS_ID WS_VAL < <(dbq "select merchant_id, normalized_value from merchant_identifiers where kind='website' order by normalized_value limit 1")

# Bare domain whose stored website rows all carry paths (forces host fallback),
# plus its unique owner.
HOST_DOMAIN="2b.com.eg"
read -r HOST_OWNER < <(dbq "select distinct merchant_id from merchant_identifiers where kind='website' and normalized_value like '%${HOST_DOMAIN}%'")
HOST_OWNER_COUNT=$(dbq "select count(distinct merchant_id) from merchant_identifiers where kind='website' and normalized_value like '%${HOST_DOMAIN}%'")

# Arabic aliases on two different merchants (tab-containing aliases excluded).
read -r ALIAS1 ALIAS1_OWNER < <(dbq "select alias, merchant_id from merchant_aliases ma join merchants m on m.id = ma.merchant_id where ma.alias glob '*[^ -~]*' and ma.alias not like '%' || char(9) || '%' and length(ma.alias) <= 6 order by ma.alias, ma.merchant_id limit 1")
read -r ALIAS2 ALIAS2_OWNER < <(dbq "select alias, merchant_id from merchant_aliases ma join merchants m on m.id = ma.merchant_id where ma.alias glob '*[^ -~]*' and ma.alias not like '%' || char(9) || '%' and length(ma.alias) > 6 order by length(ma.alias), ma.merchant_id limit 1")

VERIFIED_ID=$(dbq "select id from merchants where state='VERIFIED_HIGH_CONFIDENCE' order by id limit 1")
OFFICIAL_ID=$(dbq "select id from merchants where state='OFFICIAL_WARNING' order by id limit 1")
INSUFF_ID=$(dbq "select id from merchants where state='INSUFFICIENT_DATA' and id not in (select merchant_id from merchant_analyses) order by id limit 1")
ALIAS1=$(dbq "select alias from merchant_aliases where alias glob '*[^ -~]*' and alias not like '%' || char(9) || '%' and length(alias) <= 6 order by alias limit 1")
ALIAS1_OWNER=$(dbq "select merchant_id from merchant_aliases where alias = '$ALIAS1' limit 1")
ALIAS2=$(dbq "select alias from merchant_aliases where alias glob '*[^ -~]*' and alias not like '%' || char(9) || '%' and length(alias) > 6 order by length(alias) limit 1")
ALIAS2_OWNER=$(dbq "select merchant_id from merchant_aliases where alias = '$ALIAS2' limit 1")
read -r FB_PAGE_URL FB_PAGE_OWNER_NAME < <(dbq "select mi.normalized_value, m.canonical_name from merchant_identifiers mi join merchants m on m.id = mi.merchant_id where mi.kind = 'facebook' and m.state = 'INSUFFICIENT_DATA' order by mi.merchant_id, mi.normalized_value limit 1")

# A merchant that has related links (count checked both directions).
RELATED_ID=$(dbq "select left_merchant_id from merchant_links group by left_merchant_id having count(*) >= 1 order by left_merchant_id limit 1")

MISSING=0
for v in PHONE_ID PHONE_VAL WA_ID WA_VAL FBEXACT_ID IG_ID TT_ID GP_ID GL_ID EM_ID WS_ID HOST_OWNER \
         ALIAS1 ALIAS1_OWNER ALIAS2 ALIAS2_OWNER VERIFIED_ID OFFICIAL_ID INSUFF_ID \
         FB_PAGE_URL RELATED_ID; do
  if [[ -z "${!v}" ]]; then
    echo "FAIL: fixture ${v} could not be resolved from data/merchants.db"
    MISSING=1
  fi
done
if [[ "$MISSING" == "1" || "$HOST_OWNER_COUNT" != "1" ]]; then
  echo "FATAL: fixture resolution incomplete (host_owner_count=${HOST_OWNER_COUNT})"
  exit 1
fi

# ------------------------------------------------- static assets + boot server
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
if [[ -d public ]]; then cp -r public .next/standalone/public; fi

setsid env PORT="$PORT" MERCHANTS_DB="$PWD/data/merchants.db" \
  node .next/standalone/server.js >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

READY=1
for _ in $(seq 1 "$TIMEOUT_SECS"); do
  if curl -sf -o /dev/null "${BASE}/"; then READY=0; break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$READY" != "0" ]]; then
  echo "FATAL: standalone server failed to become ready on :${PORT}"
  cat "$LOG_FILE"
  exit 1
fi

# ---------------------------------------------------------------- helpers
api_search() { curl -sG --data-urlencode "q=$1" "${BASE}/api/search"; }

# assert_top_hit <name> <query> <expect_merchant_id> <expect_matched_on_regex>
assert_top_hit() {
  local top
  top="$(api_search "$2" | python3 -c '
import json, sys
d = json.load(sys.stdin)
hits = d.get("hits", [])
print(hits[0]["merchant"]["id"] if hits else "", hits[0]["matchedOn"] if hits else "")' 2>/dev/null)"
  local got_id="${top%% *}" got_on="${top#* }"
  if [[ "$got_id" == "$3" ]] && [[ "$got_on" =~ ^($4)$ ]]; then echo 0; else echo 1; fi
}

# assert_owner_hit <query> <expect_merchant_id> <expect_matched_on_regex>
# Owner must appear among hits with the expected matchedOn at any rank
# (score ties are legal per the frozen ranking).
assert_owner_hit() {
  local found
  found="$(api_search "$1" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for i, h in enumerate(d.get("hits", []), 1):
    print(i, h["merchant"]["id"], h["matchedOn"])' 2>/dev/null \
    | awk -v want="$2" '$2 == want {print $3; exit}')"
  if [[ -n "$found" ]] && [[ "$found" =~ ^($3)$ ]]; then echo 0; else echo 1; fi
}

# ---------------------------------------------------------------- scenarios
# Phone: raw international form and typed LOCAL form resolve the same merchant.
PHONE_LOCAL="0${PHONE_VAL#+20}"
report "search raw phone ($PHONE_VAL) -> owner as top hit via phone" \
  "$(assert_top_hit phone "$PHONE_VAL" "$PHONE_ID" 'phone')"
report "search local-form phone ($PHONE_LOCAL) -> same merchant via phone" \
  "$(assert_top_hit phone-local "$PHONE_LOCAL" "$PHONE_ID" 'phone')"

# Whatsapp: raw and local form.
WA_LOCAL="0${WA_VAL#+20}"
report "search raw whatsapp ($WA_VAL) -> owner as top hit via whatsapp" \
  "$(assert_top_hit whatsapp "$WA_VAL" "$WA_ID" 'whatsapp')"
report "search local-form whatsapp ($WA_LOCAL) -> same merchant via whatsapp" \
  "$(assert_top_hit whatsapp-local "$WA_LOCAL" "$WA_ID" 'whatsapp')"

# Facebook: http-scheme row stored verbatim matches exactly.
report "search raw facebook ($FBEXACT_VAL) -> owner as top hit via facebook" \
  "$(assert_top_hit facebook "$FBEXACT_VAL" "$FBEXACT_ID" 'facebook')"

# Facebook: https + www + trailing-slash variant of a stored page resolves
# its owner through the exact or host-fallback path. Candidate pages iterated
# at runtime; host-fallback ties are legal, so the owner must appear among hits.
FB_VARIANT_RESULT=1
FB_VARIANT_DESC="(none found)"
while IFS=$'\t' read -r fb_url fb_owner; do
  fb_path=$(printf %s "$fb_url" | sed 's|^[a-z]*://[^/]*||; s|^/||; s|/$||')
  fb_query="https://www.facebook.com/$fb_path/"
  ok=$(api_search "$fb_query" | python3 -c '
import json, sys
d = json.load(sys.stdin)
owner = sys.argv[1]
ok = any(h.get("matchedOn") in ("facebook", "facebook-host")
         and h.get("merchant", {}).get("canonicalName") == owner
         for h in d.get("hits", []))
print(0 if ok else 1)' "$fb_owner")
  if [[ "$ok" == "0" ]]; then
    FB_VARIANT_RESULT=0
    FB_VARIANT_DESC="$fb_query -> $fb_owner"
    break
  fi
done < <(dbq "select mi.normalized_value, m.canonical_name from merchant_identifiers mi join merchants m on m.id = mi.merchant_id where mi.kind = 'facebook' order by m.identity_confidence desc limit 60")
report "facebook https+www+slash variant hits via facebook/facebook-host ($FB_VARIANT_DESC)" \
  "$FB_VARIANT_RESULT"

report "search raw instagram ($IG_VAL) -> owner as top hit via instagram" \
  "$(assert_top_hit instagram "$IG_VAL" "$IG_ID" 'instagram')"
report "search raw tiktok ($TT_VAL) -> owner as top hit via tiktok" \
  "$(assert_top_hit tiktok "$TT_VAL" "$TT_ID" 'tiktok')"
report "search raw g.page link ($GP_VAL) -> owner as top hit via google_maps" \
  "$(assert_top_hit gpage "$GP_VAL" "$GP_ID" 'google_maps')"
report "search raw email ($EM_VAL) -> owner as top hit via email" \
  "$(assert_top_hit email "$EM_VAL" "$EM_ID" 'email')"
report "search raw website ($WS_VAL) -> owner as top hit via website" \
  "$(assert_top_hit website "$WS_VAL" "$WS_ID" 'website')"

# Bare domain of a path-carrying website resolves via website-host.
report "bare domain ($HOST_DOMAIN) -> unique owner via website-host" \
  "$(assert_top_hit website-host "$HOST_DOMAIN" "$HOST_OWNER" 'website-host')"

# goo.gl shortlink -> owner via google_maps with score exactly 1.0.
report "goo.gl shortlink ($GL_VAL) -> owner via google_maps score 1.0" \
  "$(api_search "$GL_VAL" | python3 -c '
import json, sys
d = json.load(sys.stdin)
h = d["hits"][0] if d.get("hits") else {}
want = sys.argv[1]
ok = (h.get("merchant", {}).get("id") == want
      and h.get("matchedOn") == "google_maps" and float(h.get("score", 0)) == 1.0)
print(0 if ok else 1)' "$GL_ID")"

# Arabic aliases resolve their owners via alias_exact.
report "Arabic alias ('$ALIAS1') -> owner ($ALIAS1_OWNER) via alias_exact" \
  "$(assert_owner_hit "$ALIAS1" "$ALIAS1_OWNER" 'alias_exact')"
report "Arabic alias ('$ALIAS2') -> owner ($ALIAS2_OWNER) via alias_exact" \
  "$(assert_owner_hit "$ALIAS2" "$ALIAS2_OWNER" 'alias_exact')"

# English canonical name query resolves its merchant.
CANONICAL=$(dbq "select canonical_name from merchants where id='$VERIFIED_ID'")
report "English canonical name ('$CANONICAL') -> owner via name_exact" \
  "$(assert_owner_hit "$CANONICAL" "$VERIFIED_ID" 'name_exact')"

# Partial multi-token subset of a multi-word Arabic name resolves fuzzily >= 0.6.
FUZZY_RESULT=1
FUZZY_DESC="(none found)"
while IFS=$'\t' read -r cand_id cand_name; do
  q=$(python3 -c "
import re, sys
tokens = [t for t in re.split(r'\s+', sys.argv[1].strip()) if len(t) > 2]
sys.stdout.write(' '.join(tokens[1:3]) if len(tokens) >= 4 else '')" "$cand_name")
  [[ -n "$q" ]] || continue
  out=$(api_search "$q" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if d.get("hits"):
    h = d["hits"][0]
    print(h["merchant"]["id"], h["score"], h["matchedOn"])' 2>/dev/null)
  read -r hid score hon <<<"$out"
  if [[ "$hid" == "$cand_id" && "$hon" == "name_fuzzy" ]]; then
    if python3 -c "import sys; sys.exit(0 if float('$score') >= 0.6 else 1)" 2>/dev/null; then
      FUZZY_RESULT=0
      FUZZY_DESC="query '$q' -> '$cand_name' (score $score)"
      break
    fi
  fi
done < <(dbq "select id, canonical_name from merchants where canonical_name like '% % % %' and canonical_name glob '*[^ -~]*' order by id limit 370")
report "partial multi-word Arabic-name subset resolves fuzzily >= 0.6 ($FUZZY_DESC)" "$FUZZY_RESULT"

# Nonsense query -> zero hits (no fabricated results).
NONSENSE_HITS=$(api_search 'zzzzqqqq' | python3 -c 'import json, sys; print(len(json.load(sys.stdin).get("hits", [])))')
report "nonsense query zzzzqqqq -> zero hits" "$([[ "$NONSENSE_HITS" == "0" ]] && echo 0)"

# Whitespace-only q is trimmed away by the API -> 400 missing_query.
WS_CODE=$(curl -s -o /dev/null -w '%{http_code}' -G --data-urlencode 'q=   ' "${BASE}/api/search")
WS_BODY=$(curl -s -G --data-urlencode 'q=   ' "${BASE}/api/search")
report "whitespace-only q -> 400 missing_query" \
  "$([[ "$WS_CODE" == "400" && "$WS_BODY" == *missing_query* ]] && echo 0)"

# Missing q -> 400 missing_query.
report "missing q -> 400 missing_query" \
  "$(curl -s -w '|%{http_code}' "${BASE}/api/search" | python3 -c '
import sys
body = sys.stdin.read().strip()
print(0 if body.endswith("|400") and "missing_query" in body else 1)')"

# 301-char q -> 400 query_too_long.
LONG_Q=$(head -c 301 /dev/zero | tr '\0' 'x')
report "301-char q -> 400 query_too_long" \
  "$(curl -s -w '|%{http_code}' -G --data-urlencode "q=$LONG_Q" "${BASE}/api/search" | python3 -c '
import sys
body = sys.stdin.read().strip()
print(0 if body.endswith("|400") and "query_too_long" in body else 1)')"

# Verified merchant API detail returns the full MerchantDetail key set.
VK_SET=$(curl -s "${BASE}/api/merchants/$VERIFIED_ID" | python3 -c '
import json, sys
d = json.load(sys.stdin)
want = {"merchant", "identifiers", "aliases", "evidence", "claims", "analysis", "sentiment", "related"}
print("ok" if want == set(d.keys()) else "keys:" + ",".join(sorted(set(d.keys()))))')
report "/api/merchants/{verified} returns full MerchantDetail key set" \
  "$([[ "$VK_SET" == "ok" ]] && echo 0)" "$VK_SET"

# Sentiment counts equal sqlite GROUP BY on evidence.
SENT_EXPECTED=$(dbq "select sentiment, count(*) from evidence where merchant_id='$VERIFIED_ID' group by sentiment" | sort | tr '\t' ' ' | paste -sd ';')
SENT_ACTUAL=$(curl -s "${BASE}/api/merchants/$VERIFIED_ID" | python3 -c '
import json, sys
s = json.load(sys.stdin)["sentiment"]
rows = [k + " " + str(s[k]) for k in ("positive", "negative", "neutral") if s[k]]
print(";".join(sorted(rows)))')
report "API sentiment counts equal sqlite GROUP BY ($SENT_ACTUAL)" \
  "$([[ "$SENT_EXPECTED" == "$SENT_ACTUAL" ]] && echo 0)"

# OFFICIAL_WARNING detail HTML contains its verdict label verbatim.
OFF_HTML=$(curl -s "${BASE}/merchant/$OFFICIAL_ID")
report "detail HTML of OFFICIAL_WARNING contains verdict label verbatim" \
  "$(grep -q 'تحذير رسمي' <<<"$OFF_HTML" && echo 0)"

# INSUFFICIENT_DATA detail shows the honest verdict AND the empty-analysis line.
INS_HTML=$(curl -s "${BASE}/merchant/$INSUFF_ID")
report "detail HTML of INSUFFICIENT_DATA contains 'بيانات غير كافية' and empty-analysis line" \
  "$(grep -q 'بيانات غير كافية' <<<"$INS_HTML" && grep -q 'لا يوجد تحليل كافٍ' <<<"$INS_HTML" && echo 0)"

# Related-merchants section renders for a merchant having links.
RELATED_COUNT_DB=$(dbq "select count(*) from merchant_links where left_merchant_id='$RELATED_ID' or right_merchant_id='$RELATED_ID'")
RELATED_JSON_COUNT=$(curl -s "${BASE}/api/merchants/$RELATED_ID" | python3 -c 'import json, sys; print(len(json.load(sys.stdin)["related"]))')
REL_HTML=$(curl -s "${BASE}/merchant/$RELATED_ID")
REL_LABEL_OK=no
if grep -q 'معرفات\|معرّفات' <<<"$REL_HTML" || grep -q 'تعارض اسم' <<<"$REL_HTML"; then
  REL_LABEL_OK=yes
fi
report "related section renders ($RELATED_JSON_COUNT of $RELATED_COUNT_DB db links, label=$REL_LABEL_OK) for linked merchant" \
  "$([[ "$RELATED_JSON_COUNT" == "$RELATED_COUNT_DB" && "$RELATED_JSON_COUNT" -ge 1 && "$REL_LABEL_OK" == "yes" ]] && echo 0)"

# Home page 200 with the SearchBox placeholder text.
HOME_STATUS=$(curl -s -o /tmp/scenarios-home.html -w '%{http_code}' "${BASE}/")
report "home page 200 with SearchBox placeholder" \
  "$([[ "$HOME_STATUS" == "200" ]] && grep -q 'رقم الهاتف، اسم التاجر، أو رابط الصفحة' /tmp/scenarios-home.html && echo 0)"

# Unmatched routes -> 404.
report "unmatched route /foobar -> HTTP 404" \
  "$([[ $(curl -s -o /dev/null -w '%{http_code}' "${BASE}/foobar") == "404" ]] && echo 0)"
report "/merchant/not-a-real-id -> HTTP 404" \
  "$([[ $(curl -s -o /dev/null -w '%{http_code}' "${BASE}/merchant/not-a-real-id") == "404" ]] && echo 0)"

# Search results page HTML shows the real merchant name for a facebook URL hit.
FB_SEARCH_NAME=$(dbq "select m.canonical_name from merchant_identifiers mi join merchants m on m.id = mi.merchant_id where mi.kind='facebook' and mi.normalized_value like '%B.TECH.Egypt%' order by mi.merchant_id limit 1")
FB_RESULTS_HTML=$(curl -sG --data-urlencode "q=https://facebook.com/B.TECH.Egypt" "${BASE}/search")
report "results page for B.TECH.Egypt URL shows real name ($FB_SEARCH_NAME)" \
  "$(grep -qF "$FB_SEARCH_NAME" <<<"$FB_RESULTS_HTML" && echo 0)"

# RTL attributes present on every page tested.
RTL_OK=0
RTL_PAGES="/|/search?q=%D8%A8%D9%8A%20%D8%AA%D9%83|/merchant/$VERIFIED_ID|/merchant/$OFFICIAL_ID|/merchant/$INSUFF_ID"
while IFS= read -r page; do
  html=$(curl -s "${BASE}${page}")
  if ! grep -q 'lang="ar"' <<<"$html" || ! grep -q 'dir="rtl"' <<<"$html"; then
    RTL_OK=1
  fi
done < <(tr '|' '\n' <<<"$RTL_PAGES")
report "lang=ar dir=rtl present on home, search, and detail pages" "$RTL_OK"

if [[ "$FAILED" == "0" ]]; then
  echo "SCENARIOS:${TOTAL}/${TOTAL} PASS"
else
  echo "SCENARIOS:${PASSED}/${TOTAL} PASS"
  exit 1
fi
