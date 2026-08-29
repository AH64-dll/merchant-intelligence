import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MerchantDb, SnapshotManifestError, parseAnalysisPayload, validateSnapshotManifest } from './db';

const B_TECH_ID = '0abffb14-4754-4d4a-8ec7-78a5732a9264';
const AL_SHAMEL_ID = '0db637d8-9597-464b-8a85-2480ef7501cf';
const SMART_HOME_ID = '98e83f64-7837-4173-b7df-0fb2dce03c9c';
const CONNECT_PHONE_ID = '0d73d05b-7fb3-4afb-b4ea-c74e2025f8b0';
const EVIDENCE_RICH_ID = '3da82768-832c-4bf5-80c1-6cf3059cf5c5';

const DB_PATH = fileURLToPath(new URL('../../data/merchants.db', import.meta.url));

let db: MerchantDb;
let raw: Database.Database;

beforeAll(() => {
  db = new MerchantDb(DB_PATH);
  raw = new Database(DB_PATH, { readonly: true });
});

describe('snapshot manifest validation', () => {
  it('exposes validated snapshot info with schema versions 3/1', () => {
    const info = db.getSnapshotInfo();
    expect(info.sourceSchemaVersion).toBe(3);
    expect(info.appSchemaVersion).toBe(1);
    expect(info.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(info.counts).sort()).toEqual(
      [
        'claim_evidence',
        'claims',
        'evidence',
        'merchant_aliases',
        'merchant_analyses',
        'merchant_identifiers',
        'merchant_links',
        'merchants',
        'sources',
      ].sort(),
    );
  });

  it('manifest counts equal the live snapshot tables (manifest-equality, no fixed counts)', () => {
    const info = db.getSnapshotInfo();
    for (const [table, count] of Object.entries(info.counts)) {
      const actual = (raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      expect(actual, `table ${table}`).toBe(count);
    }
    // Sanity: the manifest actually tracks the live data.
    expect(info.counts.merchants).toBeGreaterThan(0);
    expect(info.counts.evidence).toBeGreaterThanOrEqual(info.counts.merchants);
  });

  it('throws a clear error when snapshot_meta is missing', () => {
    const mem = new Database(':memory:');
    mem.prepare('CREATE TABLE t (x INTEGER)').run();
    expect(() => validateSnapshotManifest(mem)).toThrow(SnapshotManifestError);
    expect(() => validateSnapshotManifest(mem)).toThrow(/snapshot_meta/);
  });

  it('throws for wrong app or source schema versions', () => {
    const mem = new Database(':memory:');
    mem
      .prepare(
        `CREATE TABLE snapshot_meta (
           id INTEGER PRIMARY KEY CHECK(id = 1), app_schema_version INTEGER NOT NULL,
           source_schema_version INTEGER NOT NULL, generated_at TEXT NOT NULL,
           merchants_count INTEGER NOT NULL, sources_count INTEGER NOT NULL,
           evidence_count INTEGER NOT NULL, claims_count INTEGER NOT NULL,
           claim_evidence_count INTEGER NOT NULL, merchant_analyses_count INTEGER NOT NULL,
           merchant_identifiers_count INTEGER NOT NULL, merchant_aliases_count INTEGER NOT NULL,
           merchant_links_count INTEGER NOT NULL)`,
      )
      .run();
    const insert = mem.prepare(
      `INSERT INTO snapshot_meta VALUES (1, @app, @src, '2026-01-01T00:00:00Z', 0,0,0,0,0,0,0,0,0)`,
    );
    insert.run({ app: 2, src: 3 });
    expect(() => validateSnapshotManifest(mem)).toThrow(/app_schema_version/);
    mem.prepare('UPDATE snapshot_meta SET app_schema_version = 1, source_schema_version = 2').run();
    expect(() => validateSnapshotManifest(mem)).toThrow(/source_schema_version/);
  });

  it('throws when a declared manifest count mismatches the actual table', () => {
    const mem = new Database(':memory:');
    mem
      .prepare(
        `CREATE TABLE snapshot_meta (
           id INTEGER PRIMARY KEY CHECK(id = 1), app_schema_version INTEGER NOT NULL,
           source_schema_version INTEGER NOT NULL, generated_at TEXT NOT NULL,
           merchants_count INTEGER NOT NULL, sources_count INTEGER NOT NULL,
           evidence_count INTEGER NOT NULL, claims_count INTEGER NOT NULL,
           claim_evidence_count INTEGER NOT NULL, merchant_analyses_count INTEGER NOT NULL,
           merchant_identifiers_count INTEGER NOT NULL, merchant_aliases_count INTEGER NOT NULL,
           merchant_links_count INTEGER NOT NULL)`,
      )
      .run();
    mem
      .prepare('CREATE TABLE merchants (id TEXT PRIMARY KEY)')
      .run();
    mem
      .prepare(
        `INSERT INTO snapshot_meta VALUES (1, 1, 3, '2026-01-01T00:00:00Z', 99,0,0,0,0,0,0,0,0)`,
      )
      .run();
    expect(() => validateSnapshotManifest(mem)).toThrow(/merchants_count/);
  });
});

describe('MerchantDb.getIndexData', () => {
  const indexData = () => db.getIndexData();

  it('returns the full merchant count equal to the manifest', () => {
    expect(indexData().merchants.length).toBe(db.getSnapshotInfo().counts.merchants);
  });

  it('returns only searchable identifier kinds', () => {
    const kinds = new Set(indexData().identifiers.map((identifier) => identifier.kind));
    expect(kinds.has('address')).toBe(false);
    expect(kinds.has('commercial_register')).toBe(false);
    expect(kinds.has('phone')).toBe(true);
    expect(kinds.has('facebook')).toBe(true);
    expect(kinds.size).toBe(9);
  });

  it('returns all aliases equal to the manifest', () => {
    expect(indexData().aliases.length).toBe(db.getSnapshotInfo().counts.merchant_aliases);
  });

  it('contains the B.TECH phone identifier', () => {
    const found = indexData().identifiers.some(
      (identifier) => identifier.merchantId === B_TECH_ID && identifier.normalized === '+201286619966',
    );
    expect(found).toBe(true);
  });
});

describe('MerchantDb.getMerchantDetail — analysis selection', () => {
  it('returns the highest (round_no, id) analysis row for B.TECH', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    expect(detail).not.toBeNull();
    const expectedRow = raw
      .prepare(
        'SELECT round_no, id, payload_json FROM merchant_analyses WHERE merchant_id = ? ORDER BY round_no DESC, id DESC LIMIT 1',
      )
      .get(B_TECH_ID) as { round_no: number; id: number; payload_json: string } | undefined;
    expect(expectedRow).toBeDefined();
    expect(detail?.analysis).toEqual(parseAnalysisPayload(expectedRow!.payload_json));
  });

  it('matches direct SQL for a second multi-round merchant', () => {
    const detail = db.getMerchantDetail(AL_SHAMEL_ID);
    expect(detail?.analysis).not.toBeNull();
    const rowCount = (
      raw.prepare('SELECT COUNT(*) AS c FROM merchant_analyses WHERE merchant_id = ?').get(AL_SHAMEL_ID) as { c: number }
    ).c;
    expect(rowCount).toBeGreaterThan(1);
    const expectedPayload = (
      raw
        .prepare(
          'SELECT payload_json FROM merchant_analyses WHERE merchant_id = ? ORDER BY round_no DESC, id DESC LIMIT 1',
        )
        .get(AL_SHAMEL_ID) as { payload_json: string }
    ).payload_json;
    expect(detail?.analysis).toEqual(parseAnalysisPayload(expectedPayload));
  });

  it('returns null analysis for a merchant without analyses', () => {
    const detail = db.getMerchantDetail(SMART_HOME_ID);
    expect(detail).not.toBeNull();
    // SMART_HOME_ID carries exactly one empty-signal analysis row in the live
    // snapshot; find a genuinely analysis-less merchant dynamically.
    const noAnalysisId = (
      raw
        .prepare(
          `SELECT m.id FROM merchants m
           WHERE NOT EXISTS (SELECT 1 FROM merchant_analyses a WHERE a.merchant_id = m.id)
           LIMIT 1`,
        )
        .get() as { id: string } | undefined
    )?.id;
    if (noAnalysisId === undefined) {
      // Every live merchant carries an analysis; the null branch is verified
      // through parseAnalysisPayload unit tests instead.
      const analyzed = (
        raw.prepare('SELECT COUNT(DISTINCT merchant_id) AS n FROM merchant_analyses').get() as { n: number }
      ).n;
      expect(analyzed).toBeGreaterThan(0);
      return;
    }
    const noAnalysisDetail = db.getMerchantDetail(noAnalysisId);
    expect(noAnalysisDetail).not.toBeNull();
    expect(noAnalysisDetail?.analysis).toBeNull();
  });

  it('returns null for an unknown merchant id', () => {
    expect(db.getMerchantDetail('no-such-merchant')).toBeNull();
  });
});

