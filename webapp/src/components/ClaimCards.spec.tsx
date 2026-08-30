import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ClaimCards } from './ClaimCards';
import { SentimentBar } from './SentimentBar';
import { IdentifierList } from './IdentifierList';
import { RelatedMerchants } from './RelatedMerchants';
import type { ClaimItem, Identifier, RelatedMerchant, SentimentCounts } from '../lib/types';

function claimFixture(overrides: Partial<ClaimItem> = {}): ClaimItem {
  return {
    id: 'claim-1',
    claimType: 'official_warning',
    sentiment: 'negative',
    summary: 'ملخص الادعاء',
    independentSourceCount: 2,
    mentionCount: 7,
    evidenceIds: ['ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5', 'ev-6'],
    ...overrides,
  };
}

function identifierFixture(overrides: Partial<Identifier> = {}): Identifier {
  return {
    id: 1,
    value: '01000000000',
    normalizedValue: '+201000000000',
    kind: 'phone',
    confidence: 0.9,
    role: 'contact',
    searchable: true,
    displayable: true,
    ...overrides,
  };
}

describe('ClaimCards', () => {
  it('renders localized Arabic claim type labels, not snake_case', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimCards, { claims: [claimFixture()] }),
    );
    expect(html).toContain('تحذير رسمي');
    expect(html).not.toContain('official_warning');
  });

  it('renders as semantic article/dl cards, not a table', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimCards, { claims: [claimFixture()] }),
    );
    expect(html).toContain('<article');
    expect(html).toContain('<dl');
    expect(html).not.toContain('<table');
  });

  it('shows non-duplicate source count, observations, and up to 5 evidence anchors', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimCards, { claims: [claimFixture()] }),
    );
    expect(html).toContain('مصادر غير مكررة');
    expect(html).toContain('إجمالي الملاحظات');
    expect(html.match(/#evidence-ev-\d/g)?.length).toBe(5);
  });

  it('anchors point at the evidence-card ids', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimCards, { claims: [claimFixture({ evidenceIds: ['ev-9'] })] }),
    );
    expect(html).toContain('href="#evidence-ev-9"');
  });

  it('returns null with no claims', () => {
    const html = renderToStaticMarkup(createElement(ClaimCards, { claims: [] }));
    expect(html).toBe('');
  });
});

describe('SentimentBar', () => {
  it('uses the safe section name and separates duplicate count', () => {
    const counts: SentimentCounts = { positive: 3, negative: 2, neutral: 1 };
    const html = renderToStaticMarkup(
      createElement(SentimentBar, { sentiment: counts, duplicateCount: 4 }),
    );
    expect(html).toContain('اتجاه الأدلة');
    expect(html).toContain('دليل مكرر');
    expect(html).toContain('غير المكررة فقط');
    expect(html).not.toContain('التقييمات');
  });

  it('states the zero-duplicate basis explicitly', () => {
    const counts: SentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    const html = renderToStaticMarkup(
      createElement(SentimentBar, { sentiment: counts, duplicateCount: 0 }),
    );
    expect(html).toContain('لا توجد أدلة مكررة مستثناة');
  });
});

describe('IdentifierList', () => {
  it('shows ORIGINAL value with dir=ltr isolation and role label', () => {
    const html = renderToStaticMarkup(
      createElement(IdentifierList, { identifiers: [identifierFixture()] }),
    );
    // Visible text is the ORIGINAL stored value…
    expect(html).toContain('>01000000000<');
    // …the normalized value appears only inside the tel: action target.
    expect(html).not.toMatch(/>[^<]*\+201000000000/);
    expect(html).toContain('وسيلة تواصل');
  });

  it('makes phones actionable via tel: with the normalized target', () => {
    const html = renderToStaticMarkup(
      createElement(IdentifierList, { identifiers: [identifierFixture()] }),
    );
    expect(html).toContain('href="tel:+201000000000"');
  });

  it('makes emails actionable via mailto:', () => {
    const html = renderToStaticMarkup(
      createElement(IdentifierList, {
        identifiers: [identifierFixture({ kind: 'email', value: 'info@merchant.eg', normalizedValue: 'info@merchant.eg' })],
      }),
    );
    expect(html).toContain('href="mailto:info@merchant.eg"');
  });

  it('makes website values safe external links', () => {
    const html = renderToStaticMarkup(
      createElement(IdentifierList, {
        identifiers: [
          identifierFixture({
            kind: 'website',
            value: 'https://merchant.eg',
            normalizedValue: 'https://merchant.eg',
            role: 'owned_site',
          }),
        ],
      }),
    );
    expect(html).toContain('href="https://merchant.eg"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('موقع تابع للتاجر');
  });

  it('hides quarantined / non-displayable identifiers', () => {
    const hidden = renderToStaticMarkup(
      createElement(IdentifierList, {
        identifiers: [identifierFixture({ displayable: false })],
      }),
    );
    expect(hidden).toBe('');
    const shown = renderToStaticMarkup(
      createElement(IdentifierList, {
        identifiers: [identifierFixture()],
      }),
    );
    expect(shown).toContain('01000000000');
  });
});

describe('RelatedMerchants', () => {
  it('uses Next Link and safe framing without confidence percentages', () => {
    const related: RelatedMerchant[] = [
      { id: 'm-2', name: 'تاجر آخر', relation: 'identifier_collision', rationale: 'تطابق رقم هاتف', confidence: 0.42 },
    ];
    const html = renderToStaticMarkup(createElement(RelatedMerchants, { related }));
    expect(html).toMatch(/href="\/merchant\/m-2"/);
    expect(html).toContain('تاجر آخر');
    expect(html).not.toContain('42');
    expect(html).not.toContain('0.42');
  });

  it('returns null with no relations', () => {
    const html = renderToStaticMarkup(createElement(RelatedMerchants, { related: [] }));
    expect(html).toBe('');
  });
});
