# Bilingual Architecture — Exploration Findings & Design Decision

## Stage 1 findings (2026-09-09)

### Data flow (current)
```
master DB (SQLite, schema v4, 22MB)
  └─ snapshot-db.sh → webapp/data/merchants.db (snapshot, gitignored)
       └─ webapp/src/lib/db.ts (better-sqlite3, read-only)
            └─ app/merchant/[id]/page.tsx (server component, 8 sections)
                 └─ components: EvidenceCard, ClaimCards, CitedBrief,
                    SourceCitations, MerchantSummaryCard, ...
```

### Text inventory (census, 2026-09-09)
| Table.field | rows | script | user-facing? |
|---|---|---|---|
| evidence.summary | 3763 (394KB) | 3368 latin / 341 mixed / 54 arabic | YES (EvidenceCard p) |
| evidence.quoted_excerpt | ~2856 non-empty | 301/400 arabic (raw quotes) | YES ( EvidenceCard) — PRESERVE AS-IS (raw source quote) |
| claims.summary | 2644 (305KB) | 2349 latin / 265 mixed / 30 arabic | YES (ClaimCards) |
| merchant_briefs.payload_json | 334 (588KB) | text fields: 1465 arabic / 568 mixed | YES (CitedBrief) — already Arabic-authored |
| merchants.canonical_name | 351 | 114 arabic / 237 latin | YES |
| merchant_aliases.name | 1899 | mixed | YES (identity section) |
| sources.* | 2144 | URLs only | NO — language-neutral |
| merchant_identifiers.value | 3077 | phones/URLs/addresses | NO (mostly neutral) |
| merchant_links.rationale | 88 | ? | check |
| UI chrome (labels.ts, components) | — | Arabic hardcoded | YES — needs English mirror |

### Language metadata quality
evidence.language: 2856 empty, 754 'ar', 129 'en', mixed variants — UNRELIABLE.
Script census is authoritative (GLOB Arabic range vs [a-zA-Z]).

### Existing i18n infrastructure
NONE. `lang="ar" dir="rtl"` hardcoded in layout.tsx; UI strings hardcoded
Arabic in components + labels.ts. No locale context, no storage persistence.
→ Language switch is a NEW build, not a retrofit.

### Key insight — asymmetry
- UI chrome: currently Arabic-only → needs English mirror (small, static).
- Data (evidence/claims): mostly ENGLISH source → needs Arabic translation
  (the real workload: ~2700 unique latin-script evidence summaries, 2349 claims).
- Briefs: already Arabic → need English translation instead.
- Raw quotes (quoted_excerpt): NEVER translate — verbatim source evidence.
- Names/identifiers/URLs/numbers/dates: language-neutral.

## Stage 2 decision — translation tables (Option B)

Evaluated:
- (A) Duplicate DB per language: rejected — doubles sync burden, drift risk,
  breaks single-canonical-vendor-identity requirement.
- (B) **Translation tables keyed by (record_id, field, lang)**: CHOSEN.
  Original tables untouched (zero risk to English source); translations live
  in parallel tables; one row per (record, field, 'ar'|'en'); missing row =
  untranslated (detectable); trivially extensible to more languages;
  snapshot export joins translations by lang param.
- (C) Language-specific columns (summary_ar): rejected — schema churn per
  language, NULL-semantics muddy, pipeline schemas must change everywhere.
- (D) Localized JSON blobs: rejected — loses field-level validation,
  hard to detect partial translations.

### Schema (v5 migration, additive only)
```sql
CREATE TABLE translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,      -- 'evidence' | 'claims' | 'merchants' | 'merchant_briefs' | 'ui'
  record_id  TEXT NOT NULL,      -- source row PK (text form)
  field_name TEXT NOT NULL,      -- 'summary' | 'identity_message' | ...
  lang       TEXT NOT NULL,      -- 'ar' | 'en'
  content    TEXT NOT NULL,
  model      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(table_name, record_id, field_name, lang),
  CHECK (lang IN ('ar','en'))
);
CREATE INDEX idx_translations_record ON translations(table_name, record_id);
```

### Read path
`db.ts` gains a locale param (default 'ar'); lookups fall back to original
column when translation row missing (fallback = original text, marked).
Snapshot export emits both `content` (original) and `content_i18n` map or
separate joined view per lang — decided at implementation.

### UI
- Locale cookie `mi_lang` (server-readable; SSR-friendly) set by a small
  language toggle in SiteHeader; default 'ar' when absent.
- `lang`/`dir` on <html> become dynamic per cookie: 'ar'→rtl, 'en'→ltr.
- labels.ts gains English mirrors (LABELS[locale]).

### Raw-quotes rule
quoted_excerpt stays verbatim always (source evidence). Validation asserts
it is byte-identical across languages.

### Workload estimate
- evidence.summary latin/mixed: ~3709 rows, ~390KB → ~120K tokens source.
- claims.summary latin/mixed: ~2614 rows, ~300KB → ~90K tokens.
- briefs → English: 334 payloads, ~590KB → ~170K tokens.
- Per agent (4-way): ~100K tokens workload — safe in batches of ~30-50
  vendors per call; ownership stable per partition.