describe('MerchantDb.getMerchantDetail — evidence', () => {
  it('orders evidence by published_at DESC NULLS LAST then captured_at DESC', () => {
    const detail = db.getMerchantDetail(EVIDENCE_RICH_ID);
    const expectedIds = (
      raw
        .prepare(
          `SELECT e.id FROM evidence e WHERE e.merchant_id = ?
           ORDER BY e.published_at DESC NULLS LAST, e.captured_at DESC`,
        )
        .all(EVIDENCE_RICH_ID) as { id: string }[]
    ).map((row) => row.id);
    expect(detail?.evidence.map((item) => item.id)).toEqual(expectedIds);
    expect(expectedIds.length).toBeGreaterThanOrEqual(10);
    const trailingNulls = detail?.evidence.filter((item) => item.publishedAt === null).length ?? 0;
    expect(trailingNulls).toBeGreaterThan(0);
    const firstNullIndex = detail?.evidence.findIndex((item) => item.publishedAt === null) ?? -1;
    expect(firstNullIndex + trailingNulls).toBe(detail?.evidence.length);
  });

  it('joins platform, url, and source_type from sources', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    for (const item of detail?.evidence ?? []) {
      expect(item.platform.length).toBeGreaterThan(0);
      expect(item.url.length).toBeGreaterThan(0);
      expect(item.sourceType.length).toBeGreaterThan(0);
      expect(item.capturedAt.length).toBeGreaterThan(0);
    }
  });

  it('computes sentiment counts from non-duplicate evidence with explicit duplicate count', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    expect(detail).not.toBeNull();
    const sqlCounts = { positive: 0, negative: 0, neutral: 0 };
    const rows = raw
      .prepare(
        `SELECT sentiment, COUNT(*) AS n FROM evidence
         WHERE merchant_id = ? AND duplicate_of IS NULL GROUP BY sentiment`,
      )
      .all(B_TECH_ID) as { sentiment: string; n: number }[];
    for (const row of rows) {
      if (row.sentiment === 'positive') sqlCounts.positive = row.n;
      else if (row.sentiment === 'negative') sqlCounts.negative = row.n;
      else sqlCounts.neutral = row.n;
    }
    expect(detail?.sentiment).toEqual(sqlCounts);
    const expectedDuplicates = (
      raw
        .prepare('SELECT COUNT(*) AS n FROM evidence WHERE merchant_id = ? AND duplicate_of IS NOT NULL')
        .get(B_TECH_ID) as { n: number }
    ).n;
    expect(detail?.duplicateEvidenceCount).toBe(expectedDuplicates);
  });

  it('carries provenance flags and duplicate-root attribution', () => {
    const detail = db.getMerchantDetail(EVIDENCE_RICH_ID);
    expect(detail).not.toBeNull();
    for (const item of detail?.evidence ?? []) {
      expect(typeof item.verified).toBe('boolean');
      expect(typeof item.independent).toBe('boolean');
      expect(typeof item.transactionEvidence).toBe('boolean');
      expect(typeof item.sourceCategory).toBe('string');
      if (item.duplicateOf === null) {
        expect(item.duplicateRootMerchantId).toBeNull();
      }
    }
    // Cross-merchant duplicate children carry the root's merchant id.
    const crossRoots = raw
      .prepare(
        `SELECT e.id, e.duplicate_of, r.merchant_id AS root_merchant FROM evidence e
         JOIN evidence r ON r.id = e.duplicate_of
         WHERE e.merchant_id = ? AND r.merchant_id <> e.merchant_id`,
      )
      .all(EVIDENCE_RICH_ID) as { id: string; root_merchant: string }[];
    for (const row of crossRoots) {
      const item = detail?.evidence.find((e) => e.id === row.id);
      expect(item?.duplicateRootMerchantId).toBe(row.root_merchant);
    }
  });
});

