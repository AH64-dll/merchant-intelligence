import { describe, expect, it } from 'vitest';
import { assessEvidenceCoverage, assessIdentity, assessReputation } from './assessment';
import type { EvidenceItem, MerchantState } from './types';
import type { Identifier } from './types';

// Trust/rating vocabulary that must never appear in user-facing strings.
const TRUST_WORDS = ['موثوق', 'جيد', 'الحكم', 'التقييمات'];

let nextEvidenceId = 1;
let nextIdentifierId = 1;

function evidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  const id = overrides.id ?? `ev-${nextEvidenceId++}`;
  return {
    id,
    claimType: 'other',
    sentiment: 'neutral',
    summary: 'ملخص الدليل',
    quotedExcerpt: '',
    authorType: 'customer',
    confidence: 0.7,
    reliabilityBand: 'medium',
    language: 'ar',
    publishedAt: '2026-01-15T10:00:00+00:00',
    capturedAt: '2026-02-01T10:00:00+00:00',
    platform: 'example.com',
    url: 'https://example.com/review',
    sourceType: 'unknown',
    sourceCategory: 'other',
    transactionEvidence: false,
    verified: false,
    independent: true,
    duplicateOf: null,
    duplicateRootMerchantId: null,
    claimId: null,
    ...overrides,
    ...(overrides.id !== undefined ? {} : { id }),
  };
}

