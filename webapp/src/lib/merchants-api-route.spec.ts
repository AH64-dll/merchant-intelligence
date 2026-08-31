import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MerchantDirectoryEntry, MerchantDirectoryResult } from './types';

const mocks = vi.hoisted(() => ({
  cache: new Map<string, { body: string; contentType: string }>(),
  getMerchantDirectory: vi.fn(),
  renderCacheGet: vi.fn(),
  renderCacheSet: vi.fn(),
}));

vi.mock('./singletons', () => ({
  getDb: () => ({ getMerchantDirectory: mocks.getMerchantDirectory }),
}));

vi.mock('./render-cache', () => ({
  renderCacheGet: mocks.renderCacheGet,
  renderCacheSet: mocks.renderCacheSet,
}));

import { GET } from '../../app/api/merchants/route';

const ENTRY: MerchantDirectoryEntry = {
  id: 'merchant-1',
  canonicalName: 'متجر الاختبار',
  categoryTags: ['إلكترونيات'],
  locationLabel: 'القاهرة',
  locationCount: 2,
  identityLevel: 'established',
  coverageLevel: 'moderate',
  evidence: {
    total: 8,
    nonDuplicate: 7,
    distinctSources: 4,
    positive: 5,
    neutral: 2,
    negative: 1,
    customerPositiveSources: 3,
    latestPublishedAt: '2026-07-10T00:00:00Z',
    lastCapturedAt: '2026-07-12T00:00:00Z',
  },
  positiveHighlight: {
    evidenceId: 'evidence-1',
    summary: 'تجربة شراء موثقة',
    sourceUrl: 'https://example.com/review',
    sourceCategory: 'customer_report',
    publishedAt: '2026-07-10T00:00:00Z',
  },
  updatedAt: '2026-07-12T00:00:00Z',
};

function result(
  overrides: Partial<MerchantDirectoryResult> = {},
): MerchantDirectoryResult {
  return {
    items: [ENTRY],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    availableFilters: {
      categories: ['إلكترونيات'],
      governorates: ['القاهرة'],
      coverage: ['none', 'limited', 'moderate', 'broad'],
    },
    snapshot: {
      generatedAt: '2026-07-12T00:00:00Z',
      sourceSchemaVersion: 3,
      appSchemaVersion: 1,
      counts: { merchants: 1, sources: 1, evidence: 1 },
    },
    ...overrides,
  };
}

function request(query = ''): Request {
  return new Request(`http://localhost/api/merchants${query}`);
}

async function json(response: Response): Promise<MerchantDirectoryResult> {
  return await response.json() as MerchantDirectoryResult;
}

beforeEach(() => {
  mocks.cache.clear();
  vi.clearAllMocks();
  mocks.renderCacheGet.mockReturnValue(undefined);
  mocks.getMerchantDirectory.mockReturnValue(result());
});