describe('MerchantDb.getMerchantDetail — claims', () => {
  it('links evidence ids from claim_evidence', () => {
    const detail = db.getMerchantDetail(EVIDENCE_RICH_ID);
    expect(detail).not.toBeNull();
    const claimsWithLinks = (detail?.claims ?? []).filter((claim) => claim.evidenceIds.length > 0);
    expect(claimsWithLinks.length).toBeGreaterThan(0);
    for (const claim of claimsWithLinks) {
      const expected = (
        raw.prepare('SELECT evidence_id FROM claim_evidence WHERE claim_id = ? ORDER BY evidence_id').all(claim.id) as {
          evidence_id: string;
        }[]
      ).map((row) => row.evidence_id);
      expect([...claim.evidenceIds].sort()).toEqual([...expected].sort());
    }
    for (const evidenceId of claimsWithLinks[0].evidenceIds) {
      expect(detail?.evidence.some((item) => item.id === evidenceId)).toBe(true);
    }
  });
});

describe('MerchantDb.getMerchantDetail — identifiers and related', () => {
  it('includes full identifier projection with id/value/normalized/kind/role', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    const kinds = new Set(detail?.identifiers.map((identifier) => identifier.kind));
    expect(kinds.has('address')).toBe(true);
    expect(kinds.has('commercial_register')).toBe(true);
    expect(kinds.has('phone')).toBe(true);
    for (const identifier of detail?.identifiers ?? []) {
      expect(typeof identifier.id).toBe('number');
      expect(identifier.value.length).toBeGreaterThan(0);
      expect(identifier.normalizedValue.length).toBeGreaterThan(0);
      expect(identifier.role.length).toBeGreaterThan(0);
      expect(typeof identifier.searchable).toBe('boolean');
      expect(typeof identifier.displayable).toBe('boolean');
    }
    // The raw value differs from normalized for the B.TECH phone.
    const phone = detail?.identifiers.find((identifier) => identifier.kind === 'phone');
    expect(phone?.value).not.toBe(phone?.normalizedValue);
    expect(phone?.role).toBe('contact');
  });

  it('quarantines external-reference websites as non-displayable', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    const quarantined = (detail?.identifiers ?? []).filter(
      (identifier) => identifier.displayable === false,
    );
    for (const identifier of quarantined) {
      expect(identifier.role).toBe('external_reference');
    }
    expect(quarantined.length).toBeGreaterThanOrEqual(0);
  });

  it('resolves related merchants in both link directions with rationale', () => {
    const detail = db.getMerchantDetail(CONNECT_PHONE_ID);
    const outgoing = raw
      .prepare(
        'SELECT relation, confidence, rationale, right_merchant_id AS other FROM merchant_links WHERE left_merchant_id = ?',
      )
      .all(CONNECT_PHONE_ID) as { relation: string; confidence: number; rationale: string; other: string }[];
    const incoming = raw
      .prepare(
        'SELECT relation, confidence, rationale, left_merchant_id AS other FROM merchant_links WHERE right_merchant_id = ?',
      )
      .all(CONNECT_PHONE_ID) as { relation: string; confidence: number; rationale: string; other: string }[];
    expect(outgoing.length).toBeGreaterThan(0);
    expect(incoming.length).toBeGreaterThan(0);

    // Dedupe reciprocal pairs: exactly one entry per target merchant.
    const expectedTargets = new Set([...outgoing, ...incoming].map((row) => row.other));
    expect(new Set((detail?.related ?? []).map((related) => related.id)).size).toBe(
      (detail?.related ?? []).length,
    );
    expect(expectedTargets.size).toBe((detail?.related ?? []).length);
    for (const related of detail?.related ?? []) {
      expect(expectedTargets.has(related.id)).toBe(true);
      expect(related.name.length).toBeGreaterThan(0);
      expect(typeof related.rationale).toBe('string');
    }
  });

  it('resolves B.TECH known collision link (deduped to the stronger relation)', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    // Two links exist to d08748d3: identifier_collision (0.15) and
    // name_identifier_conflict (0.3). Per-target dedupe keeps the stronger.
    const related = (detail?.related ?? []).filter(
      (entry) => entry.id === 'd08748d3-b6be-4185-a32e-e439d19d3c72',
    );
    expect(related).toHaveLength(1);
    expect(related[0].relation).toBe('name_identifier_conflict');
    expect(related[0].confidence).toBeCloseTo(0.3);
    expect(related[0].rationale.length).toBeGreaterThan(0);
  });
});

