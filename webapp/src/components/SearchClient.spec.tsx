import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SearchClient } from './SearchClient';
import { SearchIndex } from '@/lib/search';
import type { IndexData } from '@/lib/db';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

function makeMockIndexData(merchantCount = 2): IndexData {
  const merchants = Array.from({ length: merchantCount }, (_, i) => ({
    id: `merchant-${i + 1}`,
    canonicalName: i === 0 ? 'Cairo Electronics' : `Store Branch ${i + 1}`,
    category: 'consumer_electronics',
    city: 'Cairo',
    governorate: 'cairo',
    identityConfidence: 0.95,
    state: 'VERIFIED_HIGH_CONFIDENCE' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  }));

  return {
    merchants,
    identifiers: [
      {
        merchantId: 'merchant-1',
        kind: 'phone',
        normalized: '01000000000',
      },
    ],
    aliases: [
      {
        merchantId: 'merchant-1',
        alias: 'Cairo Elec',
      },
    ],
    claims: [],
    evidence: [],
    sources: [],
  };
}

describe('SearchClient', () => {
  it('renders design empty search panel when no query is present', () => {
    const html = renderToStaticMarkup(
      createElement(SearchClient, { locale: 'ar', initialQ: '' }),
    );
    expect(html).toContain('search-empty-panel');
    expect(html).toContain('large-empty-icon');
    expect(html).toContain('ابدأ البحث عن تاجر');
    expect(html).toContain('data-notice');
    expect(html).toContain('search-tips');
  });

  it('renders English empty search panel and tips when locale is en', () => {
    const html = renderToStaticMarkup(
      createElement(SearchClient, { locale: 'en', initialQ: '' }),
    );
    expect(html).toContain('Start your vendor search');
    expect(html).toContain('Scope of search and available data');
    expect(html).toContain('Tips for better search results');
  });

  it('renders busy design panel when waiting for search index', () => {
    const html = renderToStaticMarkup(
      createElement(SearchClient, { locale: 'ar', initialQ: 'b tech' }),
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('search-empty-panel');
    expect(html).toContain('جارٍ البحث في السجلات…');
  });

  it('renders query-too-long error panel for oversized query', () => {
    const oversized = 'a'.repeat(301);
    const html = renderToStaticMarkup(
      createElement(SearchClient, { locale: 'en', initialQ: oversized }),
    );
    expect(html).toContain('Query too long');
    expect(html).toContain('300 characters maximum');
  });

  it('renders tiered hits in index-panel when matches exist', () => {
    const mockIndex = new SearchIndex(makeMockIndexData());
    const html = renderToStaticMarkup(
      createElement(SearchClient, {
        locale: 'ar',
        initialQ: 'Cairo Electronics',
        initialIndex: mockIndex,
      }),
    );
    expect(html).toContain('index-panel');
    expect(html).toContain('index-toolbar');
    expect(html).toContain('التجار المطابقون');
    expect(html).toContain('تطابق تام في الاسم');
    expect(html).toContain('Cairo Electronics');
    expect(html).toContain('سبب المطابقة');
    expect(html).toContain('data-notice');
  });

  it('renders empty-panel when query has no matching records', () => {
    const mockIndex = new SearchIndex(makeMockIndexData());
    const html = renderToStaticMarkup(
      createElement(SearchClient, {
        locale: 'en',
        initialQ: 'Nonexistent Store XYZ',
        initialIndex: mockIndex,
      }),
    );
    expect(html).toContain('search-empty-panel');
    expect(html).toContain('No records found for this query');
    expect(html).toContain('Explore merchant directory');
  });

  it('renders pagination when results exceed page size', () => {
    const mockIndex = new SearchIndex(makeMockIndexData(25));
    const html = renderToStaticMarkup(
      createElement(SearchClient, {
        locale: 'en',
        initialQ: 'Store Branch',
        initialIndex: mockIndex,
      }),
    );
    expect(html).toContain('index-panel');
    expect(html).toContain('pagination');
    expect(html).toContain('aria-current="page"');
  });
});
