import { describe, expect, it } from 'vitest';
import { deriveVerdict } from './verdict';
import type { AnalysisPayload, Merchant, MerchantState, SentimentCounts } from './types';
import type { Verdict } from './verdict';

const SENTIMENT_POSITIVE: SentimentCounts = { positive: 3, negative: 1, neutral: 2 };
const SENTIMENT_NEGATIVE: SentimentCounts = { positive: 1, negative: 4, neutral: 0 };

const FULL_ANALYSIS: AnalysisPayload = {
  merchantName: 'merchant-under-test',
  identityConfidence: 0.9,
  evidenceSummary: 'evidence summary text',
  sourceDiversity: 4,
  verifiedClaims: ['verified claim'],
  unverifiedClaims: ['unverified claim'],
  contradictions: [],
  riskSignals: ['signal=delayed refunds; severity=high'],
  positiveSignals: ['signal=fast delivery'],
  missingInformation: ['missing tax id'],
  requiresMoreResearch: false,
  internalState: 'ANALYSED',
  evidenceConfidence: 0.7,
  reputationNotes: 'ملاحظات السمعة',
  fraudRiskNotes: 'ملاحظات الاحتيال',
  consumerSatisfactionNotes: 'ملاحظات رضا العملاء',
};

const NO_RISK_ANALYSIS: AnalysisPayload = {
  ...FULL_ANALYSIS,
  riskSignals: [],
};

function merchantWith(state: MerchantState): Merchant {
  return {
    id: 'test-merchant-id',
    canonicalName: 'merchant-under-test',
    category: 'electronics',
    city: 'cairo',
    governorate: 'cairo',
    identityConfidence: 0.8,
    state,
  };
}

