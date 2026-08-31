import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ReputationAssessment } from '@/lib/assessment';
import type { EvidenceItem, Identifier } from '@/lib/types';
import {
  MerchantEvidenceOverview,
  selectDecisionEvidence,
} from './MerchantEvidenceOverview';

function evidenceFixture(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: 'evidence-1',
    claimType: 'customer_experience',
    sentiment: 'neutral',
    summary: 'ملخص محايد',
    quotedExcerpt: '',
    authorType: 'customer',
    confidence: 0.7,
    reliabilityBand: 'moderate',
    language: 'ar',
    publishedAt: '2026-01-01T00:00:00Z',
    capturedAt: '2026-01-02T00:00:00Z',
    platform: 'facebook',
    url: 'https://example.com/evidence-1',
    sourceType: 'facebook_post',
    sourceCategory: 'social',
    transactionEvidence: false,
    verified: false,
    independent: true,
    duplicateOf: null,
    duplicateRootMerchantId: null,
    claimId: null,
    ...overrides,
  };
}

function addressFixture(id: number, value: string, normalizedValue: string): Identifier {
  return {
    id,
    value,
    normalizedValue,
    kind: 'address',
    confidence: 0.8,
    role: 'location',
    searchable: true,
    displayable: true,
  };
}

function reputationFixture(overrides: Partial<ReputationAssessment>): ReputationAssessment {
  return {
    kind: 'MIXED_REPUTATION',
    headline: 'أدلة متضاربة',
    explanation: 'راجع الأدلة.',
    evidenceIds: [],
    caveat: null,
    ...overrides,
  };
}

describe('selectDecisionEvidence', () => {
  it('puts assessment-backed risk evidence before newer ordinary evidence', () => {
    const evidence = [
      evidenceFixture({
        id: 'risk-old',
        claimType: 'identity_mismatch',
        sentiment: 'negative',
        publishedAt: '2024-01-01T00:00:00Z',
      }),
      evidenceFixture({
        id: 'positive-new',
        sentiment: 'positive',
        publishedAt: '2026-07-01T00:00:00Z',
      }),
      evidenceFixture({
        id: 'neutral-new',
        publishedAt: '2026-08-01T00:00:00Z',
      }),
    ];
    const reputation = reputationFixture({
      kind: 'HIGH_RISK_SIGNALS',
      evidenceIds: ['risk-old'],
    });

    expect(selectDecisionEvidence(evidence, reputation).map((item) => item.id)).toEqual([
      'risk-old',
      'neutral-new',
      'positive-new',
    ]);
  });

  it('adds other independent directions before repeating positive assessment rows', () => {
    const evidence = [
      evidenceFixture({ id: 'positive-priority-1', sentiment: 'positive' }),
      evidenceFixture({ id: 'positive-priority-2', sentiment: 'positive' }),
      evidenceFixture({
        id: 'negative-new',
        sentiment: 'negative',
        publishedAt: '2026-08-10T00:00:00Z',
      }),
      evidenceFixture({
        id: 'neutral-new',
        sentiment: 'neutral',
        publishedAt: '2026-08-09T00:00:00Z',
      }),
    ];
    const reputation = reputationFixture({
      evidenceIds: ['positive-priority-1', 'positive-priority-2'],
    });

    expect(selectDecisionEvidence(evidence, reputation).map((item) => item.id)).toEqual([
      'positive-priority-1',
      'negative-new',
      'neutral-new',
    ]);
  });

  it('never uses duplicate rows as newest fallback evidence', () => {
    const evidence = [
      evidenceFixture({ id: 'independent', publishedAt: '2026-01-01T00:00:00Z' }),
      evidenceFixture({
        id: 'duplicate-new',
        publishedAt: '2026-08-20T00:00:00Z',
        independent: false,
        duplicateOf: 'independent',
      }),
    ];

    expect(selectDecisionEvidence(evidence, reputationFixture({})).map((item) => item.id)).toEqual([
      'independent',
    ]);
  });
});

