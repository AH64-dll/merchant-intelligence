import { describe, expect, it } from 'vitest';
import {
  buildMerchantDirectoryProjection,
  directoryQueryCacheKey,
  DirectoryQueryValidationError,
  normalizeDirectoryQuery,
  selectMerchantDirectory,
} from './directory';
import type {
  DirectoryEvidenceRow,
  DirectoryLinkRow,
  DirectoryMerchantIdentifierRow,
} from './directory';
import type { MerchantState, SnapshotInfo } from './types';

const SNAPSHOT: SnapshotInfo = {
  generatedAt: '2026-08-31T12:00:00Z',
  sourceSchemaVersion: 3,
  appSchemaVersion: 1,
  counts: { merchants: 0 },
};

let identifierId = 1;
let evidenceId = 1;

interface MerchantOptions {
  name?: string;
  state?: MerchantState;
  category?: string;
  city?: string;
  governorate?: string;
  identifiers?: boolean;
}

function merchant(id: string, options: MerchantOptions = {}): DirectoryMerchantIdentifierRow[] {
  const common = {
    merchantId: id,
    canonicalName: options.name ?? id,
    category: options.category ?? 'electronics',
    city: options.city ?? 'Cairo',
    governorate: options.governorate ?? 'Cairo',
    state: options.state ?? 'VERIFIED_HIGH_CONFIDENCE' as MerchantState,
    updatedAt: '2026-08-31T10:00:00Z',
  };
  if (options.identifiers === false) {
    return [{
      ...common,
      identifierId: null,
      identifierKind: null,
      identifierValue: null,
      identifierNormalizedValue: null,
    }];
  }
  const suffix = identifierId++;
  return [
    {
      ...common,
      identifierId: suffix * 2,
      identifierKind: 'website',
      identifierValue: `https://${id}.example`,
      identifierNormalizedValue: `https://${id}.example`,
    },
    {
      ...common,
      identifierId: suffix * 2 + 1,
      identifierKind: 'email',
      identifierValue: `${id}@example.com`,
      identifierNormalizedValue: `${id}@example.com`,
    },
  ];
}

function evidence(
  merchantId: string,
  overrides: Partial<DirectoryEvidenceRow> = {},
): DirectoryEvidenceRow {
  const id = overrides.id ?? `ev-${evidenceId++}`;
  const sourceUrl = overrides.sourceUrl ?? `https://reviews.example/${id}`;
  return {
    claimType: 'successful_purchase',
    sentiment: 'positive',
    summary: `summary ${id}`,
    authorType: 'unknown',
    confidence: 0.7,
    reliabilityBand: 'medium',
    publishedAt: '2026-01-01T00:00:00Z',
    capturedAt: '2026-02-01T00:00:00Z',
    platform: 'reviews.example',
    sourceUrl,
    canonicalSourceUrl: overrides.canonicalSourceUrl ?? sourceUrl,
    sourceType: 'community',
    transactionEvidence: false,
    verified: false,
    independent: true,
    duplicateOf: null,
    ...overrides,
    id,
    merchantId,
  };
}

function positivePair(merchantId: string): DirectoryEvidenceRow[] {
  return [
    evidence(merchantId, { id: `${merchantId}-positive-1`, sourceUrl: `https://one.example/${merchantId}`, canonicalSourceUrl: `https://one.example/${merchantId}` }),
    evidence(merchantId, { id: `${merchantId}-positive-2`, sourceUrl: `https://two.example/${merchantId}`, canonicalSourceUrl: `https://two.example/${merchantId}` }),
  ];
}

function projection(
  merchantRows: DirectoryMerchantIdentifierRow[],
  evidenceRows: DirectoryEvidenceRow[],
  links: DirectoryLinkRow[] = [],
) {
  return buildMerchantDirectoryProjection(merchantRows, links, evidenceRows, SNAPSHOT);
}

function positiveIds(
  merchantRows: DirectoryMerchantIdentifierRow[],
  evidenceRows: DirectoryEvidenceRow[],
  links: DirectoryLinkRow[] = [],
): string[] {
  return selectMerchantDirectory(projection(merchantRows, evidenceRows, links), {
    view: 'positive-evidence',
  }).items.map((item) => item.id);
}

function allObjectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (value === null || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    allObjectKeys(child, found);
  }
  return found;
}

describe('public directory projection', () => {
  it('contains only the public contract and freezes nested results', () => {
    const result = selectMerchantDirectory(
      projection(merchant('seller'), positivePair('seller')),
      {},
    );
    const entry = result.items[0];
    expect(Object.keys(entry)).toEqual([
      'id',
      'canonicalName',
      'categoryTags',
      'locationLabel',
      'locationCount',
      'identityLevel',
      'coverageLevel',
      'evidence',
      'positiveHighlight',
      'updatedAt',
    ]);
    expect(Object.keys(entry.evidence)).toEqual([
      'total',
      'nonDuplicate',
      'distinctSources',
      'positive',
      'neutral',
      'negative',
      'customerPositiveSources',
      'latestPublishedAt',
      'lastCapturedAt',
    ]);
    const keys = allObjectKeys(result.items);
    for (const forbidden of [
      'identityConfidence',
      'confidence',
      'reliabilityBand',
      'state',
      'duplicateOf',
      'rawJson',
      'score',
      'rank',
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.evidence)).toBe(true);
  });

  it('derives identity through identifiers and link conflicts rather than verified state alone', () => {
    const rows = [
      ...merchant('established'),
      ...merchant('no-identifiers', { identifiers: false }),
      ...merchant('conflicted'),
      ...merchant('other'),
    ];
    const evidenceRows = [
      ...positivePair('established'),
      ...positivePair('no-identifiers'),
      ...positivePair('conflicted'),
      ...positivePair('other'),
    ];
    const links: DirectoryLinkRow[] = [{
      leftMerchantId: 'conflicted',
      rightMerchantId: 'other',
      relation: 'name_identifier_conflict',
    }];
    const built = projection(rows, evidenceRows, links);
    expect(built.entries.find((entry) => entry.id === 'established')?.identityLevel).toBe('established');
    expect(built.entries.find((entry) => entry.id === 'no-identifiers')?.identityLevel).toBe('uncertain');
    expect(built.entries.find((entry) => entry.id === 'conflicted')?.identityLevel).toBe('uncertain');
    expect(positiveIds(rows, evidenceRows, links)).toEqual(['established']);
  });

  it('counts distinct address records without claiming a branch count', () => {
    const rows = merchant('locations', { city: 'Alexandria', governorate: 'Alexandria' });
    const common = rows[0];
    rows.push(
      {
        ...common,
        identifierId: 9001,
        identifierKind: 'address',
        identifierValue: 'Address A',
        identifierNormalizedValue: 'address a',
      },
      {
        ...common,
        identifierId: 9002,
        identifierKind: 'address',
        identifierValue: 'Address B',
        identifierNormalizedValue: 'address b',
      },
    );
    const entry = projection(rows, positivePair('locations')).entries[0];
    expect(entry.locationLabel).toBe('Alexandria');
    expect(entry.locationCount).toBe(2);
  });
});

