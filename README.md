# Merchant Intelligence

Provenance-preserving merchant research pipeline plus an Arabic RTL, server-rendered seller directory.

## Canonical data model

`data/merchant_intelligence.db` is the source of truth (SQLite schema v5). Each `merchants` row is one canonical seller, not one branch. Aliases, identifiers, recorded addresses, evidence, claims, analyses, tasks, and merchant links attach to that seller UUID. Recorded addresses remain `merchant_identifiers(kind='address')`; their count is a location-record count, not a claimed branch count.

The reviewed consolidation manifest lives in `pipeline/merchant_intel/merchant_merge.py`. It merges only manually confirmed chains, preserves every source and evidence observation, rebuilds seller-local claims and duplicate roots, and fails closed if a retired UUID is missing. It never performs fuzzy entity resolution.

## Components

- `pipeline/` — discovery, verification, explicit seller consolidation, targeted UUID-only reanalysis, export, and tests.
- `webapp/` — Next.js application over the audited frozen snapshot at `webapp/data/merchants.db`.
- `data/merchant_intelligence.db` — writable pipeline database. The webapp never opens it directly.

## Public routes

- `/` — seller search.
- `/{ar,en}` — bilingual seller search home.
- `/{ar,en}/search` — name/phone/link search; query + pagination run client-side over the generated `public/data/search-index.json` using the same `SearchIndex` ranking the server used.
- `/{ar,en}/merchants` — all canonical sellers with pagination and evidence/category/location filters, driven client-side by `public/data/directory.json`.
- `/{ar,en}/merchants/positive-evidence` — deterministic ordering by documented independent positive evidence. It is not a trust score or purchase guarantee.
- `/{ar,en}/merchant/[id]` — one seller summary followed by complete evidence, source links, claims, identifiers, analysis, and provenance; every merchant is a fully prerendered static page.
- `/{ar,en}/privacy` — bilingual privacy and advertising disclosure (cookies, Consent Mode v2, non-guarantee disclaimer).
- `/api/merchants/index.json` — static JSON list projection (former `/api/merchants` parity).
- `/api/merchants/<id>.json` — static per-merchant detail shard (former `/api/merchants/[id]` parity, same whitelisted projection).

## Languages

The interface is fully bilingual (Arabic RTL default, English LTR). The locale lives in the **URL path** (`/ar/…` vs `/en/…`); the header switcher navigates between the two versions of the current page. The `<html lang>`/`dir` attributes are corrected client-side by a boot script from the path prefix (static export can't vary document attributes per route). Stored Arabic and Latin content is rendered with `dir="auto"`/`<bdi>` isolation so mixed-direction values (phones, URLs, addresses, dates) keep their own reading order.

## Advertising

Ads are **off by default** and are pure configuration — no code change is needed to switch them on:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_ENABLE_ADS` | Master kill switch (`1`/`true`/`yes`/`on`). Everything below is inert while it is off. |
| `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID` | Publisher id (`ca-pub-…` or `pub-…`). |
| `NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM` | Slot id for the bottom/footer horizontal banner. |
| `NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR` | Slot id for the sidebar rectangle unit. |

`webapp/.env.example` documents all four; `webapp/public/ads.txt` carries the AdSense verification line and must have its placeholder `pub-…` replaced before go-live. The units reserve their height before fill (no layout shift), collapse when Google reports them unfilled, carry a visible «إعلان»/"Ad" label, and load behind Google Consent Mode v2 (denied until the user accepts). Placement is policy-bounded: the bottom banner is suppressed on `/merchant/[id]` whenever the seller carries adverse claims, an official warning, or high-risk signals, and the directory shell carries the sidebar unit.

## Data operations

Run from `pipeline/` with the repository `config.yaml`:

```bash
python main.py --config ../config.yaml merge-sellers             # dry-run
python main.py --config ../config.yaml merge-sellers --apply     # one transaction
python main.py --config ../config.yaml reanalyze-merchants UUID… # explicit sellers only
python main.py --config ../config.yaml export --format json
python -m pytest -q
```

Run from `webapp/` — the site is a **fully static export**, there is no Node server in production:

```bash
pnpm snapshot          # audited, atomic snapshot from the master DB
pnpm snapshot:verify   # strict re-audit of the generated snapshot
pnpm export:data       # emits public/data/*.json + public/api/merchants/*.json + _headers
pnpm test              # vitest
pnpm build             # writes the deployable site to out/
```

Serve `out/` from any static host (GitHub Pages, Cloudflare Pages, Netlify, S3): `python3 -m http.server --directory out` for a local preview. For a project-site URL (`https://<user>.github.io/<repo>/`) build with `NEXT_PUBLIC_BASE_PATH=/repo`. `.github/workflows/deploy-static.yml` automates the whole pipeline to GitHub Pages; a regenerated snapshot deployed on schedule keeps the rendered "Last Updated" date current.

`pnpm snapshot` copies the master DB with `VACUUM INTO`, refuses a source whose schema version is not 5, aborts (leaving the previous snapshot untouched) if the source drifts mid-copy, and writes the `snapshot_meta` manifest only into the copy. `pnpm export:data` bakes the public API surface into static shards under `public/` (search index, directory payload, merchant detail JSON) — the deployable site never touches any database at runtime.

Schema v5 is unchanged by seller consolidation (v4/v5 added source locator metadata, link checks, and merchant briefs). The snapshot gate treats evidence/claim ownership mismatches, cross-seller duplicate roots, duplicate chains/cycles, self merchant links, foreign-key orphans, and stale analysis state as fatal.

## Interpretation boundary

Public output never exposes a numeric trust/reputation score, internal model state, identity-confidence percentage, reliability band, or raw model JSON. Positive-evidence ordering requires diverse independent sources and excludes adverse or official-warning evidence; users must inspect the linked original sources.
