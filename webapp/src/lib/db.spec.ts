import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MerchantDb, parseAnalysisPayload } from './db';

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

describe('MerchantDb.getIndexData', () => {
  const indexData = () => db.getIndexData();

  it('returns the full merchant count', () => {
    expect(indexData().merchants.length).toBe(370);
  });

  it('returns only searchable identifier kinds', () => {
    const kinds = new Set(indexData().identifiers.map((identifier) => identifier.kind));
    expect(kinds.has('address')).toBe(false);
    expect(kinds.has('commercial_register')).toBe(false);
    expect(kinds.has('phone')).toBe(true);
    expect(kinds.has('facebook')).toBe(true);
    expect(kinds.size).toBe(9);
  });

  it('returns all aliases', () => {
    expect(indexData().aliases.length).toBe(1924);
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
    const analysisRows = (
      raw.prepare('SELECT COUNT(*) AS c FROM merchant_analyses WHERE merchant_id = ?').get(SMART_HOME_ID) as { c: number }
    ).c;
    expect(analysisRows).toBe(0);
    expect(detail?.analysis).toBeNull();
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

  it('joins platform and url from sources', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    for (const item of detail?.evidence ?? []) {
      expect(item.platform.length).toBeGreaterThan(0);
      expect(item.url.length).toBeGreaterThan(0);
    }
  });

  it('computes sentiment counts from evidence', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    expect(detail?.sentiment).toEqual({ positive: 5, negative: 1, neutral: 3 });
  });
});

describe('MerchantDb.getMerchantDetail — identifiers and related', () => {
  it('includes address and commercial_register identifiers on the detail page', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    const kinds = new Set(detail?.identifiers.map((identifier) => identifier.kind));
    expect(kinds.has('address')).toBe(true);
    expect(kinds.has('commercial_register')).toBe(true);
    expect(kinds.has('phone')).toBe(true);
  });

  it('resolves related merchants in both link directions', () => {
    const detail = db.getMerchantDetail(CONNECT_PHONE_ID);
    const outgoing = raw
      .prepare(
        'SELECT relation, confidence, right_merchant_id AS other FROM merchant_links WHERE left_merchant_id = ?',
      )
      .all(CONNECT_PHONE_ID) as { relation: string; confidence: number; other: string }[];
    const incoming = raw
      .prepare(
        'SELECT relation, confidence, left_merchant_id AS other FROM merchant_links WHERE right_merchant_id = ?',
      )
      .all(CONNECT_PHONE_ID) as { relation: string; confidence: number; other: string }[];
    expect(outgoing.length).toBeGreaterThan(0);
    expect(incoming.length).toBeGreaterThan(0);

    const expected = [...outgoing, ...incoming]
      .map((row) => `${row.relation}|${row.other}|${row.confidence}`)
      .sort();
    const actual = (detail?.related ?? [])
      .map((related) => `${related.relation}|${related.id}|${related.confidence}`)
      .sort();
    expect(actual).toEqual(expected);
    for (const related of detail?.related ?? []) {
      expect(related.name.length).toBeGreaterThan(0);
    }
  });

  it('resolves B.TECH known collision links', () => {
    const detail = db.getMerchantDetail(B_TECH_ID);
    const collision = detail?.related.find(
      (related) => related.id === 'd08748d3-b6be-4185-a32e-e439d19d3c72' && related.relation === 'identifier_collision',
    );
    expect(collision).toBeDefined();
    expect(collision?.confidence).toBeCloseTo(0.15);
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

  it('produces sentiment counts identical to SQL GROUP BY on evidence', () => {
    for (const id of [B_TECH_ID, EVIDENCE_RICH_ID, NO_RELATED_ID]) {
      const rows = raw.prepare(
        `SELECT sentiment, COUNT(*) AS n FROM evidence WHERE merchant_id = ? GROUP BY sentiment`,
      ).all(id) as { sentiment: string; n: number }[];
      const sqlCounts = { positive: 0, negative: 0, neutral: 0 };
      for (const row of rows) {
        if (row.sentiment === 'positive') sqlCounts.positive = row.n;
        else if (row.sentiment === 'negative') sqlCounts.negative = row.n;
        else sqlCounts.neutral = row.n;
      }
      expect(db.getMerchantDetail(id)?.sentiment).toEqual(sqlCounts);
    }
  });
});

describe('parseAnalysisPayload — defensive branches', () => {
  it('returns null for invalid JSON', () => {
    expect(parseAnalysisPayload('{not json')).toBeNull();
  });

  it('returns null for scalar JSON but treats arrays as empty objects', () => {
    expect(parseAnalysisPayload('42')).toBeNull();
    expect(parseAnalysisPayload('"text"')).toBeNull();
    expect(parseAnalysisPayload('null')).toBeNull();
    expect(parseAnalysisPayload('[1,2]')).not.toBeNull();
    expect(parseAnalysisPayload('[1,2]')?.merchantName).toBe('');
  });

  it('flattens evidence_summary.summary and applies defaults for missing fields', () => {
    const parsed = parseAnalysisPayload(JSON.stringify({
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
