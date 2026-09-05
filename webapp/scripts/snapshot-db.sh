#!/usr/bin/env bash
# snapshot-db.sh — build the audited webapp snapshot from the authoritative master DB.
#
# Contract (Phase 4):
#   1. Open the master READ-ONLY; VACUUM INTO a unique temp file in the destination dir.
#   2. Require source schema_version = 4.
#   3. Detect write drift via PRAGMA data_version + table counts before/after the copy;
#      retry the whole copy up to 3 attempts, then fail without touching the destination.
#   4. Run scripts/audit-data.mjs --strict --expect-schema 4 against the temp copy;
#      its exit must be 0.
#   5. Add the snapshot_meta manifest (app_schema_version=1, source_schema_version=4,
#      UTC generated_at, source maxima, 9 counts) inside the temp copy ONLY.
#   6. Atomically replace DEST_DB. Any failure leaves the previous snapshot untouched.
#
# Schema v4 projection: VACUUM INTO copies the master DB wholesale, so the
# presentation-safe source columns (web_url, source_label, locator_note,
# access_kind) and the source_link_checks / merchant_briefs tables are exported
# whole, exactly as they exist in the source — no filtering, no rewriting.
#
# Env:
#   SRC_DB  source master DB (default: repo data/merchant_intelligence.db)
#   DEST_DB destination snapshot (default: webapp/data/merchants.db)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SRC="${SRC_DB:-$REPO_ROOT/data/merchant_intelligence.db}"
DEST="${DEST_DB:-$REPO_ROOT/webapp/data/merchants.db}"
LOCK="$DEST.lock"
AUDIT="$SCRIPT_DIR/audit-data.mjs"
ATTEMPTS=3

# Escape single quotes for interpolation into a SQLite SQL string literal.
quote_sql() {
  sed "s/'/''/g" <<<"$1"
}

TMP=""
cleanup() {
  # Remove ONLY this invocation's temp file; the lock file stays (it is a lock).
  if [ -n "$TMP" ] && [ -f "$TMP" ]; then
    rm -f "$TMP"
  fi
}
trap cleanup ERR EXIT

die() {
  echo "error: $*" >&2
  exit 1
}

if [ ! -f "$SRC" ]; then
  die "source DB not found at $SRC"
fi
if [ ! -f "$AUDIT" ]; then
  die "audit script not found at $AUDIT"
fi

mkdir -p "$(dirname "$DEST")"

# ---------------------------------------------------------------------------
# Nonblocking lock: a concurrent invocation fails fast, never queues.
# ---------------------------------------------------------------------------
exec 9>"$LOCK"
if ! flock -n 9; then
  die "another snapshot build holds $LOCK; refusing to run concurrently"
fi

# ---------------------------------------------------------------------------
# Read source snapshot state on one connection: schema version, data_version,
# and the nine table counts used for drift comparison.
# ---------------------------------------------------------------------------
read_source_state() {
  sqlite3 "file:$(quote_sql "$SRC")?mode=ro" \
    "PRAGMA data_version;
     SELECT version FROM schema_version;
     SELECT (SELECT count(*) FROM merchants),
            (SELECT count(*) FROM sources),
            (SELECT count(*) FROM evidence),
            (SELECT count(*) FROM claims),
            (SELECT count(*) FROM claim_evidence),
            (SELECT count(*) FROM merchant_analyses),
            (SELECT count(*) FROM merchant_identifiers),
            (SELECT count(*) FROM merchant_aliases),
            (SELECT count(*) FROM merchant_links);"
}