describe('positive-evidence eligibility', () => {
  it('admits only the two verified states', () => {
    const states: MerchantState[] = [
      'VERIFIED_HIGH_CONFIDENCE',
      'VERIFIED_MODERATE_CONFIDENCE',
      'MIXED_REPUTATION',
      'OFFICIAL_WARNING',
      'HIGH_RISK_SIGNALS',
      'REQUIRES_MANUAL_REVIEW',
      'IDENTITY_UNCERTAIN',
      'INSUFFICIENT_DATA',
    ];
    const rows = states.flatMap((state) => merchant(state, { state }));
    const evidenceRows = states.flatMap((state) => positivePair(state));
    expect(positiveIds(rows, evidenceRows)).toEqual([
      'VERIFIED_HIGH_CONFIDENCE',
      'VERIFIED_MODERATE_CONFIDENCE',
    ]);
  });

  it('requires two distinct independent non-duplicate positive source URLs', () => {
    const ids = ['eligible', 'one-source', 'duplicate', 'not-independent', 'unsafe-url'];
    const rows = ids.flatMap((id) => merchant(id));
    const evidenceRows = [
      ...positivePair('eligible'),
      evidence('one-source', { sourceUrl: 'https://same.example/review', canonicalSourceUrl: 'https://same.example/review' }),
      evidence('one-source', { sourceUrl: 'https://same.example/review', canonicalSourceUrl: 'https://same.example/review' }),
      evidence('duplicate', { sourceUrl: 'https://one.example/duplicate', canonicalSourceUrl: 'https://one.example/duplicate' }),
      evidence('duplicate', { sourceUrl: 'https://two.example/duplicate', canonicalSourceUrl: 'https://two.example/duplicate', independent: false, duplicateOf: 'root' }),
      evidence('not-independent', { sourceUrl: 'https://one.example/not-independent', canonicalSourceUrl: 'https://one.example/not-independent' }),
      evidence('not-independent', { sourceUrl: 'https://two.example/not-independent', canonicalSourceUrl: 'https://two.example/not-independent', independent: false }),
      evidence('unsafe-url', { sourceUrl: 'javascript:alert(1)', canonicalSourceUrl: 'javascript:alert(1)' }),
      evidence('unsafe-url', { sourceUrl: 'https://safe.example/review', canonicalSourceUrl: 'https://safe.example/review' }),
    ];
    expect(positiveIds(rows, evidenceRows)).toEqual(['eligible']);
    const duplicateEntry = projection(rows, evidenceRows).entries.find((entry) => entry.id === 'duplicate');
    expect(duplicateEntry?.evidence).toMatchObject({ total: 2, nonDuplicate: 1, positive: 1 });
  });

  it('does not count merchant advertising as customer-authored feedback', () => {
    const rows = merchant('advertising');
    const evidenceRows = positivePair('advertising').map((row) => ({ ...row, authorType: 'merchant' }));
    const built = projection(rows, evidenceRows);
    expect(positiveIds(rows, evidenceRows)).toEqual(['advertising']);
    expect(built.entries[0].evidence.customerPositiveSources).toBe(0);
  });

  it('excludes any independent adverse evidence from a non-merchant author', () => {
    const rows = [
      ...merchant('customer-adverse'),
      ...merchant('duplicate-adverse'),
      ...merchant('merchant-adverse'),
    ];
    const evidenceRows = [
      ...positivePair('customer-adverse'),
      evidence('customer-adverse', { sentiment: 'negative', claimType: 'refund_issue', authorType: 'customer' }),
      ...positivePair('duplicate-adverse'),
      evidence('duplicate-adverse', {
        sentiment: 'negative',
        claimType: 'refund_issue',
        authorType: 'customer',
        independent: false,
        duplicateOf: 'root',
      }),
      ...positivePair('merchant-adverse'),
      evidence('merchant-adverse', { sentiment: 'negative', claimType: 'refund_issue', authorType: 'merchant' }),
    ];
    expect(positiveIds(rows, evidenceRows)).toEqual(['merchant-adverse', 'duplicate-adverse']);
  });

  it('excludes central assessment warning and risk claims even when sentiment is neutral', () => {
    const ids = ['official-warning', 'risk', 'duplicate-warning', 'merchant-warning'];
    const rows = ids.flatMap((id) => merchant(id));
    const evidenceRows = [
      ...positivePair('official-warning'),
      evidence('official-warning', { sentiment: 'neutral', claimType: 'official_warning', authorType: 'regulator' }),
      ...positivePair('risk'),
      evidence('risk', { sentiment: 'neutral', claimType: 'identity_mismatch', authorType: 'unknown' }),
      ...positivePair('duplicate-warning'),
      evidence('duplicate-warning', {
        sentiment: 'neutral',
        claimType: 'official_warning',
        authorType: 'regulator',
        independent: false,
        duplicateOf: 'root',
      }),
      ...positivePair('merchant-warning'),
      evidence('merchant-warning', { sentiment: 'neutral', claimType: 'official_warning', authorType: 'merchant' }),
    ];
    expect(positiveIds(rows, evidenceRows)).toEqual(['merchant-warning', 'duplicate-warning']);
  });
});

