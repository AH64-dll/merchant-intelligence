# Migration & Rollback Plan — Bilingual v5

## What changed
- v4 → v5: additive `translations` table + index; schema_version bumped to 5.
- NO existing table or column was altered. English source text untouched.

## Rollback (any time, lossless)
```bash
# Restore original DB from pre-bilingual backup
cp data/backups/merchant_intelligence-pre-bilingual-20260908T212818Z.db \
   data/merchant_intelligence.db
# Or surgically drop translations (additive only):
sqlite3 data/merchant_intelligence.db \
  "DROP TABLE IF EXISTS translations; DROP INDEX IF EXISTS idx_translations_record; \
   UPDATE schema_version SET version = 4;"
```
Because the migration is purely additive, rollback deletes ONLY translated
content — English originals were never moved or modified.

## Validation after migration (run after any DB change)
```bash
python3 - <<'PY'
import sqlite3
db = sqlite3.connect('file:data/merchant_intelligence.db?mode=ro', uri=True)
assert db.execute("SELECT version FROM schema_version").fetchone()[0] == 5
# English source invariants
assert db.execute("SELECT COUNT(*) FROM evidence").fetchone()[0] == 3763
assert db.execute("SELECT COUNT(*) FROM claims").fetchone()[0] == 2644
assert db.execute("SELECT COUNT(*) FROM merchants").fetchone()[0] == 351
assert db.execute("SELECT COUNT(*) FROM merchant_briefs").fetchone()[0] == 334
print('migration validation OK')
PY
```

## Snapshot contract
- snapshot-db.sh (v5) exports translations table into the snapshot.
- webapp singletons guard bump 4 → 5 required with snapshot:verify
  `--expect-schema 5`.