describe('GET /api/merchants', () => {
  it('uses the all-sellers defaults and accepts the positive-evidence view', async () => {
    const allResponse = await GET(request());
    expect(allResponse.status).toBe(200);
    expect(await json(allResponse)).toEqual(result());
    expect(mocks.getMerchantDirectory).toHaveBeenNthCalledWith(1, {});

    const positiveResponse = await GET(request('?view=positive-evidence'));
    expect(positiveResponse.status).toBe(200);
    expect(await json(positiveResponse)).toEqual(result());
    expect(mocks.getMerchantDirectory).toHaveBeenNthCalledWith(2, {
      view: 'positive-evidence',
    });
  });

  it('preserves pagination metadata when a valid page is out of range', async () => {
    const emptyPage = result({
      items: [],
      pagination: { page: 9, pageSize: 20, total: 21, totalPages: 2 },
    });
    mocks.getMerchantDirectory.mockReturnValue(emptyPage);

    const response = await GET(request('?page=9'));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual(emptyPage);
    expect(mocks.getMerchantDirectory).toHaveBeenCalledWith({ page: '9' });
  });

  it('passes the supported filters to the shared selector as raw query input', async () => {
    const response = await GET(request(
      '?view=positive-evidence&page=2&category=%D8%A5%D9%84%D9%83%D8%AA%D8%B1%D9%88%D9%86%D9%8A%D8%A7%D8%AA&governorate=%D8%A7%D9%84%D9%82%D8%A7%D9%87%D8%B1%D8%A9&coverage=moderate',
    ));

    expect(response.status).toBe(200);
    expect(mocks.getMerchantDirectory).toHaveBeenCalledWith({
      view: 'positive-evidence',
      page: '2',
      category: 'إلكترونيات',
      governorate: 'القاهرة',
      coverage: 'moderate',
    });
  });

  it('uses one normalized cache key and returns a stable cached response', async () => {
    mocks.renderCacheGet.mockImplementation((key: string) => mocks.cache.get(key));
    mocks.renderCacheSet.mockImplementation(
      (key: string, body: string, contentType: string) => {
        mocks.cache.set(key, { body, contentType });
      },
    );

    const first = await GET(request('?category=%20%D9%87%D9%88%D8%A7%D8%AA%D9%81%20%20%D8%B0%D9%83%D9%8A%D8%A9%20'));
    const firstBody = await first.text();
    const second = await GET(request('?page=1&view=all&category=%D9%87%D9%88%D8%A7%D8%AA%D9%81%20%D8%B0%D9%83%D9%8A%D8%A9'));
    const secondBody = await second.text();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody).toBe(firstBody);
    expect(mocks.getMerchantDirectory).toHaveBeenCalledTimes(1);
    expect(mocks.renderCacheGet).toHaveBeenCalledTimes(2);
    expect(mocks.renderCacheGet.mock.calls[0]?.[0]).toBe(
      mocks.renderCacheGet.mock.calls[1]?.[0],
    );
    expect(mocks.renderCacheSet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['page zero', '?page=0'],
    ['non-canonical page', '?page=01'],
    ['fractional page', '?page=1.5'],
    ['unknown view', '?view=positive'],
    ['blank category', '?category=%20%20'],
    ['control character in governorate', '?governorate=%0A'],
    ['unknown coverage', '?coverage=wide'],
    ['repeated page', '?page=1&page=2'],
    ['repeated filter', '?category=a&category=b'],
  ])('returns 400 for invalid %s syntax', async (_label, queryString) => {
    const response = await GET(request(queryString));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_query' });
    expect(mocks.getMerchantDirectory).not.toHaveBeenCalled();
    expect(mocks.renderCacheSet).not.toHaveBeenCalled();
  });

  it('serializes only the public directory result fields', async () => {
    const leakyEntry = {
      ...ENTRY,
      state: 'VERIFIED_HIGH_CONFIDENCE',
      identityConfidence: 0.99,
      reliabilityBand: 'strong',
      evidence: {
        ...ENTRY.evidence,
        rows: [{ rawJson: '{"secret":true}', quotedExcerpt: 'private detail' }],
      },
      positiveHighlight: {
        evidenceId: 'evidence-1',
        summary: 'تجربة شراء موثقة',
        sourceUrl: 'https://example.com/review',
        sourceCategory: 'customer_report',
        publishedAt: '2026-07-10T00:00:00Z',
        confidence: 0.98,
        reliabilityBand: 'strong',
      },
    };
    const leakyResult = {
      ...result(),
      items: [leakyEntry],
      rawState: 'internal',
      detailEvidence: [{ id: 'private-evidence' }],
      snapshot: { ...result().snapshot, databasePath: '/private/data.db' },
    } as unknown as MerchantDirectoryResult;
    mocks.getMerchantDirectory.mockReturnValue(leakyResult);

    const response = await GET(request());
    const body = await response.text();
    const parsed = JSON.parse(body) as MerchantDirectoryResult;

    expect(response.status).toBe(200);
    expect(parsed).toEqual(result());
    for (const internalName of [
      'identityConfidence',
      'reliabilityBand',
      'rawState',
      'detailEvidence',
      'rawJson',
      'quotedExcerpt',
      'databasePath',
      'VERIFIED_HIGH_CONFIDENCE',
    ]) {
      expect(body).not.toContain(internalName);
    }
  });
});
