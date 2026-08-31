# Merchant Intelligence

Provenance-preserving merchant research pipeline plus an Arabic RTL, server-rendered seller directory.

## Canonical data model

`data/merchant_intelligence.db` is the source of truth (SQLite schema v3). Each `merchants` row is one canonical seller, not one branch. Aliases, identifiers, recorded addresses, evidence, claims, analyses, tasks, and merchant links attach to that seller UUID. Recorded addresses remain `merchant_identifiers(kind='address')`; their count is a location-record count, not a claimed branch count.

The reviewed consolidation manifest lives in `pipeline/merchant_intel/merchant_merge.py`. It merges only manually confirmed chains, preserves every source and evidence observation, rebuilds seller-local claims and duplicate roots, and fails closed if a retired UUID is missing. It never performs fuzzy entity resolution.

## Components

- `pipeline/` — discovery, verification, explicit seller consolidation, targeted UUID-only reanalysis, export, and tests.
- `webapp/` — Next.js application over the audited frozen snapshot at `webapp/data/merchants.db`.
- `data/merchant_intelligence.db` — writable pipeline database. The webapp never opens it directly.

## Public routes

- `/` — seller search.
- `/merchants` — all canonical sellers with pagination and evidence/category/location filters.
- `/merchants/positive-evidence` — deterministic ordering by documented independent positive evidence. It is not a trust score or purchase guarantee.
- `/merchant/[id]` — one seller summary followed by complete evidence, source links, claims, identifiers, analysis, and provenance.
- `/api/merchants` — public list projection; `/api/merchants/[id]` remains the complete detail projection.

## Data operations

Run from `pipeline/` with the repository `config.yaml`:

```bash
python main.py --config ../config.yaml merge-sellers             # dry-run
python main.py --config ../config.yaml merge-sellers --apply     # one transaction
python main.py --config ../config.yaml reanalyze-merchants UUID… # explicit sellers only
python main.py --config ../config.yaml export --format json
python -m pytest -q
```

Run from `webapp/`:

```bash
pnpm snapshot          # audited, atomic snapshot from the master DB
pnpm snapshot:verify
pnpm test
pnpm build
```

Schema v3 is unchanged by seller consolidation. The snapshot gate treats evidence/claim ownership mismatches, cross-seller duplicate roots, duplicate chains/cycles, self merchant links, foreign-key orphans, and stale analysis state as fatal.

## Interpretation boundary

Public output never exposes a numeric trust/reputation score, internal model state, identity-confidence percentage, reliability band, or raw model JSON. Positive-evidence ordering requires diverse independent sources and excludes adverse or official-warning evidence; users must inspect the linked original sources.