describe('positive-evidence lexicographic ordering', () => {
  function pair(
    aRows: DirectoryEvidenceRow[],
    bRows: DirectoryEvidenceRow[],
    aName = 'Zulu',
    bName = 'Alpha',
  ): string[] {
    return positiveIds(
      [...merchant('a', { name: aName }), ...merchant('b', { name: bName })],
      [...aRows, ...bRows],
    );
  }

  it('uses customer-authored positive source count first', () => {
    const a = positivePair('a');
    a[0] = { ...a[0], authorType: 'customer' };
    expect(pair(a, positivePair('b'))).toEqual(['a', 'b']);
  });

  it('then uses verified positive source count', () => {
    const a = positivePair('a');
    a[0] = { ...a[0], verified: true };
    expect(pair(a, positivePair('b'))).toEqual(['a', 'b']);
  });

  it('then uses strong-band positive source count', () => {
    const a = positivePair('a');
    a[0] = { ...a[0], reliabilityBand: 'very_strong' };
    expect(pair(a, positivePair('b'))).toEqual(['a', 'b']);
  });

  it('then uses all distinct positive source count', () => {
    const a = [...positivePair('a'), evidence('a', { sourceUrl: 'https://third.example/a', canonicalSourceUrl: 'https://third.example/a' })];
    expect(pair(a, positivePair('b'))).toEqual(['a', 'b']);
  });

  it('then uses all distinct non-duplicate source count', () => {
    const a = [...positivePair('a'), evidence('a', {
      sentiment: 'neutral',
      claimType: 'other',
      sourceUrl: 'https://neutral.example/a',
      canonicalSourceUrl: 'https://neutral.example/a',
    })];
    expect(pair(a, positivePair('b'))).toEqual(['a', 'b']);
  });

  it('then uses newest positive publication or capture date', () => {
    const a = positivePair('a').map((row) => ({ ...row, publishedAt: '2026-03-01T00:00:00Z' }));
    expect(pair(a, positivePair('b'))).toEqual(['a', 'b']);
  });

  it('finally uses canonical name and then UUID, independent of input order', () => {
    const byName = pair(positivePair('a'), positivePair('b'), 'Beta', 'Alpha');
    expect(byName).toEqual(['b', 'a']);
    const sameNameRows = [
      ...merchant('b', { name: 'Same' }),
      ...merchant('a', { name: 'Same' }),
    ].reverse();
    expect(positiveIds(sameNameRows, [...positivePair('b'), ...positivePair('a')].reverse())).toEqual(['a', 'b']);
  });
});

describe('positive highlight ordering', () => {
  function highlighted(
    winner: Partial<DirectoryEvidenceRow>,
    loser: Partial<DirectoryEvidenceRow>,
  ): string | undefined {
    const rows = merchant('highlight');
    const evidenceRows = [
      evidence('highlight', { id: 'winner', sourceUrl: 'https://one.example/winner', canonicalSourceUrl: 'https://one.example/winner', ...winner }),
      evidence('highlight', { id: 'loser', sourceUrl: 'https://two.example/loser', canonicalSourceUrl: 'https://two.example/loser', ...loser }),
    ];
    return projection(rows, evidenceRows).entries[0].positiveHighlight?.evidenceId;
  }

  it('uses customer, verified, strong band, transaction, confidence, date, then UUID', () => {
    expect(highlighted(
      { authorType: 'customer' },
      { verified: true, reliabilityBand: 'strong', transactionEvidence: true, confidence: 1, publishedAt: '2026-12-01T00:00:00Z' },
    )).toBe('winner');
    expect(highlighted(
      { verified: true },
      { reliabilityBand: 'strong', transactionEvidence: true, confidence: 1, publishedAt: '2026-12-01T00:00:00Z' },
    )).toBe('winner');
    expect(highlighted(
      { reliabilityBand: 'strong' },
      { transactionEvidence: true, confidence: 1, publishedAt: '2026-12-01T00:00:00Z' },
    )).toBe('winner');
    expect(highlighted(
      { transactionEvidence: true },
      { confidence: 1, publishedAt: '2026-12-01T00:00:00Z' },
    )).toBe('winner');
    expect(highlighted(
      { confidence: 0.9, publishedAt: '2026-01-01T00:00:00Z' },
      { confidence: 0.8, publishedAt: '2026-12-01T00:00:00Z' },
    )).toBe('winner');
    expect(highlighted(
      { publishedAt: '2026-03-01T00:00:00Z' },
      { publishedAt: '2026-02-01T00:00:00Z' },
    )).toBe('winner');
    expect(highlighted(
      { id: 'a-evidence' },
      { id: 'b-evidence' },
    )).toBe('a-evidence');
  });
});