describe('deriveVerdict', () => {
  it('maps OFFICIAL_WARNING to bad tone with fraudRiskNotes reason', () => {
    const verdict = deriveVerdict(merchantWith('OFFICIAL_WARNING'), SENTIMENT_POSITIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('تحذير رسمي');
    expect(verdict.tone).toBe('bad');
    expect(verdict.reason).toBe('ملاحظات الاحتيال');
  });

  it('maps HIGH_RISK_SIGNALS to first riskSignal when available', () => {
    const verdict = deriveVerdict(merchantWith('HIGH_RISK_SIGNALS'), SENTIMENT_NEGATIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('إشارات خطورة عالية');
    expect(verdict.tone).toBe('bad');
    expect(verdict.reason).toBe('signal=delayed refunds; severity=high');
  });

  it('falls back to fraudRiskNotes when HIGH_RISK_SIGNALS has no signals', () => {
    const verdict = deriveVerdict(merchantWith('HIGH_RISK_SIGNALS'), SENTIMENT_NEGATIVE, NO_RISK_ANALYSIS);
    expect(verdict.tone).toBe('bad');
    expect(verdict.reason).toBe('ملاحظات الاحتيال');
  });

  it('maps MIXED_REPUTATION to mixed tone with reputationNotes', () => {
    const verdict = deriveVerdict(merchantWith('MIXED_REPUTATION'), SENTIMENT_POSITIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('سمعة متضاربة');
    expect(verdict.tone).toBe('mixed');
    expect(verdict.reason).toBe('ملاحظات السمعة');
  });

  it('maps REQUIRES_MANUAL_REVIEW to warn tone with reputationNotes', () => {
    const verdict = deriveVerdict(merchantWith('REQUIRES_MANUAL_REVIEW'), SENTIMENT_POSITIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('يحتاج مراجعة يدوية');
    expect(verdict.tone).toBe('warn');
    expect(verdict.reason).toBe('ملاحظات السمعة');
  });

  it('maps VERIFIED_HIGH_CONFIDENCE with more positive to good tone', () => {
    const verdict = deriveVerdict(merchantWith('VERIFIED_HIGH_CONFIDENCE'), SENTIMENT_POSITIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('موثوق — ثقة عالية');
    expect(verdict.tone).toBe('good');
  });

  it('maps VERIFIED_HIGH_CONFIDENCE with complaints to mixed tone', () => {
    const verdict = deriveVerdict(merchantWith('VERIFIED_HIGH_CONFIDENCE'), SENTIMENT_NEGATIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('هوية موثوقة مع شكاوى');
    expect(verdict.tone).toBe('mixed');
  });

  it('maps VERIFIED_MODERATE_CONFIDENCE with more positive to good tone', () => {
    const verdict = deriveVerdict(merchantWith('VERIFIED_MODERATE_CONFIDENCE'), SENTIMENT_POSITIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('جيد — ثقة متوسطة');
    expect(verdict.tone).toBe('good');
  });

  it('maps VERIFIED_MODERATE_CONFIDENCE with complaints to warn tone', () => {
    const verdict = deriveVerdict(merchantWith('VERIFIED_MODERATE_CONFIDENCE'), SENTIMENT_NEGATIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('ثقة متوسطة مع شكاوى');
    expect(verdict.tone).toBe('warn');
  });

  it('maps IDENTITY_UNCERTAIN to unknown tone with sentiment-count reason', () => {
    const verdict = deriveVerdict(merchantWith('IDENTITY_UNCERTAIN'), SENTIMENT_POSITIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('هوية غير مؤكدة');
    expect(verdict.tone).toBe('unknown');
    expect(verdict.reason).toBe('إيجابي: 3 · سلبي: 1 · محايد: 2');
  });

  it('maps INSUFFICIENT_DATA to unknown tone regardless of analysis', () => {
    const verdict = deriveVerdict(merchantWith('INSUFFICIENT_DATA'), SENTIMENT_NEGATIVE, FULL_ANALYSIS);
    expect(verdict.label).toBe('بيانات غير كافية');
    expect(verdict.tone).toBe('unknown');
    expect(verdict.reason).toBe('إيجابي: 1 · سلبي: 4 · محايد: 0');
  });

  it('returns insufficient-data verdict when analysis is null even for verified state', () => {
    const verdict = deriveVerdict(merchantWith('VERIFIED_HIGH_CONFIDENCE'), SENTIMENT_POSITIVE, null);
    expect(verdict.label).toBe('بيانات غير كافية');
    expect(verdict.tone).toBe('unknown');
    expect(verdict.reason).toBe('إيجابي: 3 · سلبي: 1 · محايد: 2');
  });
});

describe('deriveVerdict — full truth table (8 states × sentiment × analysis)', () => {
  const SENTIMENTS = {
    'positive>negative': { positive: 3, negative: 1, neutral: 2 },
    'positive<negative': { positive: 1, negative: 4, neutral: 0 },
    'positive==negative': { positive: 2, negative: 2, neutral: 1 },
  } as const;
  const STATES = [
    'OFFICIAL_WARNING',
    'HIGH_RISK_SIGNALS',
    'MIXED_REPUTATION',
    'REQUIRES_MANUAL_REVIEW',
    'VERIFIED_HIGH_CONFIDENCE',
    'VERIFIED_MODERATE_CONFIDENCE',
    'IDENTITY_UNCERTAIN',
    'INSUFFICIENT_DATA',
  ] as const;

  const fallback = (relation: keyof typeof SENTIMENTS): string => {
    const s = SENTIMENTS[relation];
    return `إيجابي: ${s.positive} · سلبي: ${s.negative} · محايد: ${s.neutral}`;
  };

  // [state, sentimentRelation, expectedLabel, expectedTone, expectedReason]
  const WITH_ANALYSIS: [MerchantState, keyof typeof SENTIMENTS, string, Verdict['tone'], string][] = [
    ['OFFICIAL_WARNING', 'positive>negative', 'تحذير رسمي', 'bad', 'ملاحظات الاحتيال'],
    ['OFFICIAL_WARNING', 'positive<negative', 'تحذير رسمي', 'bad', 'ملاحظات الاحتيال'],
    ['OFFICIAL_WARNING', 'positive==negative', 'تحذير رسمي', 'bad', 'ملاحظات الاحتيال'],
    ['HIGH_RISK_SIGNALS', 'positive>negative', 'إشارات خطورة عالية', 'bad', 'signal=delayed refunds; severity=high'],
    ['HIGH_RISK_SIGNALS', 'positive<negative', 'إشارات خطورة عالية', 'bad', 'signal=delayed refunds; severity=high'],
    ['HIGH_RISK_SIGNALS', 'positive==negative', 'إشارات خطورة عالية', 'bad', 'signal=delayed refunds; severity=high'],
    ['MIXED_REPUTATION', 'positive>negative', 'سمعة متضاربة', 'mixed', 'ملاحظات السمعة'],
    ['MIXED_REPUTATION', 'positive<negative', 'سمعة متضاربة', 'mixed', 'ملاحظات السمعة'],
    ['MIXED_REPUTATION', 'positive==negative', 'سمعة متضاربة', 'mixed', 'ملاحظات السمعة'],
    ['REQUIRES_MANUAL_REVIEW', 'positive>negative', 'يحتاج مراجعة يدوية', 'warn', 'ملاحظات السمعة'],
    ['REQUIRES_MANUAL_REVIEW', 'positive<negative', 'يحتاج مراجعة يدوية', 'warn', 'ملاحظات السمعة'],
    ['REQUIRES_MANUAL_REVIEW', 'positive==negative', 'يحتاج مراجعة يدوية', 'warn', 'ملاحظات السمعة'],
    ['VERIFIED_HIGH_CONFIDENCE', 'positive>negative', 'موثوق — ثقة عالية', 'good', 'ملاحظات السمعة'],
    ['VERIFIED_HIGH_CONFIDENCE', 'positive<negative', 'هوية موثوقة مع شكاوى', 'mixed', 'ملاحظات السمعة'],
    ['VERIFIED_HIGH_CONFIDENCE', 'positive==negative', 'هوية موثوقة مع شكاوى', 'mixed', 'ملاحظات السمعة'],
    ['VERIFIED_MODERATE_CONFIDENCE', 'positive>negative', 'جيد — ثقة متوسطة', 'good', 'ملاحظات السمعة'],
    ['VERIFIED_MODERATE_CONFIDENCE', 'positive<negative', 'ثقة متوسطة مع شكاوى', 'warn', 'ملاحظات السمعة'],
    ['VERIFIED_MODERATE_CONFIDENCE', 'positive==negative', 'ثقة متوسطة مع شكاوى', 'warn', 'ملاحظات السمعة'],
    ['IDENTITY_UNCERTAIN', 'positive>negative', 'هوية غير مؤكدة', 'unknown', fallback('positive>negative')],
    ['IDENTITY_UNCERTAIN', 'positive<negative', 'هوية غير مؤكدة', 'unknown', fallback('positive<negative')],
    ['IDENTITY_UNCERTAIN', 'positive==negative', 'هوية غير مؤكدة', 'unknown', fallback('positive==negative')],
    ['INSUFFICIENT_DATA', 'positive>negative', 'بيانات غير كافية', 'unknown', fallback('positive>negative')],
    ['INSUFFICIENT_DATA', 'positive<negative', 'بيانات غير كافية', 'unknown', fallback('positive<negative')],
    ['INSUFFICIENT_DATA', 'positive==negative', 'بيانات غير كافية', 'unknown', fallback('positive==negative')],
  ];

  it.each(WITH_ANALYSIS)(
    '%s with %s and a present analysis → %j (%j)',
    (state, relation, label, tone, reason) => {
      const verdict = deriveVerdict(merchantWith(state), SENTIMENTS[relation], FULL_ANALYSIS);
      expect(verdict.label).toBe(label);
      expect(verdict.tone).toBe(tone);
      expect(verdict.reason).toBe(reason);
    },
  );

  it.each(STATES)('%s with analysis === null → insufficient-data verdict for every sentiment', (state) => {
    for (const sentiment of Object.values(SENTIMENTS)) {
      const verdict = deriveVerdict(merchantWith(state), sentiment, null);
      expect(verdict).toEqual({
        label: 'بيانات غير كافية',
        tone: 'unknown',
        reason: `إيجابي: ${sentiment.positive} · سلبي: ${sentiment.negative} · محايد: ${sentiment.neutral}`,
      });
    }
  });

  it('falls back to the exact sentiment-count format when the relevant note is empty or blank', () => {
    const blankAnalysis: AnalysisPayload = {
      ...FULL_ANALYSIS,
      riskSignals: [],
      reputationNotes: '   ',
      fraudRiskNotes: '',
    };
    expect(deriveVerdict(merchantWith('OFFICIAL_WARNING'), SENTIMENT_POSITIVE, blankAnalysis).reason)
      .toBe('إيجابي: 3 · سلبي: 1 · محايد: 2');
    expect(deriveVerdict(merchantWith('MIXED_REPUTATION'), SENTIMENT_POSITIVE, blankAnalysis).reason)
      .toBe('إيجابي: 3 · سلبي: 1 · محايد: 2');
    expect(deriveVerdict(merchantWith('HIGH_RISK_SIGNALS'), SENTIMENT_POSITIVE, blankAnalysis).reason)
      .toBe('إيجابي: 3 · سلبي: 1 · محايد: 2');
  });
});
