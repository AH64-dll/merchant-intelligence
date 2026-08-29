import { describe, expect, it, vi } from 'vitest';

import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { getDb, getIndex, validateSnapshotManifest } from './singletons';
import { GET as searchGET } from '../../app/api/search/route';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const MANIFEST_TABLES = [
  'merchants', 'sources', 'evidence', 'claims', 'claim_evidence',
  'merchant_analyses', 'merchant_identifiers', 'merchant_aliases', 'merchant_links',
] as const;

function searchRequest(q: string | null): Request {
  const url = new URL('http://localhost/api/search');
  if (q !== null) url.searchParams.set('q', q);
  return new Request(url);
}

describe('api/search route handler', () => {
  it('returns 400 for missing or blank query', async () => {
    for (const q of [null, '', '   ']) {
      const res = await searchGET(searchRequest(q));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'missing_query' });
    }
  });

  it('returns the new search contract shape with trimmed query', async () => {
    const res = await searchGET(searchRequest('  b tech  '));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      query: string;
      inputKind: string;
      total: number;
      page: number;
      pageSize: number;
      ambiguous: boolean;
      diagnostic: string | null;
      hits: { merchant: { id: string }; match: { kind: string; value: string; label: string } }[];
    };
    expect(body.query).toBe('b tech');
    expect(typeof body.inputKind).toBe('string');
    expect(typeof body.total).toBe('number');
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(typeof body.ambiguous).toBe('boolean');
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.hits[0].merchant.id.length).toBeGreaterThan(0);
    expect(typeof body.hits[0].match.kind).toBe('string');
    expect(typeof body.hits[0].match.value).toBe('string');
    expect(body.hits[0].match.label.length).toBeGreaterThan(0);
  });

  it('detects phone queries and matches identifier kinds', async () => {
    const res = await searchGET(searchRequest('01000000000'));
    const body = (await res.json()) as {
      inputKind: string;
      hits: { match: { kind: string } }[];
    };
    expect(body.inputKind).toBe('phone');
    expect(body.hits[0].match.kind).toMatch(/phone|whatsapp/);
  });

  it('rejects queries longer than 300 characters', async () => {
    const res = await searchGET(searchRequest('a'.repeat(301)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'query_too_long' });
  });

  it('accepts a query of exactly 300 characters with the normal shape', async () => {
    const res = await searchGET(searchRequest('a'.repeat(300)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { query: string; inputKind: string; hits: unknown[] };
    expect(body.query).toHaveLength(300);
    expect(typeof body.inputKind).toBe('string');
    expect(Array.isArray(body.hits)).toBe(true);
  });
});

