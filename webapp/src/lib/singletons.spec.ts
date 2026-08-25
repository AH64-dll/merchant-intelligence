import { describe, expect, it, vi } from 'vitest';

import { fileURLToPath } from 'node:url';

import { getDb, getIndex } from './singletons';
import { GET as searchGET } from '../../app/api/search/route';

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

  it('returns search shape with trimmed query', async () => {
    const res = await searchGET(searchRequest('  b tech  '));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      query: string;
      detectedType: string;
      hits: { merchant: { id: string }; score: number; matchedOn: string; matchedValue: string }[];
    };
    expect(body.query).toBe('b tech');
    expect(typeof body.detectedType).toBe('string');
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.hits[0].merchant.id.length).toBeGreaterThan(0);
    expect(typeof body.hits[0].score).toBe('number');
    expect(typeof body.hits[0].matchedOn).toBe('string');
    expect(typeof body.hits[0].matchedValue).toBe('string');
  });

  it('detects phone queries', async () => {
    const res = await searchGET(searchRequest('01000000000'));
    const body = (await res.json()) as { detectedType: string; hits: { matchedOn: string }[] };
    expect(body.detectedType).toBe('phone');
    expect(body.hits[0].matchedOn).toMatch(/phone|whatsapp/);
  });

  it('rejects queries longer than 300 characters', async () => {
    const res = await searchGET(searchRequest('a'.repeat(301)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'query_too_long' });
  });

  it('accepts a query of exactly 300 characters with the normal shape', async () => {
    const res = await searchGET(searchRequest('a'.repeat(300)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { query: string; detectedType: string; hits: unknown[] };
    expect(body.query).toHaveLength(300);
    expect(typeof body.detectedType).toBe('string');
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