attempt=1
while :; do
  echo "snapshot attempt $attempt/$ATTEMPTS: $SRC -> $DEST"

  # -- pre-copy source state ------------------------------------------------
  source_state="$(read_source_state)"
  dv_before="$(sed -n '1p' <<<"$source_state")"
  src_schema="$(sed -n '2p' <<<"$source_state")"
  counts_before="$(sed -n '3p' <<<"$source_state")"

  if [ "$src_schema" != "4" ]; then
    die "source schema_version is '$src_schema', expected 4 (run the v4 migration first)"
  fi

  # -- transactionally consistent copy --------------------------------------
  TMP="$(mktemp "$(dirname "$DEST")/.merchants.db.snapshot.XXXXXX")"
  if ! sqlite3 "file:$(quote_sql "$SRC")?mode=ro" \
      "VACUUM INTO '$(quote_sql "$TMP")'"; then
    die "VACUUM INTO failed for source $SRC"
  fi

  # -- post-copy source state: drift check ----------------------------------
  source_state_after="$(read_source_state)"
  dv_after="$(sed -n '1p' <<<"$source_state_after")"
  counts_after="$(sed -n '3p' <<<"$source_state_after")"

  if [ "$dv_before" != "$dv_after" ] || [ "$counts_before" != "$counts_after" ]; then
    echo "warning: source drifted during copy (data_version $dv_before->$dv_after); retrying" >&2
    rm -f "$TMP"
    TMP=""
    attempt=$((attempt + 1))
    if [ "$attempt" -gt "$ATTEMPTS" ]; then
      die "source kept changing during copy after $ATTEMPTS attempts; aborting, previous snapshot untouched"
    fi
    continue
  fi

  # -- strict audit of the temp copy ----------------------------------------
  if ! node "$AUDIT" "$TMP" --strict --expect-schema "$src_schema" >"$TMP.audit"; then
    cat "$TMP.audit" >&2
    die "strict audit failed against the copied snapshot; previous snapshot untouched"
  fi
  tail -1 "$TMP.audit"

  # -- manifest (snapshot_meta) inside the temp copy ONLY -------------------
  source_max_evidence_captured_at="$(
    sqlite3 "file:$(quote_sql "$SRC")?mode=ro" "SELECT max(captured_at) FROM evidence"
  )"
  source_max_merchant_updated_at="$(
    sqlite3 "file:$(quote_sql "$SRC")?mode=ro" "SELECT max(updated_at) FROM merchants"
  )"
  IFS='|' read -r \
    merchants_count sources_count evidence_count claims_count claim_evidence_count \
    merchant_analyses_count merchant_identifiers_count merchant_aliases_count \
    merchant_links_count <<<"$counts_after"

  sqlite3 "$TMP" <<SQL
CREATE TABLE snapshot_meta (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  app_schema_version INTEGER NOT NULL,
  source_schema_version INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  source_max_evidence_captured_at TEXT,
  source_max_merchant_updated_at TEXT,
  merchants_count INTEGER NOT NULL,
  sources_count INTEGER NOT NULL,
  evidence_count INTEGER NOT NULL,
  claims_count INTEGER NOT NULL,
  claim_evidence_count INTEGER NOT NULL,
  merchant_analyses_count INTEGER NOT NULL,
  merchant_identifiers_count INTEGER NOT NULL,
  merchant_aliases_count INTEGER NOT NULL,
  merchant_links_count INTEGER NOT NULL
);
INSERT INTO snapshot_meta (
  id, app_schema_version, source_schema_version, generated_at,
  source_max_evidence_captured_at, source_max_merchant_updated_at,
  merchants_count, sources_count, evidence_count, claims_count,
  claim_evidence_count, merchant_analyses_count, merchant_identifiers_count,
  merchant_aliases_count, merchant_links_count
) VALUES (
  1, 1, $src_schema, '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
  '$(quote_sql "$source_max_evidence_captured_at")',
  '$(quote_sql "$source_max_merchant_updated_at")',
  $merchants_count, $sources_count, $evidence_count, $claims_count,
  $claim_evidence_count, $merchant_analyses_count, $merchant_identifiers_count,
  $merchant_aliases_count, $merchant_links_count
);
SQL

  # -- atomic replacement ----------------------------------------------------
  # Same filesystem (temp file lives in the destination directory), so mv is atomic.
  mv -f "$TMP" "$DEST"
  TMP=""
  rm -f "$TMP.audit"

  SRC_SIZE="$(stat -c%s "$SRC")"
  DEST_SIZE="$(stat -c%s "$DEST")"
  echo "snapshot: $DEST ($DEST_SIZE bytes) from $SRC ($SRC_SIZE bytes)"
  echo "counts: $counts_after"
  exit 0
done