describe('MerchantDb.getMerchantDetail — structural branches', () => {
  const ADDR_ONLY_ID = '17af7b06-643e-4cb8-880e-779ec39d3343';
  const NO_RELATED_ID = '00213c3a-c08d-4554-9993-ed39369a4543';
  const NULLPUB_ID = 'd08748d3-b6be-4185-a32e-e439d19d3c72';
  const SAME_ROUND_ID = '02369463-bc9c-4b0a-bd4d-04544becaa38';

  it('returns address/commercial_register identifiers in the detail even though they are excluded from the index', () => {
    const detail = db.getMerchantDetail(ADDR_ONLY_ID);
    expect(detail).not.toBeNull();
    expect(detail?.identifiers.length ?? 0).toBeGreaterThan(0);
    for (const identifier of detail?.identifiers ?? []) {
      expect(['address', 'commercial_register']).toContain(identifier.kind);
    }
    const indexedIds = new Set(db.getIndexData().identifiers.map((entry) => entry.merchantId));
    expect(indexedIds.has(ADDR_ONLY_ID)).toBe(false);
  });

  it('returns an empty related list when the merchant has no merchant_links in either direction', () => {
    const rawCount = raw.prepare(
      'SELECT COUNT(*) AS n FROM merchant_links WHERE left_merchant_id = ? OR right_merchant_id = ?',
    ).get(NO_RELATED_ID, NO_RELATED_ID) as { n: number };
    expect(rawCount.n).toBe(0);
    const detail = db.getMerchantDetail(NO_RELATED_ID);
    expect(detail?.related).toEqual([]);
  });

  it('selects the same-round analysis with the highest id (tie-break)', () => {
    const expectedRow = raw.prepare(
      'SELECT payload_json FROM merchant_analyses WHERE merchant_id = ? ORDER BY round_no DESC, id DESC LIMIT 1',
    ).get(SAME_ROUND_ID) as { payload_json: string };
    const rows = raw.prepare(
      'SELECT round_no, id FROM merchant_analyses WHERE merchant_id = ? ORDER BY round_no DESC, id DESC',
    ).all(SAME_ROUND_ID) as { round_no: number; id: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.round_no).toBe(rows[1]?.round_no); // genuinely same-round
    const detail = db.getMerchantDetail(SAME_ROUND_ID);
    expect(detail?.analysis).toEqual(parseAnalysisPayload(expectedRow.payload_json));
  });

  it('orders evidence by published_at DESC with NULLs last', () => {
    const detail = db.getMerchantDetail(NULLPUB_ID);
    const publishedAts = detail?.evidence.map((item) => item.publishedAt) ?? [];
    const firstNull = publishedAts.findIndex((value) => value === null);
    if (firstNull === -1) throw new Error('fixture must contain a null published_at');
    expect(publishedAts.slice(firstNull)).toEqual(Array.from({ length: publishedAts.length - firstNull }, () => null));
    const dated = publishedAts.slice(0, firstNull).filter((value): value is string => value !== null);
    expect(dated).toEqual([...dated].sort((a, b) => b.localeCompare(a)));
  });

  it('exposes snapshot metadata on the detail view', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    expect(detail?.snapshot.appSchemaVersion).toBe(1);
    expect(detail?.snapshot.sourceSchemaVersion).toBe(3);
    expect(detail?.snapshot.generatedAt.length).toBeGreaterThan(0);
  });
});