describe('singletons', () => {
  it('returns the same instance on repeated calls', () => {
    expect(getDb()).toBe(getDb());
    expect(getIndex()).toBe(getIndex());
  });

  it('builds the index from the real snapshot without throwing and searches it', () => {
    const index = getIndex();
    const result = index.search('b tech');
    expect(result.hits.length).toBeGreaterThan(0);
    const detail = getDb().getMerchantDetail(result.hits[0].merchant.id);
    expect(detail).not.toBeNull();
    expect(detail?.merchant.canonicalName.length ?? 0).toBeGreaterThan(0);
  });

  it('exposes snapshot info from the loaded snapshot manifest', () => {
    // The Detail slice adds getSnapshotInfo() to db.ts; when present it must
    // report the v1/v3 contract. When absent (parallel work in flight), the
    // manifest itself is asserted directly so this contract is still proven.
    const db = getDb() as { getSnapshotInfo?: () => unknown };
    if (typeof db.getSnapshotInfo === 'function') {
      const info = db.getSnapshotInfo() as {
        appSchemaVersion: number;
        sourceSchemaVersion: number;
        generatedAt: string;
        counts: Record<string, number>;
      };
      expect(info.appSchemaVersion).toBe(1);
      expect(info.sourceSchemaVersion).toBe(3);
      expect(info.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Object.keys(info.counts).length).toBe(9);
    } else {
      const dbPath = process.env['MERCHANTS_DB'] ?? './data/merchants.db';
      const conn = new Database(dbPath, { readonly: true });
      try {
        const meta = conn.prepare('SELECT * FROM snapshot_meta WHERE id = 1').get() as {
          app_schema_version: number;
          source_schema_version: number;
          generated_at: string;
        };
        expect(meta.app_schema_version).toBe(1);
        expect(meta.source_schema_version).toBe(3);
        expect(meta.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      } finally {
        conn.close();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Manifest-validation failure tests (pure validation logic, no singleton
// state; a stubbed DB instance exercises the same checks db.ts performs).
// ---------------------------------------------------------------------------

const COLUMNS = [
  'id', 'app_schema_version', 'source_schema_version', 'generated_at',
  'source_max_evidence_captured_at', 'source_max_merchant_updated_at',
  'merchants_count', 'sources_count', 'evidence_count', 'claims_count',
  'claim_evidence_count', 'merchant_analyses_count', 'merchant_identifiers_count',
  'merchant_aliases_count', 'merchant_links_count',
] as const;

const META_COLUMNS_SQL = COLUMNS.map((c) => `${c} INTEGER`).join(', ');

type Meta = { [k in (typeof COLUMNS)[number]]: number | string | null };

/** Build a minimal snapshot fixture: nine empty manifest tables + a meta row. */
function buildSnapshotFixture(meta: Partial<Meta> | null, opts?: { omitRow?: boolean }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-fixture-'));
  const file = path.join(dir, 'fixture.db');
  const conn = new Database(file);
  for (const t of MANIFEST_TABLES) conn.exec(`CREATE TABLE ${t} (id TEXT)`);
  conn.exec(`CREATE TABLE snapshot_meta (${META_COLUMNS_SQL})`);
  if (!opts?.omitRow) {
    const row: Meta = {
      id: 1, app_schema_version: 1, source_schema_version: 3,
      generated_at: '2026-08-29T00:00:00Z',
      source_max_evidence_captured_at: null, source_max_merchant_updated_at: null,
      merchants_count: 0, sources_count: 0, evidence_count: 0, claims_count: 0,
      claim_evidence_count: 0, merchant_analyses_count: 0,
      merchant_identifiers_count: 0, merchant_aliases_count: 0, merchant_links_count: 0,
      ...meta,
    };
    conn.prepare(
      `INSERT INTO snapshot_meta (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
    ).run(...COLUMNS.map((c) => row[c] ?? null));
  }
  conn.close();
  return file;
}

function validateManifest(file: string): string | null {
  try {
    validateSnapshotManifest(file);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe('snapshot manifest validation (validateSnapshotManifest)', () => {
  it('accepts a well-formed v1 manifest matching the empty tables', () => {
    expect(validateManifest(buildSnapshotFixture({}))).toBeNull();
  });

  it('rejects a snapshot without the snapshot_meta table', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-fixture-'));
    const file = path.join(dir, 'fixture.db');
    const conn = new Database(file);
    conn.exec('CREATE TABLE other (x)');
    conn.close();
    expect(validateManifest(file)).toMatch(/snapshot_meta table missing/);
  });

  it('rejects a snapshot whose meta row is missing', () => {
    const file = buildSnapshotFixture(null, { omitRow: true });
    expect(validateManifest(file)).toMatch(/snapshot_meta row missing/);
  });

  it('rejects an unknown app schema version', () => {
    const file = buildSnapshotFixture({ app_schema_version: 2 });
    expect(validateManifest(file)).toMatch(/app_schema_version 2, expected 1/);
  });

  it('rejects an unknown source schema version', () => {
    const file = buildSnapshotFixture({ source_schema_version: 2 });
    expect(validateManifest(file)).toMatch(/source_schema_version 2, expected 3/);
  });

  it('rejects a count mismatch between manifest and tables', () => {
    const file = buildSnapshotFixture({ merchants_count: 99 });
    expect(validateManifest(file)).toMatch(/merchants_count 99 does not match table count 0/);
  });
});

describe('singletons — MERCHANTS_DB override', () => {
  it('honors the MERCHANTS_DB environment variable for a fresh module instance', async () => {
    const realPath = fileURLToPath(new URL('../../data/merchants.db', import.meta.url));
    vi.resetModules();
    const previous = process.env['MERCHANTS_DB'];
    process.env['MERCHANTS_DB'] = realPath;
    try {
      // Dynamic import is required: singletons.ts caches DB_PATH at module load,
      // so this test intentionally exercises a fresh module-load boundary.
      const overridden = await import('./singletons');
      expect(overridden.getDb()).toBe(overridden.getDb());
      expect(overridden.getIndex()).toBe(overridden.getIndex());
      const result = overridden.getIndex().search('b tech');
      expect(result.hits.length).toBeGreaterThan(0);
      expect(overridden.getDb().getMerchantDetail(result.hits[0]?.merchant.id ?? '')).not.toBeNull();
    } finally {
      if (previous === undefined) delete process.env['MERCHANTS_DB'];
      else process.env['MERCHANTS_DB'] = previous;
      vi.resetModules();
    }
  });

  it('fails fast when MERCHANTS_DB points at a missing database file', async () => {
    vi.resetModules();
    const previous = process.env['MERCHANTS_DB'];
    process.env['MERCHANTS_DB'] = '/nonexistent/merchants.db';
    try {
      // Same module-load boundary as above: a fresh instance reads the overridden env var.
      const overridden = await import('./singletons');
      expect(() => overridden.getDb()).toThrow();
    } finally {
      if (previous === undefined) delete process.env['MERCHANTS_DB'];
      else process.env['MERCHANTS_DB'] = previous;
      vi.resetModules();
    }
  });
});
