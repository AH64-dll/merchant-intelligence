import { describe, expect, it } from 'vitest';
import {
  COVERAGE_LEVEL_LABELS,
  IDENTITY_LEVEL_LABELS,
  matchedOnLabel,
  reliabilityBandLabel,
  STATE_LABELS,
} from './labels';
import type { MatchedOn } from './types';

const TRUST_WORDS = ['موثوق', 'جيد', 'الحكم', 'التقييمات'];

describe('reliabilityBandLabel', () => {
  it.each([
    ['strong', 'تقدير قوة آلي: قوية'],
    ['very_strong', 'تقدير قوة آلي: قوية جدًا'],
    ['medium', 'تقدير قوة آلي: متوسطة'],
    ['weak', 'تقدير قوة آلي: ضعيفة'],
    ['unknown_band', 'unknown_band'],
    ['', ''],
  ])('maps %s to its label', (band, expected) => {
    expect(reliabilityBandLabel(band)).toBe(expected);
  });

  it('never presents the band as a standalone trust quality', () => {
    for (const label of [reliabilityBandLabel('strong'), reliabilityBandLabel('very_strong')]) {
      expect(label).toContain('تقدير قوة آلي');
    }
  });
});

describe('matchedOnLabel', () => {
  it('labels host fallback matches with dedicated phrases', () => {
    expect(matchedOnLabel('website-host')).toBe('تطابق نطاق الموقع');
    expect(matchedOnLabel('marketplace-host')).toBe('تطابق نطاق الماركت بلايس');
  });

  it('labels the new name-match tiers', () => {
    expect(matchedOnLabel('exact_name')).toBe('تطابق اسم تام');
    expect(matchedOnLabel('exact_alias')).toBe('تطابق اسم بديل');
    expect(matchedOnLabel('normalized_variant')).toBe('صيغة قريبة من الاسم');
    expect(matchedOnLabel('partial_name')).toBe('تطابق جزئي في الاسم');
    expect(matchedOnLabel('typo')).toBe('تشابه تقريبي في الاسم');
  });

  it('keeps identifier kind labels intact', () => {
    expect(matchedOnLabel('phone')).toBe('هاتف');
    expect(matchedOnLabel('google_maps')).toBe('خرائط جوجل');
  });

  it('covers every name-tier MatchedOn value', () => {
    const nameTiers: MatchedOn[] = [
      'exact_name',
      'exact_alias',
      'normalized_variant',
      'partial_name',
      'typo',
    ];
    for (const tier of nameTiers) {
      expect(matchedOnLabel(tier)).not.toBe(tier);
    }
  });
});

describe('assessment labels', () => {
  it('provides Arabic labels for every identity level', () => {
    expect(Object.keys(IDENTITY_LEVEL_LABELS).sort()).toEqual(
      ['established', 'supported', 'uncertain'].sort(),
    );
    expect(IDENTITY_LEVEL_LABELS.uncertain).toBe('هوية غير مؤكدة');
  });

  it('provides Arabic labels for every coverage level', () => {
    expect(Object.keys(COVERAGE_LEVEL_LABELS).sort()).toEqual(
      ['none', 'limited', 'moderate', 'broad'].sort(),
    );
  });

  it('keeps state labels free of trust language', () => {
    for (const label of Object.values(STATE_LABELS)) {
      for (const word of TRUST_WORDS) {
        expect(label).not.toContain(word);
      }
    }
  });
});