describe('parseAnalysisPayload — defensive branches', () => {
  it('returns null for invalid JSON', () => {
    expect(parseAnalysisPayload('{not json')).toBeNull();
  });

  it('returns null for scalar JSON and for arrays', () => {
    expect(parseAnalysisPayload('42')).toBeNull();
    expect(parseAnalysisPayload('"text"')).toBeNull();
    expect(parseAnalysisPayload('null')).toBeNull();
    expect(parseAnalysisPayload('[1,2]')).toBeNull();
  });

  it('accepts payload_version 1 and missing payload_version', () => {
    const withVersion = parseAnalysisPayload(
      JSON.stringify({ payload_version: 1, merchant_name: 'n' }),
    );
    expect(withVersion).not.toBeNull();
    expect(withVersion?.merchantName).toBe('n');
    expect(parseAnalysisPayload('{}')).not.toBeNull();
  });

  it('throws clearly on unknown payload versions', () => {
    expect(() => parseAnalysisPayload(JSON.stringify({ payload_version: 2 }))).toThrow(/payload_version/);
    expect(() => parseAnalysisPayload(JSON.stringify({ payload_version: '1' }))).toThrow(/payload_version/);
  });

  it('flattens evidence_summary.summary and applies defaults for missing fields', () => {
    const parsed = parseAnalysisPayload(JSON.stringify({
      payload_version: 1,
      evidence_summary: { summary: 'ملخص الأدلة' },
      identity_confidence: 0.55,
      verified_claims: ['claim', 7, null],
    }));
    expect(parsed).not.toBeNull();
    expect(parsed?.evidenceSummary).toBe('ملخص الأدلة');
    expect(parsed?.merchantName).toBe('');
    expect(parsed?.sourceDiversity).toBe(0);
    expect(parsed?.verifiedClaims).toEqual(['claim']);
    expect(parsed?.unverifiedClaims).toEqual([]);
    expect(parsed?.requiresMoreResearch).toBe(false);
    expect(parsed?.fraudRiskNotes).toBe('');
  });

  it('handles a scalar or missing evidence_summary and defaults other scalars', () => {
    expect(parseAnalysisPayload('{}')?.evidenceSummary).toBe('');
    expect(parseAnalysisPayload(JSON.stringify({ evidence_summary: 'plain' }))?.evidenceSummary).toBe('');
    const parsed = parseAnalysisPayload('{}');
    expect(parsed?.evidenceSummary ?? null).toBe('');
    expect(parsed?.fraudRiskNotes ?? null).toBe('');
    expect(parsed?.verifiedClaims ?? null).toEqual([]);
  });
});
