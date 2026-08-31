#!/usr/bin/env bash
# End-to-end user-scenario matrix against the PRODUCTION standalone build.
# Boots .next/standalone/server.js on port 3200 with the consolidated
# seller-shaped snapshot DB (351 canonical sellers), resolves real fixtures
# from the readonly snapshot, then runs 50+ scenarios covering every
# identifier kind, name/alias matching, merged-chain canonical resolution,
# the /merchants and /merchants/positive-evidence directories, the
# /api/merchants list envelope and 400 paths, card->detail navigation,
# positive-highlight evidence anchors, multi-branch merged sellers, the
# two location-qualified Delta sellers, API error paths, detail-page
# rendering, and RTL attributes.
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
# All 370 merchants now carry an analysis (post-Wave2 snapshot); any
# INSUFFICIENT_DATA row exercises the honest empty-verdict + notable-evidence
# rendering, so the "no analysis" qualifier is dropped.
INSUFF_ID=$(dbq "select id from merchants where state='INSUFFICIENT_DATA' order by id limit 1")
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
print(hits[0]["merchant"]["id"] if hits else "", hits[0]["match"]["kind"] if hits else "")' 2>/dev/null)"
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
    print(i, h["merchant"]["id"], h["match"]["kind"])' 2>/dev/null \
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
ok = any(h.get("match", {}).get("kind") in ("facebook", "website-host")
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
# Bare domain of a path-carrying website resolves via the https origin form
# (bare host without scheme classifies as name, so the https form is the
# URL-shaped user input).
report "bare domain (https://$HOST_DOMAIN) -> unique owner via website" \
  "$(assert_top_hit website-host "https://$HOST_DOMAIN" "$HOST_OWNER" 'website')"

# goo.gl shortlink -> owner via google_maps, exact_identifier tier, no score.
report "goo.gl shortlink ($GL_VAL) -> owner via google_maps (top-1, no score)" \
  "$(api_search "$GL_VAL" | python3 -c '
import json, sys
d = json.load(sys.stdin)
h = d["hits"][0] if d.get("hits") else {}
want = sys.argv[1]
ok = (h.get("merchant", {}).get("id") == want
      and h.get("match", {}).get("kind") == "google_maps"
      and "score" not in h
      and d.get("ambiguous") is False)
print(0 if ok else 1)' "$GL_ID")"

# Arabic aliases resolve their owners via the exact_alias tier.
report "Arabic alias ('$ALIAS1') -> owner ($ALIAS1_OWNER) via exact_alias" \
  "$(assert_owner_hit "$ALIAS1" "$ALIAS1_OWNER" 'exact_alias')"
report "Arabic alias ('$ALIAS2') -> owner ($ALIAS2_OWNER) via exact_alias" \
  "$(assert_owner_hit "$ALIAS2" "$ALIAS2_OWNER" 'exact_alias')"

# English canonical name query resolves its merchant.
CANONICAL=$(dbq "select canonical_name from merchants where id='$VERIFIED_ID'")
report "English canonical name ('$CANONICAL') -> owner via exact_name" \
  "$(assert_owner_hit "$CANONICAL" "$VERIFIED_ID" 'exact_name')"

# Partial multi-token subset of a multi-word Arabic name resolves fuzzily
# (partial_name or typo tier) with the owner inside the top-3.
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
top3 = d.get("hits", [])[:3]
for h in top3:
    print(h["merchant"]["id"], h["match"]["kind"])' 2>/dev/null)
  while read -r hid hon; do
    if [[ "$hid" == "$cand_id" && ("$hon" == "partial_name" || "$hon" == "typo") ]]; then
      FUZZY_RESULT=0
      FUZZY_DESC="query '$q' -> '$cand_name' (tier $hon)"
      break 2
    fi
  done <<<"$out"
done < <(dbq "select id, canonical_name from merchants where canonical_name like '% % % %' and canonical_name glob '*[^ -~]*' order by id limit 370")
report "partial multi-word Arabic-name subset resolves fuzzily in top-3 ($FUZZY_DESC)" "$FUZZY_RESULT"

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

# Verified merchant API detail returns the Wave-2 MerchantDetail key set
# (assessment-driven: snapshot + duplicateEvidenceCount, no verdict/score).
VK_SET=$(curl -s "${BASE}/api/merchants/$VERIFIED_ID" | python3 -c '
import json, sys
d = json.load(sys.stdin)
want = {"merchant", "identifiers", "aliases", "evidence", "claims", "analysis", "sentiment", "related", "duplicateEvidenceCount", "snapshot"}
print("ok" if want == set(d.keys()) else "keys:" + ",".join(sorted(set(d.keys()))))')
report "/api/merchants/{verified} returns Wave-2 MerchantDetail key set" \
  "$([[ "$VK_SET" == "ok" ]] && echo 0)" "$VK_SET"

# Sentiment counts (non-duplicate basis) equal the sqlite GROUP BY on
# evidence with duplicate_of IS NULL — the deduplicated basis.
SENT_EXPECTED=$(dbq "select sentiment, count(*) from evidence where merchant_id='$VERIFIED_ID' and duplicate_of is null group by sentiment" | sort | tr '\t' ' ' | paste -sd ';')
SENT_ACTUAL=$(curl -s "${BASE}/api/merchants/$VERIFIED_ID" | python3 -c '
import json, sys
s = json.load(sys.stdin)["sentiment"]
rows = [k + " " + str(s[k]) for k in ("positive", "negative", "neutral") if s[k]]
print(";".join(sorted(rows)))')
report "API sentiment counts (non-duplicate basis) equal sqlite GROUP BY ($SENT_ACTUAL)" \
  "$([[ "$SENT_EXPECTED" == "$SENT_ACTUAL" ]] && echo 0)"

# OFFICIAL_WARNING detail HTML contains its verdict label verbatim.
OFF_HTML=$(curl -s "${BASE}/merchant/$OFFICIAL_ID")
report "detail HTML of OFFICIAL_WARNING contains verdict label verbatim" \
  "$(grep -q 'تحذير رسمي' <<<"$OFF_HTML" && echo 0)"


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

# INSUFFICIENT_DATA merchant with positive-only evidence renders the honest
# "signals, not a guarantee" headline (assessment.ts VERIFIED/positive branch);
# a truly empty-evidence merchant shows 'الأدلة غير كافية'.
INS_HTML=$(curl -s "${BASE}/merchant/$INSUFF_ID")
report "detail HTML of INSUFFICIENT_DATA shows honest not-a-guarantee headline" \
  "$(grep -q 'ليست ضمانة' <<<"$INS_HTML" && echo 0)"
# Canonical-seller consolidation scenarios -------------------------------
# The snapshot is seller-shaped: every merged chain is ONE canonical merchant
# and every retired branch UUID is gone. Fixtures resolve canonical rows by
# canonical name (never by retired UUID), so the scenarios hold as long as
# the reviewed merge manifest holds.

BT_CANONICAL=$(dbq "select id from merchants where canonical_name='B.TECH' limit 1")
G2E_CANONICAL=$(dbq "select id from merchants where canonical_name='Games 2 Egypt' limit 1")
RAYA_CANONICAL=$(dbq "select id from merchants where canonical_name='Raya Shop' limit 1")
SHAHEEN_CANONICAL=$(dbq "select id from merchants where canonical_name='Shaheen Center' limit 1")
DELTA_MOHANDESSIN=$(dbq "select id from merchants where canonical_name='Delta Computer — Mohandessin' limit 1")
DELTA_ALEXANDRIA=$(dbq "select id from merchants where canonical_name='Delta Computer Supplies — Alexandria' limit 1")
SNAPSHOT_MERCHANT_COUNT=$(dbq "select count(*) from merchants")

for v in BT_CANONICAL G2E_CANONICAL RAYA_CANONICAL SHAHEEN_CANONICAL \
         DELTA_MOHANDESSIN DELTA_ALEXANDRIA; do
  if [[ -z "${!v}" ]]; then
    echo "FATAL: canonical-seller fixture ${v} missing from data/merchants.db"
    exit 1
  fi
done
if [[ -z "$SNAPSHOT_MERCHANT_COUNT" || "$SNAPSHOT_MERCHANT_COUNT" != "351" ]]; then
  echo "FATAL: expected the consolidated snapshot with 351 merchants, found '${SNAPSHOT_MERCHANT_COUNT}'"
  exit 1
fi

# Each merged chain resolves to exactly one canonical seller: a single hit
# set with no retired branch rows surviving at any rank.
CHAIN_RESULT=0
CHAIN_DESC=""
for pair in "B.TECH:$BT_CANONICAL" "Games 2 Egypt:$G2E_CANONICAL" "Raya Shop:$RAYA_CANONICAL" "Shaheen Center:$SHAHEEN_CANONICAL"; do
  q="${pair%%:*}"; want="${pair#*:}"
  got=$(api_search "$q" | python3 -c '
import json, sys
d = json.load(sys.stdin)
want = sys.argv[1]
hits = d.get("hits", [])
ok = (len(hits) >= 1
      and hits[0]["merchant"]["id"] == want
      and {h["merchant"]["id"] for h in hits} == {want})
print(0 if ok else 1)' "$want")
  if [[ "$got" != "0" ]]; then
    CHAIN_RESULT=1
    CHAIN_DESC="$q"
  fi
done
report "merged chains resolve to one canonical seller each (B.TECH, Games 2 Egypt, Raya Shop, Shaheen Center; failed: ${CHAIN_DESC:-none})" \
  "$CHAIN_RESULT"

# Merged-chain queries never resurface a retired UUID at any rank.
report "no retired branch UUID appears in merged-chain query results" \
  "$(for q in 'B.TECH' 'Games 2 Egypt' 'Raya Shop' 'Shaheen Center' 'بي تك'; do
    api_search "$q"; echo
  done | python3 -c '
import json, sys
retired = {
    "306c4864-694f-46ce-bb9a-0e18f9d31c3a", "31c54405-381c-4364-a49c-a8a9244f7471",
    "d08748d3-b6be-4185-a32e-e439d19d3c72", "0f9b3f71-e2b2-41fb-b834-61ad2375282c",
    "c5cbf814-b4d4-4e99-9532-367282905da1", "bb9cac92-eb9d-4c53-b3c1-97c8352fa2d7",
    "76fa120c-d0c5-489c-a3c2-a5c33d8678a6", "fc74448d-b496-4658-83e4-c938fa9413bf",
    "7d17483f-507c-4171-8b78-9247687ec489",
}
bad = 0
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    d = json.loads(line)
    if any(h["merchant"]["id"] in retired for h in d.get("hits", [])):
        bad = 1
print(bad)')"

# Search pagination over a broad Arabic token with many partial-tier owners.
PAG_JSON=$(curl -sG --data-urlencode 'q=كمبيوتر' --data-urlencode 'page=1' "${BASE}/api/search")
PAG_P2_JSON=$(curl -sG --data-urlencode 'q=كمبيوتر' --data-urlencode 'page=2' "${BASE}/api/search")
report "search pagination page=2 excludes page-1 ids with stable total" \
  "$(printf '%s\n%s' "$PAG_JSON" "$PAG_P2_JSON" | python3 -c '
import json, sys
p1 = json.loads(sys.stdin.readline())
p2 = json.loads(sys.stdin.readline())
overlap = {h["merchant"]["id"] for h in p1.get("hits", [])} & {h["merchant"]["id"] for h in p2.get("hits", [])}
expected = max(0, p1.get("total", 0) - len(p1.get("hits", [])))
ok = (p2.get("page") == 2
      and p2.get("total") == p1.get("total")
      and len(p2.get("hits", [])) == expected
      and not overlap)
print(0 if ok else 1)')"

# /api/merchants view=all: 351 canonical sellers, page size 20, 18 pages,
# no id overlap between the sampled pages.
DIR_ALL_P1=$(curl -s "${BASE}/api/merchants?view=all&page=1")
DIR_ALL_P2=$(curl -s "${BASE}/api/merchants?view=all&page=2")
DIR_ALL_LAST=$(curl -s "${BASE}/api/merchants?view=all&page=18")
report "/api/merchants view=all exposes all $SNAPSHOT_MERCHANT_COUNT canonical sellers exactly once (page size 20, 18 pages)" \
  "$(printf '%s\n%s\n%s\n' "$DIR_ALL_P1" "$DIR_ALL_P2" "$DIR_ALL_LAST" | python3 -c '
import json, sys
pages = [json.loads(line) for line in sys.stdin if line.strip()]
ok = True
seen = []
for p in pages:
    ok = ok and p.get("pagination", {}).get("pageSize") == 20
    seen.extend(e["id"] for e in p.get("items", []))
ok = ok and pages[0].get("pagination", {}).get("total") == 351
ok = ok and pages[0].get("pagination", {}).get("totalPages") == 18
ok = ok and len(set(seen)) == len(seen)
print(0 if ok else 1)')"

# /merchants HTML page: count caption + pagination link + RTL.
DIR_P1_HTML=$(curl -s "${BASE}/merchants")
report "/merchants HTML shows the count caption, pagination link, and RTL attributes" \
  "$(grep -q 'إجمالي البائعين المطابقين' <<<"$DIR_P1_HTML" \
    && grep -q 'dir="rtl"' <<<"$DIR_P1_HTML" \
    && grep -q 'href="/merchants?page=2"' <<<"$DIR_P1_HTML" \
    && echo 0)"

# Positive-evidence view: first page with items (each carrying a highlight).
POS_API_P1=$(curl -s "${BASE}/api/merchants?view=positive-evidence&page=1")
POS_HTML=$(curl -s "${BASE}/merchants/positive-evidence")
report "/api/merchants positive-evidence first page is ordered and every item carries a highlight" \
  "$(python3 -c '
import json, sys
d = json.load(sys.stdin)
items = d.get("items", [])
ok = (d.get("pagination", {}).get("page") == 1
      and d.get("pagination", {}).get("total", 0) >= 1
      and len(items) >= 1
      and all(e.get("positiveHighlight") is not None for e in items))
print(0 if ok else 1)' <<<"$POS_API_P1")"
report "/merchants/positive-evidence HTML carries the non-guarantee disclaimer" \
  "$(grep -q 'لا يمثل ضمانًا لجودة البائع أو نتيجة الشراء' <<<"$POS_HTML" \
    && grep -q 'البائعون ذوو أقوى الأدلة الإيجابية' <<<"$POS_HTML" \
    && echo 0)"

# The public list API never leaks internal fields.
report "positive-evidence API items carry no internal state, confidence, or score fields" \
  "$(python3 -c '
import json, sys
d = json.load(sys.stdin)
entry_keys = {"id", "canonicalName", "categoryTags", "locationLabel", "locationCount",
              "identityLevel", "coverageLevel", "evidence", "positiveHighlight", "updatedAt"}
evidence_keys = {"total", "nonDuplicate", "distinctSources", "positive", "neutral",
                 "negative", "customerPositiveSources", "latestPublishedAt", "lastCapturedAt"}
highlight_keys = {"evidenceId", "summary", "sourceUrl", "sourceCategory", "publishedAt"}
items = d.get("items", [])
ok = len(items) > 0
for e in items:
    ok = ok and set(e.keys()) == entry_keys
    ok = ok and set(e["evidence"].keys()) == evidence_keys
    if e.get("positiveHighlight") is not None:
        ok = ok and set(e["positiveHighlight"].keys()) == highlight_keys
print(0 if ok else 1)' <<<"$POS_API_P1")"

# Filter round-trip: first available category and governorate narrow the
# total below 351 and every returned item matches the filter.
FILTER_CATEGORY=$(python3 -c '
import json, sys
d = json.load(sys.stdin)
cats = d.get("availableFilters", {}).get("categories", [])
print(cats[0] if cats else "")' <<<"$DIR_ALL_P1")
FILTER_GOVERNORATE=$(python3 -c '
import json, sys
d = json.load(sys.stdin)
go = d.get("availableFilters", {}).get("governorates", [])
print(go[0] if go else "")' <<<"$DIR_ALL_P1")
FILTERED_CAT=$(curl -sG --data-urlencode "category=$FILTER_CATEGORY" "${BASE}/api/merchants?view=all")
FILTERED_GOV=$(curl -sG --data-urlencode "governorate=$FILTER_GOVERNORATE" "${BASE}/api/merchants?view=all")
report "category filter ($FILTER_CATEGORY) round-trips: total narrows and every item carries the tag" \
  "$(python3 -c '
import json, sys
want = sys.argv[1]
d = json.load(sys.stdin)
items = d.get("items", [])
ok = (0 < d.get("pagination", {}).get("total", 0) < 351
      and all(want in e.get("categoryTags", []) for e in items))
print(0 if ok else 1)' "$FILTER_CATEGORY" <<<"$FILTERED_CAT")"
report "governorate filter ($FILTER_GOVERNORATE) round-trips: total narrows below 351" \
  "$(python3 -c '
import json, sys
d = json.load(sys.stdin)
ok = 0 < d.get("pagination", {}).get("total", 0) < 351
print(0 if ok else 1)' <<<"$FILTERED_GOV")"

# Out-of-range page: valid syntax, empty items, correct pagination metadata.
OOB_JSON=$(curl -s "${BASE}/api/merchants?view=all&page=999")
report "out-of-range /api/merchants page returns empty items with correct pagination" \
  "$(python3 -c '
import json, sys
d = json.load(sys.stdin)
ok = (d.get("items") == []
      and d.get("pagination", {}).get("page") == 999
      and d.get("pagination", {}).get("total") == 351
      and d.get("pagination", {}).get("totalPages") == 18)
print(0 if ok else 1)' <<<"$OOB_JSON")"

# Invalid list-API queries -> 400 invalid_query.
BAD_QUERIES_OK=0
for u in "view=positive" "page=1.5" "page=0" "coverage=wide" "page=abc"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/merchants?$u")
  if [[ "$code" != "400" ]]; then BAD_QUERIES_OK=1; fi
done
report "invalid /api/merchants queries return 400 invalid_query (bad view, page, coverage)" "$BAD_QUERIES_OK"
# API total for the same governorate, and the first card matches the API's
# first item for that filter.
DIR_GOV_HTML=$(curl -sG --data-urlencode "governorate=$FILTER_GOVERNORATE" "${BASE}/merchants")
report "/merchants HTML governorate filter ($FILTER_GOVERNORATE) narrows the visible count like the API" \
  "$(python3 -c '
import json, re, sys
api = json.loads(sys.argv[1])
html = open(sys.argv[2], encoding="utf-8").read()
want_total = api.get("pagination", {}).get("total", -1)
m = re.search(r"إجمالي البائعين المطابقين: <span dir=\"ltr\">(\d+)</span>", html)
first_name = api.get("items", [{}])[0].get("canonicalName", "")
ok = (m is not None and int(m.group(1)) == want_total
      and 0 < want_total < 351
      and first_name in html)
print(0 if ok else 1)' "$FILTERED_GOV" "/tmp/scenarios-dir-gov.html" <<<"")"
DIR_GOV_HTML_FILE=/tmp/scenarios-dir-gov.html
curl -sG --data-urlencode "governorate=$FILTER_GOVERNORATE" -o "$DIR_GOV_HTML_FILE" "${BASE}/merchants"
report "/merchants HTML governorate filter ($FILTER_GOVERNORATE) narrows the visible count like the API" \
  "$(python3 -c '
import json, re, sys
api = json.loads(open(sys.argv[1], encoding="utf-8").read())
html = open(sys.argv[2], encoding="utf-8").read()
want_total = api.get("pagination", {}).get("total", -1)
m = re.search(r"إجمالي البائعين المطابقين: <span dir=\"ltr\">(\d+)</span>", html)
first_name = api.get("items", [{}])[0].get("canonicalName", "")
ok = (m is not None and int(m.group(1)) == want_total
      and 0 < want_total < 351
      and first_name in html)
print(0 if ok else 1)' "$FILTERED_GOV_FILE" "$DIR_GOV_HTML_FILE")"
done
report "invalid /api/merchants queries return 400 invalid_query (bad view, page, coverage)" "$BAD_QUERIES_OK"
BLANK_BODY=$(curl -s -w '|%{http_code}' -G --data-urlencode 'category=   ' "${BASE}/api/merchants")
report "blank category returns 400 invalid_query" \
  "$(grep -q 'invalid_query' <<<"$BLANK_BODY" && grep -q '|400$' <<<"$BLANK_BODY" && echo 0)"

# /api/merchants envelope: exactly {items, pagination, availableFilters, snapshot}.
report "/api/merchants envelope is exactly {items, pagination, availableFilters, snapshot}" \
  "$(python3 -c '
import json, sys
d = json.load(sys.stdin)
ok = set(d.keys()) == {"items", "pagination", "availableFilters", "snapshot"}
ok = ok and set(d["pagination"].keys()) == {"page", "pageSize", "total", "totalPages"}
ok = ok and set(d["availableFilters"].keys()) == {"categories", "governorates", "coverage"}
ok = ok and set(d["snapshot"].keys()) == {"generatedAt", "sourceSchemaVersion", "appSchemaVersion", "counts"}
ok = ok and d["snapshot"]["counts"]["merchants"] == 351
print(0 if ok else 1)' <<<"$DIR_ALL_P1")"

# Directory card -> seller detail navigation: the first /merchants card links
# to a detail page rendering the same canonical name.
DIR_FIRST_ID=$(python3 -c '
import json, sys
d = json.load(sys.stdin)
items = d.get("items", [])
print(items[0]["id"] if items else "")' <<<"$DIR_ALL_P1")
DIR_FIRST_NAME=$(python3 -c '
import json, sys
d = json.load(sys.stdin)
items = d.get("items", [])
print(items[0]["canonicalName"] if items else "")' <<<"$DIR_ALL_P1")
DIR_DETAIL_HTML=$(curl -s "${BASE}/merchant/$DIR_FIRST_ID")
report "directory card links to its seller detail page (/merchant/$DIR_FIRST_ID renders '$DIR_FIRST_NAME')" \
  "$(grep -qF "href=\"/merchant/$DIR_FIRST_ID\"" <<<"$DIR_P1_HTML" \
    && grep -qF "$DIR_FIRST_NAME" <<<"$DIR_DETAIL_HTML" \
    && echo 0)"

# Positive highlight -> in-page evidence anchor: the highlight evidence id
# must exist as #evidence-<id> on the target detail page (the full evidence
# list renders one article per row with that id).
POS_HIGHLIGHT_SELLER=$(python3 -c '
import json, sys
d = json.load(sys.stdin)
items = d.get("items", [])
print(items[0]["id"] if items else "")' <<<"$POS_API_P1")
POS_HIGHLIGHT_EVID=$(python3 -c '
import json, sys
d = json.load(sys.stdin)
items = d.get("items", [])
h = items[0].get("positiveHighlight") if items else None
print(h["evidenceId"] if h else "")' <<<"$POS_API_P1")
POS_DETAIL_HTML=$(curl -s "${BASE}/merchant/$POS_HIGHLIGHT_SELLER")
report "positive-evidence highlight resolves to its #evidence-<id> anchor on the seller detail page" \
  "$(grep -qF "id=\"evidence-$POS_HIGHLIGHT_EVID\"" <<<"$POS_DETAIL_HTML" \
    && grep -qF "/merchant/$POS_HIGHLIGHT_SELLER#evidence-$POS_HIGHLIGHT_EVID" <<<"$POS_HTML" \
    && echo 0)"

# Multi-branch merged seller (B.TECH): one seller, all recorded locations.
BT_HTML=$(curl -s "${BASE}/merchant/$BT_CANONICAL")
BT_ADDR_COUNT=$(dbq "select count(distinct trim(normalized_value)) from merchant_identifiers where merchant_id='$BT_CANONICAL' and kind='address'")
report "multi-branch merged seller (B.TECH) detail shows 'several recorded locations' with all $BT_ADDR_COUNT location records" \
  "$(grep -q 'توجد عدة مواقع مسجلة' <<<"$BT_HTML" \
    && grep -qF "<span dir=\"ltr\">${BT_ADDR_COUNT}</span> سجلات عناوين" <<<"$BT_HTML" \
    && echo 0)"
report "merged seller detail conserves the union of evidence and aliases" \
  "$(curl -s "${BASE}/api/merchants/$BT_CANONICAL" | python3 -c '
import json, sys
d = json.load(sys.stdin)
ok = (len(d.get("evidence", [])) > 100
      and len(d.get("aliases", [])) >= 20)
print(0 if ok else 1)')"

# Delta query: the two remaining Delta sellers are distinct and location-
# qualified; the shared 'Delta Computer' alias surfaces the two Delta sellers
# plus the distinct Delta Technology alias-sharer at the exact_alias tier,
# so the ambiguity is explained, not merged away.
DELTA_JSON=$(api_search 'Delta Computer')
report "Delta Computer query returns both location-qualified Delta sellers (ambiguous exact_alias family)" \
  "$(python3 -c '
import json, sys
want = {sys.argv[1], sys.argv[2]}
d = json.load(sys.stdin)
hits = d.get("hits", [])
if not hits:
    print(1)
    sys.exit()
top_kind = hits[0]["match"]["kind"]
top = [h for h in hits if h["match"]["kind"] == top_kind]
ids = {h["merchant"]["id"] for h in top}
ok = (top_kind == "exact_alias"
      and want <= ids
      and len(top) == 3
      and d.get("ambiguous") is True)
print(0 if ok else 1)' "$DELTA_MOHANDESSIN" "$DELTA_ALEXANDRIA" <<<"$DELTA_JSON")"
report "Delta sellers stay separate: two distinct location-qualified detail pages" \
  "$(curl -s "${BASE}/merchant/$DELTA_MOHANDESSIN" | grep -qF 'Delta Computer — Mohandessin' \
    && curl -s "${BASE}/merchant/$DELTA_ALEXANDRIA" | grep -qF 'Delta Computer Supplies — Alexandria' \
    && echo 0)"

# Invalid phone diagnostic surfaces through the API.
report "foreign phone 14155551234 -> 200 diagnostic invalid_egyptian_phone, zero hits" \
  "$(api_search '14155551234' | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(0 if d.get("diagnostic") == "invalid_egyptian_phone" and len(d.get("hits", [])) == 0 else 1)')"

# Detail-page HTML: contact links are safe (mailto/tel are contact actions,
# not source links); no javascript:/data:/whois: hrefs may appear.
UNSAFE_LINKS=$(curl -s "${BASE}/merchant/$VERIFIED_ID" | python3 -c '
import re, sys
html = sys.stdin.read()
hrefs = re.findall(r"href=\"([^\"]+)\"", html)
bad = [h for h in hrefs if h.startswith(("javascript:", "data:", "whois:", "vbscript:"))]
src_bad = [h for h in hrefs if re.match(r"^[a-z][a-z0-9+.-]*:(?!//)", h) and not h.startswith(("mailto:", "tel:"))]
print(len(bad) + len(src_bad), ";".join((bad + src_bad)[:5]))')
report "detail HTML contains no unsafe source-link schemes (got: $UNSAFE_LINKS)" \
  "$(UNSAFE_COUNT="${UNSAFE_LINKS%% *}"; [[ "$UNSAFE_COUNT" == "0" ]] && echo 0 || echo 1)"


# Unmatched routes -> 404.
# Home page 200 with a visible Arabic search prompt.
HOME_STATUS=$(curl -s -o /tmp/scenarios-home.html -w '%{http_code}' "${BASE}/")
report "home page 200 renders visible search prompt" \
  "$([[ "$HOME_STATUS" == "200" ]] && grep -q 'ابحث' /tmp/scenarios-home.html && echo 0)"

report "unmatched route /foobar -> HTTP 404" \
  "$([[ $(curl -s -o /dev/null -w '%{http_code}' "${BASE}/foobar") == "404" ]] && echo 0)"
report "/merchant/not-a-real-id renders the not-found UI ('غير موجود' copy)" \
  "$(curl -s "${BASE}/merchant/not-a-real-id" | grep -q 'غير موجود' && echo 0)"

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