describe('MerchantEvidenceOverview', () => {
  it('renders recorded-location semantics, non-duplicate summaries, and Arabic source labels', () => {
    const evidence = [
      evidenceFixture({
        id: 'negative',
        sentiment: 'negative',
        sourceCategory: 'customer_report',
        url: 'https://example.com/negative',
      }),
      evidenceFixture({
        id: 'positive',
        sentiment: 'positive',
        sourceCategory: 'social',
        url: 'https://example.com/positive',
      }),
      evidenceFixture({
        id: 'neutral',
        sentiment: 'neutral',
        sourceCategory: 'social',
        url: 'https://example.com/neutral',
      }),
      evidenceFixture({
        id: 'duplicate',
        independent: false,
        duplicateOf: 'neutral',
        sourceCategory: 'social',
      }),
    ];
    const identifiers = [
      addressFixture(1, 'القاهرة', 'cairo'),
      addressFixture(2, 'Cairo', 'cairo'),
      addressFixture(3, 'الإسكندرية', 'alexandria'),
    ];
    const html = renderToStaticMarkup(
      createElement(MerchantEvidenceOverview, {
        state: 'VERIFIED_HIGH_CONFIDENCE',
        identifiers,
        evidence,
        sentiment: { positive: 1, negative: 1, neutral: 1 },
        snapshotGeneratedAt: '2026-08-30T00:00:00Z',
      }),
    );

    expect(html).toContain('توجد عدة مواقع مسجلة');
    expect(html).toContain('>2</span> سجلات عناوين مختلفة');
    expect(html).not.toContain('فرع');
    expect(html).toContain('إجمالي الأدلة');
    expect(html).toContain('أدلة غير مكررة');
    expect(html).toContain('مصادر مختلفة غير مكررة');
    expect(html).toContain('إجمالي الأدلة</dt><dd dir="ltr">4</dd>');
    expect(html).toContain('أدلة غير مكررة</dt><dd dir="ltr">3</dd>');
    expect(html).toContain('مصادر مختلفة غير مكررة</dt><dd dir="ltr">3</dd>');
    expect(html).toContain('تقرير عميل');
    expect(html).toContain('شبكات اجتماعية');
    expect(html).toContain('شبكات اجتماعية: <span dir="ltr">2</span>');
    expect(html).toContain('أحدث نشر معروف');
    expect(html).toContain('آخر التقاط');
    expect(html).toContain('تاريخ توليد اللقطة');
    expect(html).not.toContain('VERIFIED_HIGH_CONFIDENCE');
    expect(html).not.toContain('identityConfidence');
    expect(html).not.toContain('reliabilityBand');
    expect(html).not.toContain('confidence');
    expect(html).not.toContain('strong');
  });

  it('renders at most three highlights and targets the matching evidence anchors', () => {
    const evidence = [
      evidenceFixture({ id: 'negative', sentiment: 'negative', summary: 'تجربة سلبية' }),
      evidenceFixture({ id: 'positive', sentiment: 'positive', summary: 'تجربة إيجابية' }),
      evidenceFixture({ id: 'neutral', sentiment: 'neutral', summary: 'معلومة محايدة' }),
      evidenceFixture({ id: 'fourth', sentiment: 'neutral', summary: 'معلومة رابعة' }),
    ];
    const html = renderToStaticMarkup(
      createElement(MerchantEvidenceOverview, {
        state: 'VERIFIED_HIGH_CONFIDENCE',
        identifiers: [],
        evidence,
        sentiment: { positive: 1, negative: 1, neutral: 2 },
        snapshotGeneratedAt: '2026-08-30T00:00:00Z',
      }),
    );
    const links = html.match(/href="#evidence-[^"]+"/g) ?? [];

    expect(links).toHaveLength(3);
    for (const href of links) expect(href).toMatch(/^href="#evidence-[^"]+"$/);
  });
});
