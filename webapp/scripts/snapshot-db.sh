#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SRC_DB:-/home/amr/Documents/project/data/merchant_intelligence.db}"
DEST="$SCRIPT_DIR/../data/merchants.db"
TMP="$DEST.tmp"

# Escape single quotes for interpolation into a SQLite SQL string literal.
quote_sql() {
  sed "s/'/''/g" <<<"$1"
}

cleanup() {
  rm -f "$TMP"
}
trap cleanup ERR EXIT

if [ ! -f "$SRC" ]; then
  echo "error: source DB not found at $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"

sqlite3 "file:$SRC?mode=ro" "VACUUM INTO '$(quote_sql "$TMP")'"

mv -f "$TMP" "$DEST"

SRC_SIZE="$(stat -c%s "$SRC")"
DEST_SIZE="$(stat -c%s "$DEST")"
echo "source: $SRC ($SRC_SIZE bytes)"
echo "snapshot: $DEST ($DEST_SIZE bytes)"
