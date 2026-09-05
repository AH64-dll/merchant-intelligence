import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EvidenceCard } from './EvidenceCard';
import { FooterContent } from './SiteFooter';
import { safeHttpUrl } from './display';
import type { EvidenceItem } from '../lib/types';

function evidenceFixture(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: 'ev-1',
    claimType: 'customer_complaint',
    sentiment: 'negative',
    summary: 'ملخص الدليل',
    quotedExcerpt: 'مقتطف مقتبس',
    authorType: 'customer',
    confidence: 0.8,
    reliabilityBand: 'strong',
    language: 'ar',
    publishedAt: '2024-01-15T00:00:00+00:00',
    capturedAt: '2026-08-23T16:30:00+00:00',
    platform: 'facebook',
    url: 'https://example.com/post/1',
    sourceType: 'facebook_post',
    sourceCategory: 'social',
    transactionEvidence: false,
    verified: false,
    independent: true,
    duplicateOf: null,
    duplicateRootMerchantId: null,
    claimId: null,
    citations: [],
    isMeaningful: true,
    isDuplicateChild: false,
    ...overrides,
  };
}

function renderEvidence(overrides: Partial<EvidenceItem> = {}): string {
  return renderToStaticMarkup(createElement(EvidenceCard, { evidence: evidenceFixture(overrides) }));
}

describe('EvidenceCard safe links', () => {
  it('renders an anchor with target/rel only for http/https URLs', () => {
    const html = renderEvidence({ url: 'https://example.com/post/1' });
    expect(html).toContain('href="https://example.com/post/1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders http URLs as anchors too', () => {
    const html = renderEvidence({ url: 'http://example.com/old' });
    expect(html).toContain('<a');
    expect(html).toContain('href="http://example.com/old"');
  });

  it('renders whois:// as text, never as an anchor', () => {
    const html = renderEvidence({ url: 'whois://whois.arin.net/1.2.3.4' });
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
    expect(html).toContain('whois://whois.arin.net/1.2.3.4');
  });

  it('renders javascript: URLs as text only', () => {
    const html = renderEvidence({ url: 'javascript:alert(1)' });
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('EvidenceCard provenance labels', () => {
  it('separates author-provenance label from duplicate attribution', () => {
    const html = renderEvidence();
    expect(html).toContain('مصدر الدليل: عميل');
    expect(html).toContain('ليس مكررًا');
    expect(html).not.toContain('مكرر — الجذر');
  });

  it('shows duplicate attribution inside details for duplicates', () => {
    const html = renderEvidence({ duplicateOf: 'ev-root', independent: false });
    expect(html).toContain('مكرر — الجذر الأصلي: ev-root');
    expect(html).not.toContain('ليس مكررًا');
  });

  it('flags cross-merchant duplicate roots with a caveat', () => {
    const html = renderEvidence({ duplicateOf: 'ev-root', duplicateRootMerchantId: 'm-2' });
    expect(html).toContain('مسجَّل على تاجر آخر');
  });
});

describe('EvidenceCard freshness', () => {
  it('shows the captured date always and publication date when known', () => {
    const html = renderEvidence();
    expect(html).toContain('التقط:');
    expect(html).toContain('نُشر:');
    expect(html).toMatch(/dateTime="2024-01-15"/);
    expect(html).toMatch(/dateTime="2026-08-23"/);
  });

  it('shows explicit unknown publication wording when undated', () => {
    const html = renderEvidence({ publishedAt: null });
    expect(html).toContain('غير مؤرَّخ');
    expect(html).toContain('غير معروف');
  });

  it('marks publication older than 730 days as stale', () => {
    const html = renderEvidence({ publishedAt: '2020-01-01T00:00:00+00:00' });
    expect(html).toContain('تاريخ قديم');
  });
});

describe('EvidenceCard excerpt and details', () => {
  it('renders the quoted excerpt', () => {
    const html = renderEvidence();
    expect(html).toContain('مقتطف مقتبس');
  });

  it('contains a details disclosure with technical provenance', () => {
    const html = renderEvidence();
    expect(html).toContain('<details');
    expect(html).toContain('تفاصيل المصدر والتوثيق');
    expect(html).toContain('facebook_post');
    expect(html).toContain('تقدير قوة آلي');
    expect(html).toContain('جولة تحقق آلية');
  });
});

describe('FooterContent freshness', () => {
  it('shows snapshot date and staleness warning beyond 7 days', () => {
    const stale = renderToStaticMarkup(
      createElement(FooterContent, { generatedAt: '2026-01-01T00:00:00+00:00', stale: true }),
    );
    expect(stale).toContain('2026-01-01');
    expect(stale).toContain('أقدم من أسبوع');
    const fresh = renderToStaticMarkup(
      createElement(FooterContent, { generatedAt: '2026-08-25T00:00:00+00:00', stale: false }),
    );
    expect(fresh).not.toContain('أقدم من أسبوع');
  });
});
