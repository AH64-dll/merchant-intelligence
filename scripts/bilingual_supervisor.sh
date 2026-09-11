#!/usr/bin/env bash
# Supervises the 4 bilingual translation workers; relaunches on quota windows.
cd /home/amr/Documents/project
LOG=data/bilingual_supervisor.log
MAX_ROUNDS=200
round=0
while [ $round -lt $MAX_ROUNDS ]; do
  round=$((round+1))
  pids=""
  for g in 0 1 2 3; do
    python3 scripts/translate_worker.py --group $g >> data/bilingual_worker_$g.log 2>&1 &
    pids="$pids $!"
  done
  wait $pids 2>/dev/null
  done_count=$(sqlite3 data/merchant_intelligence.db "SELECT COUNT(*) FROM translations;" 2>/dev/null)
  echo "$(date -u +%FT%TZ) round $round done: translations=$done_count" >> "$LOG"
  remaining=0
  for g in 0 1 2 3; do
    tail -5 data/bilingual_worker_$g.log | grep -q "^group $g complete" || remaining=$((remaining+1))
  done
  if [ $remaining -eq 0 ]; then
    echo "$(date -u +%FT%TZ) all groups complete" >> "$LOG"
    exit 0
  fi
  echo "$(date -u +%FT%TZ) backing off 1800s before round $((round+1))" >> "$LOG"
  sleep 1800
done
echo "$(date -u +%FT%TZ) max rounds reached" >> "$LOG"
