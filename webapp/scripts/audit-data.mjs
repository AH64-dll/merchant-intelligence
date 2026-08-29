#!/usr/bin/env node
/**
 * audit-data.mjs — integrity + curation audit for Merchant Intelligence databases.
 *
 * Usage:
 *   node scripts/audit-data.mjs <db-path> [--json] [--strict] [--v2]
 *
 * Modes:
 *   (default)     Runs every fatal + warning check. Exits 1 on any fatal finding.
 *   --json        Emit the machine-readable report on stdout.
 *   --v2          Pre-v3 relaxation: an analysis payload without payload_version
 *                 is reported as a warning instead of a fatal finding.
 *   --strict      Snapshot/master gating mode: additionally fails (exit 1) when
 *                 schema_version is not the expected version (3, or 2 with --v2).
 *
 * This script NEVER writes to the database; it opens it read-only.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Controlled vocabularies (pipeline/merchant_intel/schemas.py)
// ---------------------------------------------------------------------------
const STATES = new Set([
  'VERIFIED_HIGH_CONFIDENCE',
  'VERIFIED_MODERATE_CONFIDENCE',
  'MIXED_REPUTATION',
  'INSUFFICIENT_DATA',
  'IDENTITY_UNCERTAIN',
  'HIGH_RISK_SIGNALS',
  'OFFICIAL_WARNING',
  'REQUIRES_MANUAL_REVIEW',
]);
const SENTIMENTS = new Set(['positive', 'negative', 'neutral']);
const BANDS = new Set(['weak', 'medium', 'strong', 'very_strong']);
const CLAIM_TYPES = new Set([
  'successful_purchase', 'product_quality', 'counterfeit_product_allegation',
  'non_delivery', 'delayed_delivery', 'refund_issue', 'warranty_issue',
  'after_sales_support', 'incorrect_product', 'pricing_issue', 'payment_dispute',
  'communication_issue', 'repeated_recommendation', 'official_warning',
  'verified_business_information', 'identity_mismatch', 'suspicious_page_changes',
  'account_page_disappearance', 'merchant_response', 'complaint_resolved',
  'complaint_unresolved', 'physical_presence', 'warranty_honored', 'refund_issued',
  'long_business_history', 'other',
]);
const AUTHOR_TYPES = new Set(['customer', 'merchant', 'journalist', 'regulator', 'registry', 'anonymous', 'unknown']);

const REQUIRED_TABLES = [
  'merchants', 'sources', 'evidence', 'claims', 'claim_evidence',
  'merchant_analyses', 'merchant_identifiers', 'merchant_aliases',
  'merchant_links', 'schema_version',
];
const REQUIRED_COLUMNS = {
  merchants: ['id', 'canonical_name', 'normalized_name', 'category', 'city', 'governorate', 'identity_confidence', 'state', 'created_at', 'updated_at'],
  sources: ['id', 'url', 'canonical_url', 'platform', 'source_type', 'first_seen_at', 'last_seen_at'],
  evidence: ['id', 'merchant_id', 'source_id', 'claim_id', 'claim_type', 'sentiment', 'summary', 'author_type', 'confidence', 'reliability_band', 'published_at', 'captured_at', 'independent', 'duplicate_of', 'verified'],
  claims: ['id', 'merchant_id', 'claim_type', 'sentiment', 'summary'],
  claim_evidence: ['claim_id', 'evidence_id'],
  merchant_analyses: ['id', 'merchant_id', 'round_no', 'payload_json', 'created_at'],
  merchant_identifiers: ['id', 'merchant_id', 'kind', 'value', 'normalized_value', 'confidence'],
  merchant_aliases: ['id', 'merchant_id', 'alias', 'normalized_alias'],
  merchant_links: ['id', 'left_merchant_id', 'right_merchant_id', 'relation', 'confidence'],
  schema_version: ['version'],
};
const UNSAFE_IDENTITY_LINK_RELATIONS = new Set(['identifier_collision', 'name_identifier_conflict']);
const IDENTIFIER_PHONE_KINDS = new Set(['phone', 'whatsapp']);
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/;
const LONG_FLOAT_RE = /0\.\d{10,}$/;
const MAX_SAMPLES = 15;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const asJson = flags.has('--json');
const v2Relaxed = flags.has('--v2');
const strict = flags.has('--strict');

if (positional.length !== 1) {
  process.stderr.write('Usage: node scripts/audit-data.mjs <db-path> [--json] [--strict] [--v2]\n');
  process.exit(2);
}
const dbPath = positional[0];
if (!fs.existsSync(dbPath)) {
  process.stderr.write(`audit-data: database not found: ${dbPath}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Report scaffolding
// ---------------------------------------------------------------------------
const fatal = [];
const warnings = [];
let fatalSeq = 0;
let warnSeq = 0;

function sample(list) {
  const shown = list.slice(0, MAX_SAMPLES).map((s) => String(s));
  const rest = list.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} … +${rest} more` : shown.join(', ');
}

function addFatal(check, detail, samples = []) {
  fatal.push({ id: `F${String(++fatalSeq).padStart(3, '0')}`, check, detail: samples.length ? `${detail}: ${sample(samples)}` : detail });
}
function addWarn(check, detail, samples = []) {
  warnings.push({ id: `W${String(++warnSeq).padStart(3, '0')}`, check, detail: samples.length ? `${detail}: ${sample(samples)}` : detail });
}

function hasTable(db, name) {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined;
}
function columnsOf(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((c) => c.name));
}
function tableCount(db, table) {
  if (!hasTable(db, table)) return null;
  return db.prepare(`SELECT count(*) AS n FROM ${JSON.stringify(table)}`).get().n;
}
function planJson(table) {
  return REQUIRED_COLUMNS[table].map((c) => `${JSON.stringify(table)}.${JSON.stringify(c)}`).join(', ');
}

// Strict Egyptian phone shape (contract: mobile 1[0125]xxxxxxxx or landline
// [2-9]xxxxxxxx after +20; never a fabricated +20).
function isStrictEgPhone(normalizedValue) {
  if (typeof normalizedValue !== 'string' || !normalizedValue.startsWith('+20')) return false;
  const body = normalizedValue.slice(3);
  return /^1[0125]\d{8}$/.test(body) || /^[2-9]\d{8}$/.test(body);
}
function urlScheme(url) {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(String(url ?? ''));
  return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Open read-only
// ---------------------------------------------------------------------------
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const report = { db: path.resolve(dbPath), generated_at: new Date().toISOString(), schema_version: null, tables: {}, distributions: {}, findings: { fatal, warnings }, summary: { fatal: 0, warnings: 0 } };

try {
  // -- required tables / columns -------------------------------------------
  const missingTables = REQUIRED_TABLES.filter((t) => !hasTable(db, t));
  if (missingTables.length) addFatal('missing_table', `required tables absent: ${missingTables.join(', ')}`);

  const columnProblems = [];
  for (const t of REQUIRED_TABLES.filter((t) => hasTable(db, t))) {
    const cols = columnsOf(db, t);
    const missing = REQUIRED_COLUMNS[t].filter((c) => !cols.has(c));
    if (missing.length) columnProblems.push(`${t}: ${missing.join(', ')}`);
  }
  if (columnProblems.length) addFatal('missing_column', 'required columns absent', columnProblems);

  // -- schema version ------------------------------------------------------
  if (hasTable(db, 'schema_version') && columnsOf(db, 'schema_version').has('version')) {
    const row = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get();
    report.schema_version = row ? row.version : null;
  }
  const expectedVersion = v2Relaxed ? 2 : 3;
  if (report.schema_version === null || report.schema_version === undefined) {
    if (strict) addFatal('schema_version', 'schema_version row missing');
    else addWarn('schema_version', 'schema_version row missing or empty');
  } else if (report.schema_version !== expectedVersion) {
    const detail = `schema_version is ${report.schema_version}, expected ${expectedVersion}${v2Relaxed ? ' (--v2)' : ''}`;
    if (strict) addFatal('schema_version', detail);
    else addWarn('schema_version', detail);
  }

  // -- table counts --------------------------------------------------------
  for (const t of [...REQUIRED_TABLES, 'snapshot_meta']) {
    const n = tableCount(db, t);
    if (n !== null) report.tables[t] = n;
  }

  // -- integrity check -----------------------------------------------------
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (integrity.integrity_check !== 'ok') addFatal('integrity_check', `integrity_check reported: ${integrity.integrity_check}`);

  const ok = (t) => hasTable(db, t) && REQUIRED_COLUMNS[t].every((c) => columnsOf(db, t).has(c));

  // -- FK orphans ----------------------------------------------------------
  if (ok('evidence')) {
    if (ok('merchants')) {
      const r = db.prepare(`SELECT group_concat(e.id) ids, count(*) n FROM evidence e LEFT JOIN merchants m ON m.id = e.merchant_id WHERE m.id IS NULL`).get();
      if (r.n) addFatal('fk_orphan', `${r.n} evidence rows reference missing merchants`, r.ids.split(','));
    }
    if (ok('sources')) {
      const r = db.prepare(`SELECT group_concat(e.id) ids, count(*) n FROM evidence e LEFT JOIN sources s ON s.id = e.source_id WHERE s.id IS NULL`).get();
      if (r.n) addFatal('fk_orphan', `${r.n} evidence rows reference missing sources`, r.ids.split(','));
    }
    if (ok('claims')) {
      const r = db.prepare(`SELECT group_concat(e.id) ids, count(*) n FROM evidence e LEFT JOIN claims c ON c.id = e.claim_id WHERE e.claim_id IS NOT NULL AND c.id IS NULL`).get();
      if (r.n) addFatal('fk_orphan', `${r.n} evidence rows reference missing claims`, r.ids.split(','));
    }
  }
  if (ok('claims') && ok('merchants')) {
    const r = db.prepare(`SELECT group_concat(c.id) ids, count(*) n FROM claims c LEFT JOIN merchants m ON m.id = c.merchant_id WHERE m.id IS NULL`).get();
    if (r.n) addFatal('fk_orphan', `${r.n} claims reference missing merchants`, r.ids.split(','));
  }
  if (ok('merchant_identifiers') && ok('merchants')) {
    const r = db.prepare(`SELECT group_concat(i.id) ids, count(*) n FROM merchant_identifiers i LEFT JOIN merchants m ON m.id = i.merchant_id WHERE m.id IS NULL`).get();
    if (r.n) addFatal('fk_orphan', `${r.n} identifiers reference missing merchants`, r.ids.split(','));
  }
  if (ok('merchant_aliases') && ok('merchants')) {
    const r = db.prepare(`SELECT group_concat(a.id) ids, count(*) n FROM merchant_aliases a LEFT JOIN merchants m ON m.id = a.merchant_id WHERE m.id IS NULL`).get();
    if (r.n) addFatal('fk_orphan', `${r.n} aliases reference missing merchants`, r.ids.split(','));
  }
  if (ok('merchant_links') && ok('merchants')) {
    const l = db.prepare(`SELECT group_concat(l.id) ids, count(*) n FROM merchant_links l LEFT JOIN merchants m ON m.id = l.left_merchant_id WHERE m.id IS NULL`).get();
    if (l.n) addFatal('fk_orphan', `${l.n} links reference missing left merchants`, l.ids.split(','));
    const r = db.prepare(`SELECT group_concat(l.id) ids, count(*) n FROM merchant_links l LEFT JOIN merchants m ON m.id = l.right_merchant_id WHERE m.id IS NULL`).get();
    if (r.n) addFatal('fk_orphan', `${r.n} links reference missing right merchants`, r.ids.split(','));
  }
  if (ok('claim_evidence') && ok('claims') && ok('evidence')) {
    const c = db.prepare(`SELECT group_concat(ce.claim_id || '/' || ce.evidence_id) ids, count(*) n FROM claim_evidence ce LEFT JOIN claims c ON c.id = ce.claim_id WHERE c.id IS NULL`).get();
    if (c.n) addFatal('fk_orphan', `${c.n} claim_evidence rows reference missing claims`, c.ids.split(','));
    const e = db.prepare(`SELECT group_concat(ce.claim_id || '/' || ce.evidence_id) ids, count(*) n FROM claim_evidence ce LEFT JOIN evidence e ON e.id = ce.evidence_id WHERE e.id IS NULL`).get();
    if (e.n) addFatal('fk_orphan', `${e.n} claim_evidence rows reference missing evidence`, e.ids.split(','));
  }

  // -- duplicate chains ----------------------------------------------------
  if (ok('evidence')) {
    const dupRows = db.prepare('SELECT id, merchant_id, duplicate_of FROM evidence WHERE duplicate_of IS NOT NULL').all();
    const dupIds = new Set(dupRows.map((r) => r.id));
    const merchantOf = new Map(db.prepare('SELECT id, merchant_id FROM evidence').all().map((r) => [r.id, r.merchant_id]));
    const parent = new Map(dupRows.map((r) => [r.id, r.duplicate_of]));

    const cycleIds = [];
    const missingParentIds = [];
    const nonRootIds = [];
    const crossMerchantRootIds = [];
    for (const row of dupRows) {
      const seen = new Set([row.id]);
      let cur = row.duplicate_of;
      if (!parent.has(cur) && !merchantOf.has(cur)) { missingParentIds.push(row.id); continue; }
      let okChain = true;
      while (parent.has(cur)) {
        if (seen.has(cur)) { cycleIds.push(row.id); okChain = false; break; }
        seen.add(cur);
        cur = parent.get(cur);
      }
      if (!okChain) continue;
      if (dupIds.has(cur)) nonRootIds.push(row.id);
      if (merchantOf.get(cur) !== row.merchant_id) crossMerchantRootIds.push(`${row.id}→${cur}`);
    }
    if (missingParentIds.length) addFatal('duplicate_missing_parent', `${missingParentIds.length} evidence rows have a duplicate_of pointing at a missing evidence id`, missingParentIds);
    if (cycleIds.length) addFatal('duplicate_cycle', `${cycleIds.length} evidence rows sit on a duplicate_of cycle`, cycleIds);
    if (nonRootIds.length) addFatal('duplicate_non_root', `${nonRootIds.length} same-merchant duplicate rows point at another duplicate instead of the chain root`, nonRootIds);
    if (crossMerchantRootIds.length) addWarn('cross_merchant_duplicate_root', `${crossMerchantRootIds.length} duplicate rows resolve to a root owned by a different merchant (curation required)`, crossMerchantRootIds);

    // -- unknown enum values ----------------------------------------------
    const badStates = db.prepare(`SELECT id, state FROM merchants WHERE state NOT IN (${[...STATES].map(() => '?').join(',')})`).all(...STATES);
    if (badStates.length) addFatal('unknown_state', `${badStates.length} merchants carry an unknown state`, badStates.map((r) => `${r.id}:${r.state}`));
    const badBand = db.prepare(`SELECT id, reliability_band FROM evidence WHERE reliability_band NOT IN (${[...BANDS].map(() => '?').join(',')})`).all(...BANDS);
    if (badBand.length) addFatal('unknown_reliability_band', `${badBand.length} evidence rows carry an unknown reliability_band`, badBand.map((r) => `${r.id}:${r.reliability_band}`));
    const badSentiment = db.prepare(`SELECT id, sentiment FROM evidence WHERE sentiment NOT IN (${[...SENTIMENTS].map(() => '?').join(',')})`).all(...SENTIMENTS);
    if (badSentiment.length) addFatal('unknown_sentiment', `${badSentiment.length} evidence rows carry an unknown sentiment`, badSentiment.map((r) => `${r.id}:${r.sentiment}`));
    if (ok('claims')) {
      const badClaimSentiment = db.prepare(`SELECT id, sentiment FROM claims WHERE sentiment NOT IN (${[...SENTIMENTS].map(() => '?').join(',')})`).all(...SENTIMENTS);
      if (badClaimSentiment.length) addFatal('unknown_sentiment', `${badClaimSentiment.length} claims carry an unknown sentiment`, badClaimSentiment.map((r) => `${r.id}:${r.sentiment}`));
    }

    // -- blank required fields --------------------------------------------
    const blankMerchants = db.prepare(`SELECT id FROM merchants WHERE trim(canonical_name) = '' OR trim(normalized_name) = ''`).all();
    if (blankMerchants.length) addFatal('blank_identity_field', `${blankMerchants.length} merchants have a blank canonical_name/normalized_name`, blankMerchants.map((r) => r.id));
    const blankSources = db.prepare(`SELECT id FROM sources WHERE trim(url) = '' OR trim(canonical_url) = '' OR trim(source_type) = ''`).all();
    if (blankSources.length) addFatal('blank_source_field', `${blankSources.length} sources have a blank url/canonical_url/source_type`, blankSources.map((r) => String(r.id)));

    // -- confidence range --------------------------------------------------
    const outOfRange = db.prepare(`SELECT id, confidence FROM evidence WHERE confidence < 0 OR confidence > 1 OR confidence IS NULL`).all()
      .concat(ok('merchants') ? db.prepare(`SELECT id, identity_confidence AS confidence FROM merchants WHERE identity_confidence < 0 OR identity_confidence > 1`).all() : [])
      .concat(ok('merchant_identifiers') ? db.prepare(`SELECT id, confidence FROM merchant_identifiers WHERE confidence < 0 OR confidence > 1`).all() : [])
      .concat(ok('merchant_links') ? db.prepare(`SELECT id, confidence FROM merchant_links WHERE confidence < 0 OR confidence > 1`).all() : []);
    if (outOfRange.length) addFatal('confidence_range', `${outOfRange.length} confidence values fall outside [0,1]`, outOfRange.map((r) => `${r.id}:${r.confidence}`));

    // -- author type / claim type vocab (warning-level) --------------------
    const badAuthor = db.prepare(`SELECT DISTINCT author_type FROM evidence WHERE author_type NOT IN (${[...AUTHOR_TYPES].map(() => '?').join(',')})`).all(...AUTHOR_TYPES);
    if (badAuthor.length) addWarn('unknown_author_type', `${badAuthor.length} unknown author_type values in evidence`, badAuthor.map((r) => r.author_type));
    const unknownClaimTypes = db.prepare('SELECT claim_type, count(*) n FROM evidence GROUP BY claim_type').all().filter((r) => !CLAIM_TYPES.has(r.claim_type));
    if (unknownClaimTypes.length) addWarn('unknown_claim_type', `${unknownClaimTypes.length} free-form evidence claim_type values`, unknownClaimTypes.map((r) => `${r.claim_type}×${r.n}`));
  }

  // -- analysis payloads + state consistency -------------------------------
  if (ok('merchant_analyses')) {
    const analyses = db.prepare(`SELECT id, merchant_id, round_no, payload_json, created_at FROM merchant_analyses ORDER BY merchant_id, round_no DESC, id DESC`).all();
    const latestByMerchant = new Map();
    for (const a of analyses) if (!latestByMerchant.has(a.merchant_id)) latestByMerchant.set(a.merchant_id, a);

    const unversioned = [];
    const badVersion = [];
    const badJson = [];
    const stateMismatch = [];
    const floatArtifacts = [];
    for (const a of analyses) {
      let payload;
      try {
        payload = JSON.parse(a.payload_json);
      } catch {
        badJson.push(a.id);
        continue;
      }
      const v = payload.payload_version;
      if (v === undefined || v === null) {
        if (v2Relaxed) unversioned.push(a.id);
        else badVersion.push(a.id);
      } else if (!Number.isInteger(v) || v !== 1) {
        badVersion.push(a.id);
      }
      for (const key of ['identity_confidence', 'evidence_confidence']) {
        const val = payload[key];
        if (typeof val === 'number' && LONG_FLOAT_RE.test(String(val))) floatArtifacts.push(`${a.id}:${key}=${val}`);
      }
      if (latestByMerchant.get(a.merchant_id) === a && ok('merchants')) {
        const m = db.prepare('SELECT id, state FROM merchants WHERE id = ?').get(a.merchant_id);
        if (m && m.state !== payload.internal_state) stateMismatch.push(`${m.id}: state=${m.state} != latest analysis internal_state=${payload.internal_state}`);
      }
    }
    if (badJson.length) addFatal('payload_version', `${badJson.length} analysis payloads are not valid JSON`, badJson);
    if (badVersion.length) addFatal('payload_version', `${badVersion.length} analysis payloads lack payload_version=1 (integer)`, badVersion);
    if (unversioned.length) addWarn('payload_version_v2_relaxed', `--v2: ${unversioned.length} analysis payloads lack payload_version (pre-v3 tolerated)`, unversioned);
    if (stateMismatch.length) addFatal('state_analysis_mismatch', `${stateMismatch.length} merchants disagree with their latest analysis internal_state`, stateMismatch);
    if (floatArtifacts.length) addWarn('float_artifact', `${floatArtifacts.length} analysis confidence values carry floating-point representation artifacts`, floatArtifacts);

    // -- non-INSUFFICIENT_DATA state without any analysis -------------------
    if (ok('merchants')) {
      const noAnalysis = db.prepare(`SELECT id, state FROM merchants WHERE state != 'INSUFFICIENT_DATA' AND id NOT IN (SELECT DISTINCT merchant_id FROM merchant_analyses)`).all();
      if (noAnalysis.length) addFatal('state_without_analysis', `${noAnalysis.length} merchants hold a non-INSUFFICIENT_DATA state with no analysis at all`, noAnalysis.map((r) => `${r.id}:${r.state}`));
    }
  } else if (ok('merchants')) {
    const noAnalysis = db.prepare(`SELECT id, state FROM merchants WHERE state != 'INSUFFICIENT_DATA'`).all();
    if (noAnalysis.length) addFatal('state_without_analysis', `${noAnalysis.length} merchants hold a non-INSUFFICIENT_DATA state and merchant_analyses is missing`, noAnalysis.map((r) => `${r.id}:${r.state}`));
  }

  // -- identifiers ---------------------------------------------------------
  if (ok('merchant_identifiers')) {
    const malformed = db.prepare(`SELECT id, merchant_id, kind, normalized_value FROM merchant_identifiers WHERE kind IN ('phone','whatsapp')`).all()
      .filter((r) => !isStrictEgPhone(r.normalized_value));
    if (malformed.length) addWarn('malformed_identifier', `${malformed.length} phone/whatsapp identifiers fail the strict Egyptian phone shape (quarantined in the app, preserved here)`, malformed.map((r) => `${r.id}:${r.kind}:${r.normalized_value}`));

    const shared = db.prepare(`SELECT kind, normalized_value, count(DISTINCT merchant_id) n, group_concat(DISTINCT merchant_id) owners FROM merchant_identifiers GROUP BY kind, normalized_value HAVING n > 1 ORDER BY n DESC`).all();
    if (shared.length) addWarn('shared_identifier', `${shared.length} identifier values are owned by more than one merchant (many-owner model)`, shared.map((r) => `${r.kind}:${r.normalized_value} → ${r.owners}`));
  }

  // -- source URL schemes --------------------------------------------------
  if (ok('sources')) {
    const badScheme = db.prepare('SELECT id, url FROM sources').all()
      .filter((r) => { const s = urlScheme(r.url); return s === null || !['http', 'https', 'whois'].includes(s); });
    if (badScheme.length) addWarn('unsupported_source_scheme', `${badScheme.length} sources use a scheme outside http/https/whois`, badScheme.map((r) => `${r.id}:${r.url.slice(0, 60)}`));
  }

  // -- unresolved identity links ------------------------------------------
  if (ok('merchant_links')) {
    const unresolved = db.prepare(`SELECT id, left_merchant_id, right_merchant_id, relation, rationale FROM merchant_links WHERE relation IN (${[...UNSAFE_IDENTITY_LINK_RELATIONS].map(() => '?').join(',')})`).all(...UNSAFE_IDENTITY_LINK_RELATIONS);
    if (unresolved.length) addWarn('unresolved_identity_link', `${unresolved.length} unresolved identity links (identifier_collision / name_identifier_conflict) pending curation`, unresolved.map((r) => `${r.id}:${r.left_merchant_id}~${r.right_merchant_id}`));
  }

  // -- candidate duplicate/branch groups (curation) ------------------------
  if (ok('merchants')) {
    const nameGroups = db.prepare(`SELECT normalized_name, group_concat(id) ids, count(*) n FROM merchants GROUP BY normalized_name HAVING n > 1 ORDER BY n DESC`).all();
    if (nameGroups.length) addWarn('name_candidate_group', `${nameGroups.length} normalized_name groups span multiple merchants (possible branches — do not auto-merge)`, nameGroups.map((r) => `${r.normalized_name} → ${r.ids}`));
  }
  if (ok('merchant_aliases')) {
    const aliasGroups = db.prepare(`SELECT normalized_alias, count(DISTINCT merchant_id) n, group_concat(DISTINCT merchant_id) owners FROM merchant_aliases GROUP BY normalized_alias HAVING n > 1 ORDER BY n DESC`).all();
    if (aliasGroups.length) addWarn('alias_candidate_group', `${aliasGroups.length} normalized aliases are shared across merchants`, aliasGroups.map((r) => `${r.normalized_alias} → ${r.owners}`));
  }

  // -- timestamp format ----------------------------------------------------
  if (ok('evidence')) {
    const rows = db.prepare('SELECT id, published_at, captured_at FROM evidence').all();
    const badCaptured = rows.filter((r) => !ISO_UTC_RE.test(r.captured_at ?? '')).map((r) => r.id);
    const badPublished = rows.filter((r) => r.published_at !== null && !ISO_UTC_RE.test(r.published_at)).map((r) => r.id);
    if (badCaptured.length) addWarn('timestamp_format', `${badCaptured.length} evidence.captured_at values are not explicit-UTC ISO-8601`, badCaptured);
    if (badPublished.length) addWarn('timestamp_format', `${badPublished.length} evidence.published_at values are not explicit-UTC ISO-8601`, badPublished);
  }

  // -- float artifacts on merchants ----------------------------------------
  if (ok('merchants')) {
    const arts = db.prepare('SELECT id, identity_confidence FROM merchants').all()
      .filter((r) => LONG_FLOAT_RE.test(String(r.identity_confidence)))
      .map((r) => `${r.id}:${r.identity_confidence}`);
    if (arts.length) addWarn('float_artifact', `${arts.length} merchant identity_confidence values carry floating-point representation artifacts`, arts);
  }

  // -- publication-date coverage -------------------------------------------
  if (ok('evidence') && ok('merchants')) {
    const coverage = db.prepare(`SELECT
      count(*) AS total,
      sum(CASE WHEN published_at IS NULL THEN 1 ELSE 0 END) AS missing_published,
      min(published_at) AS min_published,
      max(published_at) AS max_published,
      count(DISTINCT CASE WHEN published_at IS NULL THEN merchant_id END) AS merchants_without_dated
      FROM evidence`).get();
    report.distributions.publication_date_coverage = {
      total: coverage.total,
      missing_published_at: coverage.missing_published ?? 0,
      earliest_published_at: coverage.min_published,
      latest_published_at: coverage.max_published,
      merchants_without_dated_evidence: coverage.merchants_without_dated ?? 0,
    };
    if (coverage.missing_published) addWarn('missing_published_at', `${coverage.missing_published} of ${coverage.total} evidence rows have no published_at (capture date is always present)`);
  }

  // -- distributions -------------------------------------------------------
  if (ok('merchants')) {
    report.distributions.state = db.prepare('SELECT state AS value, count(*) AS count FROM merchants GROUP BY state ORDER BY count DESC').all();
    const catRows = db.prepare('SELECT category AS value, count(*) AS count FROM merchants GROUP BY category ORDER BY count DESC').all();
    report.distributions.category = { distinct: catRows.length, top: catRows.slice(0, 10) };
    report.distributions.governorate = db.prepare('SELECT governorate AS value, count(*) AS count FROM merchants WHERE governorate != \'\' GROUP BY governorate ORDER BY count DESC').all();
  }
  if (ok('sources')) {
    const stRows = db.prepare('SELECT source_type AS value, count(*) AS count FROM sources GROUP BY source_type ORDER BY count DESC').all();
    report.distributions.source_type = { distinct: stRows.length, unknown: stRows.filter((r) => r.value === 'unknown').reduce((a, r) => a + r.count, 0), top: stRows.slice(0, 10) };
    if (stRows.length > 1) addWarn('free_form_source_type', `sources use ${stRows.length} distinct free-form source_type values (${report.distributions.source_type.unknown} 'unknown')`, stRows.slice(0, 8).map((r) => `${r.value}×${r.count}`));
  }
  if (ok('evidence')) {
    const ct = db.prepare('SELECT claim_type AS value, count(*) AS count FROM evidence GROUP BY claim_type ORDER BY count DESC').all();
    report.distributions.claim_type = { distinct: ct.length, top: ct.slice(0, 10) };
    report.distributions.confidence_bands = {
      '0_0.25': db.prepare('SELECT count(*) n FROM evidence WHERE confidence >= 0 AND confidence < 0.25').get().n,
      '0.25_0.5': db.prepare('SELECT count(*) n FROM evidence WHERE confidence >= 0.25 AND confidence < 0.5').get().n,
      '0.5_0.75': db.prepare('SELECT count(*) n FROM evidence WHERE confidence >= 0.5 AND confidence < 0.75').get().n,
      '0.75_1': db.prepare('SELECT count(*) n FROM evidence WHERE confidence >= 0.75 AND confidence <= 1').get().n,
    };
    report.distributions.evidence_sentiment = db.prepare('SELECT sentiment AS value, count(*) AS count FROM evidence GROUP BY sentiment ORDER BY count DESC').all();
    report.distributions.verified = { verified_1: db.prepare('SELECT count(*) n FROM evidence WHERE verified = 1').get().n, verified_0: db.prepare('SELECT count(*) n FROM evidence WHERE verified = 0').get().n };

    // -- verified=0 with high confidence -----------------------------------
    const highUnverified = db.prepare(`SELECT id, merchant_id, confidence FROM evidence WHERE verified = 0 AND confidence >= 0.7 AND duplicate_of IS NULL`).all();
    if (highUnverified.length) addWarn('high_confidence_unverified', `${highUnverified.length} non-duplicate evidence rows carry confidence >= 0.7 without an automated verification round (valid under the stored contract)`, highUnverified.map((r) => `${r.id}:${r.confidence}`));
  }

  // -- snapshot metadata ----------------------------------------------------
  if (hasTable(db, 'snapshot_meta')) {
    try {
      report.snapshot_meta = db.prepare('SELECT * FROM snapshot_meta').get() ?? null;
    } catch (e) {
      addWarn('snapshot_meta', `snapshot_meta exists but could not be read: ${e.message}`);
    }
  }
} finally {
  db.close();
}

report.summary.fatal = fatal.length;
report.summary.warnings = warnings.length;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
let exitCode = 0;
if (fatal.length > 0) exitCode = 1;

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const out = [];
  out.push(`audit-data: ${report.db}`);
  out.push(`generated_at: ${report.generated_at}   schema_version: ${report.schema_version ?? '—'}`);
  out.push('');
  out.push('Table counts');
  for (const [t, n] of Object.entries(report.tables)) out.push(`  ${t.padEnd(22)} ${n}`);
  out.push('');
  out.push('Distributions');
  const d = report.distributions;
  if (d.state) out.push(`  state: ${d.state.map((r) => `${r.value}=${r.count}`).join(', ')}`);
  if (d.category) out.push(`  category: ${d.category.distinct} distinct; top: ${d.category.top.map((r) => `${r.value}×${r.count}`).join(', ')}`);
  if (d.governorate?.length) out.push(`  governorate: ${d.governorate.length} distinct non-empty; top: ${d.governorate.slice(0, 6).map((r) => `${r.value || '∅'}×${r.count}`).join(', ')}`);
  if (d.source_type) out.push(`  source_type: ${d.source_type.distinct} distinct (${d.source_type.unknown} 'unknown'); top: ${d.source_type.top.map((r) => `${r.value}×${r.count}`).join(', ')}`);
  if (d.claim_type) out.push(`  claim_type: ${d.claim_type.distinct} distinct; top: ${d.claim_type.top.map((r) => `${r.value}×${r.count}`).join(', ')}`);
  if (d.confidence_bands) out.push(`  confidence bands: ${Object.entries(d.confidence_bands).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (d.publication_date_coverage) out.push(`  published_at: ${d.publication_date_coverage.missing_published_at}/${d.publication_date_coverage.total} missing; range ${d.publication_date_coverage.earliest_published_at ?? '—'} … ${d.publication_date_coverage.latest_published_at ?? '—'}; ${d.publication_date_coverage.merchants_without_dated_evidence} merchants without dated evidence`);
  if (report.snapshot_meta) out.push(`  snapshot_meta: app=${report.snapshot_meta.app_schema_version} src=${report.snapshot_meta.source_schema_version} generated_at=${report.snapshot_meta.generated_at}`);
  out.push('');
  out.push(`FATAL (${fatal.length})`);
  for (const f of fatal) out.push(`  [${f.id}] ${f.check}: ${f.detail}`);
  out.push(`WARNINGS (${warnings.length})`);
  for (const w of warnings) out.push(`  [${w.id}] ${w.check}: ${w.detail}`);
  out.push('');
  out.push(`summary: ${fatal.length} fatal, ${warnings.length} warnings → exit ${exitCode}`);
  process.stdout.write(`${out.join('\n')}\n`);
}

process.exit(exitCode);