function identifier(overrides: Partial<Identifier> = {}): Identifier {
  const id = overrides.id ?? nextIdentifierId++;
  return {
    id,
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

function positiveEvidence(count: number, extra: Partial<EvidenceItem> = {}): EvidenceItem[] {
  return Array.from({ length: count }, () =>
    evidence({ claimType: 'successful_purchase', sentiment: 'positive', ...extra }),
  );
}

function negativeEvidence(count: number, extra: Partial<EvidenceItem> = {}): EvidenceItem[] {
  return Array.from({ length: count }, () =>
    evidence({ claimType: 'refund_issue', sentiment: 'negative', ...extra }),
  );
}

function neutralEvidence(count: number, extra: Partial<EvidenceItem> = {}): EvidenceItem[] {
  return Array.from({ length: count }, () => evidence({ sentiment: 'neutral', ...extra }));
}

const NOW = new Date('2026-08-29T12:00:00Z');

const ALL_STATES: MerchantState[] = [
  'VERIFIED_HIGH_CONFIDENCE',
  'VERIFIED_MODERATE_CONFIDENCE',
  'MIXED_REPUTATION',
  'OFFICIAL_WARNING',
  'HIGH_RISK_SIGNALS',
  'REQUIRES_MANUAL_REVIEW',
  'IDENTITY_UNCERTAIN',
  'INSUFFICIENT_DATA',
];

function expectNoTrustLanguage(text: string): void {
  for (const word of TRUST_WORDS) {
    expect(text, `expected no trust word ${word} in: ${text}`).not.toContain(word);
  }
}

describe('assessIdentity', () => {
  it('name_identifier_conflict relation forces uncertain', () => {
    const result = assessIdentity('VERIFIED_HIGH_CONFIDENCE', [identifier(), identifier({ kind: 'website', role: 'owned_site' })], ['name_identifier_conflict']);
    expect(result.level).toBe('uncertain');
  });

  it('IDENTITY_UNCERTAIN state forces uncertain regardless of identifiers', () => {
    const result = assessIdentity('IDENTITY_UNCERTAIN', [identifier(), identifier({ kind: 'website', role: 'owned_site' })], []);
    expect(result.level).toBe('uncertain');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('two distinct high-signal roles establish identity', () => {
    const result = assessIdentity('INSUFFICIENT_DATA', [identifier(), identifier({ kind: 'website', normalizedValue: 'https://shop.example.com', role: 'owned_site' })], []);
    expect(result.level).toBe('established');
  });

  it('one high-signal role only supports identity', () => {
    const result = assessIdentity('INSUFFICIENT_DATA', [identifier()], []);
    expect(result.level).toBe('supported');
  });

  it('two distinct supporting roles support identity', () => {
    const result = assessIdentity('INSUFFICIENT_DATA', [identifier({ kind: 'address', normalizedValue: 'شارع التحرير', role: 'location' }), identifier({ kind: 'marketplace', normalizedValue: 'https://www.olx.com.eg/item/123', role: 'marketplace_profile' })], []);
    expect(result.level).toBe('supported');
  });

  it('no meaningful roles leaves identity uncertain', () => {
    const result = assessIdentity('INSUFFICIENT_DATA', [], []);
    expect(result.level).toBe('uncertain');
  });

  it('duplicate roles do not double-count toward establishment', () => {
    const result = assessIdentity('INSUFFICIENT_DATA', [identifier(), identifier({ value: '01111111111', normalizedValue: '+201111111111', id: 99 })], []);
    expect(result.level).toBe('supported');
  });

  it('never emits a numeric confidence', () => {
    const result = assessIdentity('VERIFIED_HIGH_CONFIDENCE', [identifier(), identifier({ kind: 'website', normalizedValue: 'https://shop.example.com', role: 'owned_site' })], []);
    for (const reason of result.reasons) {
      expect(reason).not.toMatch(/%|\d{2,}/);
    }
  });
});

describe('assessEvidenceCoverage', () => {
  it('none level with zero evidence', () => {
    const coverage = assessEvidenceCoverage([]);
    expect(coverage.level).toBe('none');
    expect(coverage.nonDuplicate).toBe(0);
    expect(coverage.duplicateCount).toBe(0);
    expect(coverage.latestPublishedAt).toBeNull();
    expect(coverage.lastCapturedAt).toBeNull();
  });

  it('limited/moderate/broad bands use distinct non-duplicate sources', () => {
    const one = assessEvidenceCoverage([evidence()]);
    expect(one.level).toBe('limited');

    const three = assessEvidenceCoverage([
      evidence({ url: 'https://a.example/1' }),
      evidence({ url: 'https://b.example/1' }),
      evidence({ url: 'https://c.example/1' }),
    ]);
    expect(three.level).toBe('moderate');
    expect(three.distinctSources).toBe(3);

    const six = assessEvidenceCoverage([
      evidence({ url: 'https://a.example/1' }),
      evidence({ url: 'https://b.example/1' }),
      evidence({ url: 'https://c.example/1' }),
      evidence({ url: 'https://d.example/1' }),
      evidence({ url: 'https://e.example/1' }),
      evidence({ url: 'https://f.example/1' }),
    ]);
    expect(six.level).toBe('broad');
  });

  it('duplicate children count in totals but never as a second independent observation', () => {
    const root = evidence();
    const duplicate = evidence({ duplicateOf: root.id, url: root.url });
    const coverage = assessEvidenceCoverage([root, duplicate]);
    expect(coverage.total).toBe(2);
    expect(coverage.nonDuplicate).toBe(1);
    expect(coverage.duplicateCount).toBe(1);
    expect(coverage.distinctSources).toBe(1);
    expect(coverage.level).toBe('limited');
  });

  it('cross-merchant duplicate children stay visible with attribution data', () => {
    const root = evidence({ id: 'root-1' });
    const crossDuplicate = evidence({ duplicateOf: 'root-1', duplicateRootMerchantId: 'other-merchant' });
    const coverage = assessEvidenceCoverage([root, crossDuplicate]);
    expect(coverage.duplicateCount).toBe(1);
    expect(coverage.nonDuplicate).toBe(1);
  });

  it('tracks undated, reviewed, latest published, and last captured fields', () => {
    const coverage = assessEvidenceCoverage([
      evidence({ publishedAt: null, capturedAt: '2026-03-01T00:00:00Z', verified: true }),
      evidence({ publishedAt: '2026-05-01T00:00:00Z', capturedAt: '2026-06-01T00:00:00Z' }),
    ]);
    expect(coverage.undatedCount).toBe(1);
    expect(coverage.reviewedCount).toBe(1);
    expect(coverage.latestPublishedAt).toBe('2026-05-01T00:00:00Z');
    expect(coverage.lastCapturedAt).toBe('2026-06-01T00:00:00Z');
  });
});

describe('assessReputation — truth table across every state', () => {
  it.each(ALL_STATES)('%s with no evidence → insufficient data', (state) => {
    const result = assessReputation(state, [], NOW);
    expect(result.kind).toBe(state === 'IDENTITY_UNCERTAIN' ? 'IDENTITY_UNCERTAIN' : 'INSUFFICIENT_DATA');
    expectNoTrustLanguage(`${result.headline} ${result.explanation} ${result.caveat ?? ''}`);
  });

  // Direction-driven states: VERIFIED_* and neutral/review states derive
  // reputation purely from non-duplicate evidence direction.
  const DIRECTION_STATES: MerchantState[] = [
    'VERIFIED_HIGH_CONFIDENCE',
    'VERIFIED_MODERATE_CONFIDENCE',
    'MIXED_REPUTATION',
    'REQUIRES_MANUAL_REVIEW',
    'INSUFFICIENT_DATA',
  ];

  it.each(DIRECTION_STATES)(
    '%s with positive-only evidence → positive signals, not a guarantee',
    (state) => {
      const evidenceRows = positiveEvidence(2);
      const result = assessReputation(state, evidenceRows, NOW);
      expect(result.headline).toContain('ليست ضمانة');
      expectNoTrustLanguage(`${result.headline} ${result.explanation}`);
      expect(result.evidenceIds.length).toBeGreaterThan(0);
    },
  );

  it.each(DIRECTION_STATES)(
    '%s with negative-only evidence → negative reports, review sources',
    (state) => {
      const evidenceRows = negativeEvidence(2);
      const result = assessReputation(state, evidenceRows, NOW);
      expect(result.headline).toContain('راجع المصادر');
      expectNoTrustLanguage(`${result.headline} ${result.explanation}`);
    },
  );

  it.each(DIRECTION_STATES)('%s with mixed evidence → mixed assessment', (state) => {
    const result = assessReputation(state, [...positiveEvidence(2), ...negativeEvidence(2)], NOW);
    expect(result.kind).toBe('MIXED_REPUTATION');
    expect(result.headline).toBe('أدلة متضاربة');
  });

  it.each(DIRECTION_STATES)(
    '%s with neutral-only evidence → insufficient data but notable evidence surfaced',
    (state) => {
      const evidenceRows = neutralEvidence(2, { transactionEvidence: true });
      const result = assessReputation(state, evidenceRows, NOW);
      expect(result.kind).toBe('INSUFFICIENT_DATA');
      expect(result.evidenceIds).toEqual(evidenceRows.map((item) => item.id));
    },
  );

  // OFFICIAL_WARNING: with positive-only/negative-only/mixed evidence but no
  // linked warning evidence, the unsupported state defers to manual review.
  it('OFFICIAL_WARNING with positive-only evidence and no warning links → manual review', () => {
    const result = assessReputation('OFFICIAL_WARNING', positiveEvidence(2), NOW);
    expect(result.kind).toBe('REQUIRES_MANUAL_REVIEW');
  });

  it('OFFICIAL_WARNING with negative-only evidence and no warning links → manual review', () => {
    const result = assessReputation('OFFICIAL_WARNING', negativeEvidence(2), NOW);
    expect(result.kind).toBe('REQUIRES_MANUAL_REVIEW');
  });

  it('OFFICIAL_WARNING with mixed evidence and no warning links → manual review', () => {
    const result = assessReputation(
      'OFFICIAL_WARNING',
      [...positiveEvidence(2), ...negativeEvidence(2)],
      NOW,
    );
    expect(result.kind).toBe('REQUIRES_MANUAL_REVIEW');
  });

  it('OFFICIAL_WARNING with neutral-only evidence and no warning links → manual review', () => {
    const result = assessReputation('OFFICIAL_WARNING', neutralEvidence(2), NOW);
    expect(result.kind).toBe('REQUIRES_MANUAL_REVIEW');
  });

  // HIGH_RISK_SIGNALS: risk-claim evidence drives the kind even in other states.
  it('HIGH_RISK_SIGNALS state is respected when risk evidence exists', () => {
    const risk = evidence({ claimType: 'identity_mismatch', sentiment: 'negative', authorType: 'customer' });
    const result = assessReputation('HIGH_RISK_SIGNALS', [risk], NOW);
    expect(result.kind).toBe('HIGH_RISK_SIGNALS');
  });

  it('HIGH_RISK_SIGNALS state without risk evidence and with positive evidence → positive signals', () => {
    const result = assessReputation('HIGH_RISK_SIGNALS', positiveEvidence(2), NOW);
    expect(result.headline).toContain('ليست ضمانة');
  });


  it.each(ALL_STATES)('%s with duplicate-only evidence → insufficient data', (state) => {
    const duplicates = Array.from({ length: 3 }, (_, i) =>
      evidence({ id: `dup-${i}`, duplicateOf: 'root-x', duplicateRootMerchantId: i === 0 ? null : 'other' }),
    );
    const result = assessReputation(state, duplicates, NOW);
    expect(result.kind).toBe(state === 'IDENTITY_UNCERTAIN' ? 'IDENTITY_UNCERTAIN' : 'INSUFFICIENT_DATA');
  });

  it('OFFICIAL_WARNING without supporting evidence → manual review required', () => {
    const result = assessReputation('OFFICIAL_WARNING', positiveEvidence(1), NOW);
    expect(result.kind).toBe('REQUIRES_MANUAL_REVIEW');
    expect(result.explanation).toContain('لا توجد أدلة مرتبطة تدعم ذلك');
  });

  it('OFFICIAL_WARNING with linked regulator warning evidence stays dated and source-linked', () => {
    const warning = evidence({
      claimType: 'official_warning',
      sentiment: 'negative',
      authorType: 'regulator',
      url: 'https://cpa.gov.eg/warning/123',
      publishedAt: '2026-06-01T00:00:00+00:00',
      summary: 'تحذير من الجهة العامة',
    });
    const result = assessReputation('OFFICIAL_WARNING', [warning], NOW);
    expect(result.kind).toBe('OFFICIAL_WARNING');
    expect(result.evidenceIds).toContain(warning.id);
    expect(result.caveat).toContain('مؤرخة');
    expect(result.caveat).not.toContain('إدانة؛ افتح');
  });

  it('stale regulator warning (older than 730 days) is marked dated and old, not hidden', () => {
    const stale = evidence({
      claimType: 'official_warning',
      sentiment: 'negative',
      authorType: 'regulator',
      url: 'https://news.example/old-warning',
      publishedAt: '2014-01-01T00:00:00+00:00',
    });
    const result = assessReputation('OFFICIAL_WARNING', [stale], NOW);
    expect(result.kind).toBe('OFFICIAL_WARNING');
    expect(result.headline).toContain('قديمة');
    expect(result.evidenceIds).toContain(stale.id);
  });

  it('merchant-authored official_warning advice about impersonators is NOT a warning against that merchant', () => {
    const advice = evidence({
      claimType: 'official_warning',
      sentiment: 'neutral',
      authorType: 'merchant',
      url: 'https://rs-store.example/warning',
      summary: 'تنبيه من التاجر: بعض الحسابات تنتحل صفة المتجر',
    });
    const result = assessReputation('OFFICIAL_WARNING', [advice], NOW);
    expect(result.kind).toBe('REQUIRES_MANUAL_REVIEW');
    expect(result.evidenceIds).not.toContain(advice.id);
  });

  it('HIGH_RISK_SIGNALS risk claims become "signals requiring verification"', () => {
    const risk = evidence({
      claimType: 'identity_mismatch',
      sentiment: 'negative',
      authorType: 'customer',
    });
    const result = assessReputation('HIGH_RISK_SIGNALS', [risk], NOW);
    expect(result.kind).toBe('HIGH_RISK_SIGNALS');
    expect(result.headline).toBe('إشارات تتطلب تحققًا');
    expect(result.evidenceIds).toContain(risk.id);
  });

  it('IDENTITY_UNCERTAIN prevents attributing a reputation conclusion even with negative evidence', () => {
    const result = assessReputation('IDENTITY_UNCERTAIN', negativeEvidence(3), NOW);
    expect(result.kind).toBe('IDENTITY_UNCERTAIN');
    expect(result.explanation).toContain('لا يمكن ربط الأدلة');
    expectNoTrustLanguage(`${result.headline} ${result.explanation}`);
  });

  it('VERIFIED_HIGH_CONFIDENCE affects identity only — reputation follows evidence direction', () => {
    const negativeOnly = assessReputation('VERIFIED_HIGH_CONFIDENCE', negativeEvidence(2), NOW);
    expect(negativeOnly.headline).toContain('راجع المصادر');
    const positiveOnly = assessReputation('VERIFIED_HIGH_CONFIDENCE', positiveEvidence(2), NOW);
    expect(positiveOnly.headline).toContain('ليست ضمانة');
  });

  it('INSUFFICIENT_DATA with notable evidence still surfaces the evidence ids', () => {
    const notable = neutralEvidence(2, { verified: true });
    const result = assessReputation('INSUFFICIENT_DATA', notable, NOW);
    expect(result.kind).toBe('INSUFFICIENT_DATA');
    expect(result.evidenceIds).toEqual(notable.map((item) => item.id));
    expect(result.caveat).not.toBeNull();
  });

  it('duplicate children never count as a second independent observation', () => {
    const root = neutralEvidence(1)[0];
    const child = evidence({ ...root, id: 'child-1', duplicateOf: root.id });
    const result = assessReputation('INSUFFICIENT_DATA', [root, child], NOW);
    expect(result.kind).toBe('INSUFFICIENT_DATA');
    // The duplicate child must not escalate the evidence direction.
    expect(result.evidenceIds).not.toContain('child-1');
  });

  it('every returned string is free of trust/rating words', () => {
    const evidenceRows = [
      ...positiveEvidence(2),
      ...negativeEvidence(2),
      evidence({ claimType: 'official_warning', authorType: 'regulator', sentiment: 'negative' }),
    ];
    for (const state of ALL_STATES) {
      const result = assessReputation(state, evidenceRows, NOW);
      expectNoTrustLanguage(result.headline);
      expectNoTrustLanguage(result.explanation);
      if (result.caveat !== null) expectNoTrustLanguage(result.caveat);
    }
  });

  it('never includes an identity percentage anywhere', () => {
    const result = assessReputation('VERIFIED_HIGH_CONFIDENCE', positiveEvidence(1), NOW);
    const full = JSON.stringify(result);
    expect(full).not.toMatch(/"\s*identityConfidence\s*"/);
    expect(full).not.toMatch(/\d+\s*%/);
  });
});
