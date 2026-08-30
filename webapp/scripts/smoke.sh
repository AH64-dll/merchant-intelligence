#!/usr/bin/env bash
# Smoke test for the seller search engine API.
# Boots `pnpm dev` on port 3100, exercises the search + merchant endpoints,
# prints PASS/FAIL per check, and always kills the dev server on exit.
set -u

cd "$(dirname "$0")/.." || exit 1

PORT=3100
BASE="http://127.0.0.1:${PORT}"
TIMEOUT_SECS=60
LOG_FILE="$(mktemp /tmp/smoke-dev.XXXXXX.log)"

DEV_PID=""
FAILED=0

cleanup() {
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    # Kill the whole process group so next dev's children die too.
    local pgid
    pgid="$(ps -o pgid= -p "$DEV_PID" | tr -d ' ')"
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
  local name="$1" pass="$2" detail="${3:-}"
  if [[ "$pass" == "0" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name${detail:+ — $detail}"
    FAILED=1
  fi
}

# Assert helper: reads a JSON body from stdin, evaluates a python expression
# with the body bound to `d` and the HTTP status bound to `status`.
assert_json() {
  # assert_json <name> <status> <python-expr>
  local name="$1" status="$2" expr="$3"
  local out rc
  out="$(python3 -c "
import json, sys
status = int('$status')
try:
    d = json.load(sys.stdin)
except Exception:
    print('invalid JSON')
    sys.exit(1)
sys.exit(0 if ($expr) else 1)
")"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    report "$name" 1 "$out"
    return
  fi
  report "$name" 0
}

echo "== starting dev server on port ${PORT} =="
PORT="$PORT" setsid pnpm dev >"$LOG_FILE" 2>&1 &
DEV_PID=$!

ready=1
deadline=$((SECONDS + TIMEOUT_SECS))
while (( SECONDS < deadline )); do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "dev server exited early; log tail:"
    tail -n 20 "$LOG_FILE"
    echo "SMOKE:FAIL"
    exit 1
  fi
  http="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${BASE}/api/search?q=__ready_probe__" || true)"
  if [[ "$http" != "000" && -n "$http" ]]; then
    ready=0
    break
  fi
  sleep 1
done

if [[ $ready -ne 0 ]]; then
  echo "dev server not ready after ${TIMEOUT_SECS}s; log tail:"
  tail -n 20 "$LOG_FILE"
  echo "SMOKE:FAIL"
  exit 1
fi
echo "dev server ready"

fetch() {
  # fetch <url> -> sets STATUS and BODY
  STATUS="$(curl -s -o /tmp/smoke-body.$$ -w '%{http_code}' --max-time 15 "$1")"
  BODY="$(cat /tmp/smoke-body.$$)"
  rm -f /tmp/smoke-body.$$
}

# a) phone search — new envelope: hits[].match.kind, no numeric score
fetch "${BASE}/api/search?q=%2B201286619966"
printf '%s' "$BODY" | assert_json "a) phone +201286619966 hits with match.kind=phone" "$STATUS" \
  "status==200 and len(d.get('hits',[]))>0 and d['hits'][0]['match']['kind']=='phone'"

# b) facebook URL search
fetch "${BASE}/api/search?q=http://facebook.com/MTIholding"
printf '%s' "$BODY" | assert_json "b) facebook.com/MTIholding non-empty hits" "$STATUS" \
  "status==200 and len(d.get('hits',[]))>0"

# c) Arabic name search
printf '%s' "$BODY" | assert_json "c) Arabic 'بي تك' non-empty hits with new envelope" "$STATUS" \
  "status==200 and len(d.get('hits',[]))>0 and set(['query','inputKind','total','page','pageSize','ambiguous','diagnostic','hits']).issubset(set(d.keys()))"

# d) nonsense query → zero hits
fetch "${BASE}/api/search?q=zzzzqqqq"
printf '%s' "$BODY" | assert_json "d) zzzzqqqq zero hits" "$STATUS" \
  "status==200 and len(d.get('hits',[]))==0"

# d2) envelope validity: every hit exposes merchant + match{kind,value,label} and no score
fetch "${BASE}/api/search?q=%D8%A8%D9%8A%20%D8%AA%D9%83"
printf '%s' "$BODY" | assert_json "d2) every hit carries merchant + match{kind,value,label}, no score" "$STATUS" \
  "status==200 and all(('merchant' in h and set(['kind','value','label']).issubset(set(h['match'].keys())) and 'score' not in h) for h in d.get('hits',[]))"

# e) missing q → 400
fetch "${BASE}/api/search"
printf '%s' "$BODY" | assert_json "e) missing q → 400 missing_query" "$STATUS" \
  "status==400 and d.get('error')=='missing_query'"

# e2) invalid phone → 200 with invalid_egyptian_phone diagnostic and zero hits
fetch "${BASE}/api/search?q=14155551234"
printf '%s' "$BODY" | assert_json "e2) foreign phone 14155551234 → diagnostic invalid_egyptian_phone" "$STATUS" \
  "status==200 and d.get('diagnostic')=='invalid_egyptian_phone' and len(d.get('hits',[]))==0"

# f) real merchant detail + unknown merchant 404
MID="$(sqlite3 data/merchants.db "select id from merchants limit 1" 2>/dev/null | tr -d '[:space:]')"
if [[ -n "$MID" ]]; then
  fetch "${BASE}/api/merchants/${MID}"
  printf '%s' "$BODY" | assert_json "f) detail of real merchant has canonicalName" "$STATUS" \
    "status==200 and bool(d.get('merchant',{}).get('canonicalName'))"
else
  report "f) resolve real merchant id via sqlite3" 1 "sqlite3 returned empty id"
fi

fetch "${BASE}/api/merchants/does-not-exist"
printf '%s' "$BODY" | assert_json "f) unknown merchant → 404 not_found" "$STATUS" \
  "status==404 and d.get('error')=='not_found'"

if [[ $FAILED -eq 0 ]]; then
  echo "SMOKE:PASS"
else
  echo "SMOKE:FAIL"
fi
exit "$FAILED"
