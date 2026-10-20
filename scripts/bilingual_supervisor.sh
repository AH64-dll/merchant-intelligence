#!/usr/bin/env bash
# Supervises the 4 bilingual translation workers; relaunches on quota windows.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
LOG=data/bilingual_supervisor.log
MAX_ROUNDS=200
BASE_SLEEP=1800
pids=()
cleanup() {
  # Never orphan the workers: kill every PID this supervisor started.
  if [ "${#pids[@]}" -gt 0 ]; then
    for p in "${pids[@]}"; do
      kill "$p" 2>/dev/null
    done
  fi
}
trap cleanup EXIT INT TERM
round=0
backoff=$BASE_SLEEP
while [ $round -lt $MAX_ROUNDS ]; do
  round=$((round+1))
  pids=()
  for g in 0 1 2 3; do
    python3 scripts/translate_worker.py --group $g >> data/bilingual_worker_$g.log 2>&1 &
    pids+=("$!")
  done
  all_provider_fail=1
  for p in "${pids[@]}"; do
    wait "$p" 2>/dev/null
    [ $? -eq 2 ] || all_provider_fail=0
  done
  done_count=$(sqlite3 data/merchant_intelligence.db "SELECT COUNT(*) FROM translations;" 2>/dev/null)
  echo "$(date -u +%FT%TZ) round $round done: translations=$done_count provider_fail=$all_provider_fail" >> "$LOG"
  remaining=0
  for g in 0 1 2 3; do
    tail -5 data/bilingual_worker_$g.log | grep -q "^group $g complete" || remaining=$((remaining+1))
  done
  if [ $remaining -eq 0 ]; then
    echo "$(date -u +%FT%TZ) all groups complete" >> "$LOG"
    exit 0
  fi
  if [ $all_provider_fail -eq 1 ]; then
    # Every worker returned exit 2 (provider failure): do not re-hit the
    # rate-limited provider on the flat 1800s cadence, back off exponentially.
    echo "$(date -u +%FT%TZ) every group hit provider failure (exit 2); backing off ${backoff}s before round $((round+1))" >> "$LOG"
    sleep "$backoff"
    backoff=$((backoff * 2))
    continue
  fi
  backoff=$BASE_SLEEP
  echo "$(date -u +%FT%TZ) backing off 1800s before round $((round+1))" >> "$LOG"
  sleep 1800
done
echo "$(date -u +%FT%TZ) max rounds reached" >> "$LOG"