describe('filtering, pagination, and query normalization', () => {
  const ids = Array.from({ length: 23 }, (_, index) => `seller-${String(index).padStart(2, '0')}`);
  const merchantRows = ids.flatMap((id, index) => merchant(id, {
    name: `Seller ${String(index).padStart(2, '0')}`,
    category: index % 2 === 0 ? 'A' : 'B',
    governorate: index % 3 === 0 ? 'G1' : 'G2',
  }));
  const evidenceRows = ids.flatMap((id) => positivePair(id));
  evidenceRows.push(evidence('seller-00', {
    sentiment: 'neutral',
    claimType: 'other',
    sourceUrl: 'https://third.example/seller-00',
    canonicalSourceUrl: 'https://third.example/seller-00',
  }));
  const built = projection(merchantRows, evidenceRows);

  it('orders all sellers by canonical name and paginates at 20', () => {
    const first = selectMerchantDirectory(built, {});
    const second = selectMerchantDirectory(built, { page: '2' });
    expect(first.pagination).toEqual({ page: 1, pageSize: 20, total: 23, totalPages: 2 });
    expect(first.items[0].canonicalName).toBe('Seller 00');
    expect(first.items.at(-1)?.canonicalName).toBe('Seller 19');
    expect(second.items.map((entry) => entry.canonicalName)).toEqual(['Seller 20', 'Seller 21', 'Seller 22']);
    expect(selectMerchantDirectory(built, { page: 3 }).items).toEqual([]);
  });

  it('filters by exact category, governorate, and coverage using the same selector', () => {
    const result = selectMerchantDirectory(built, {
      category: ' A ',
      governorate: ' G1 ',
      coverage: 'limited',
    });
    expect(result.items.every((entry) => entry.categoryTags.includes('A'))).toBe(true);
    expect(result.items.map((entry) => entry.id)).not.toContain('seller-00');
    expect(result.pagination.total).toBe(3);
    expect(result.availableFilters).toEqual({
      categories: ['A', 'B'],
      governorates: ['G1', 'G2'],
      coverage: ['limited', 'moderate'],
    });
  });

  it('normalizes equivalent filters into one bounded-cache key', () => {
    expect(normalizeDirectoryQuery({ category: '  Home   Appliances  ' })).toEqual({
      view: 'all',
      page: 1,
      category: 'Home Appliances',
    });
    expect(directoryQueryCacheKey({ category: '  Home   Appliances  ' })).toBe(
      directoryQueryCacheKey({ view: 'all', page: 1, category: 'Home Appliances' }),
    );
  });

  it.each([
    [{ view: 'trusted' }, 'view'],
    [{ page: '0' }, 'page'],
    [{ page: '01' }, 'page'],
    [{ page: ['1', '2'] }, 'page'],
    [{ category: '' }, 'category'],
    [{ governorate: 'bad\u0000value' }, 'governorate'],
    [{ coverage: 'wide' }, 'coverage'],
  ])('rejects invalid normalized query syntax: %j', (input, field) => {
    expect(() => normalizeDirectoryQuery(input)).toThrowError(DirectoryQueryValidationError);
    try {
      normalizeDirectoryQuery(input);
    } catch (error) {
      expect(error).toMatchObject({ field });
    }
  });
});
