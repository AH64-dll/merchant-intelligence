import { describe, expect, it } from 'vitest';
import {
  authorTypeLabel,
  checkStatusLabel,
  claimTypeLabel,
  COVERAGE_LEVEL_LABELS,
  coverageLevelLabel,
  IDENTITY_LEVEL_LABELS,
  identityLevelLabel,
  matchedOnLabel,
  relationLabel,
  reliabilityBandLabel,
  roleLabel,
  sentimentLabel,
  sourceTypeLabel,
  STATE_LABELS,
  stateLabel,
} from './labels';
import type { MatchedOn } from './types';

const TRUST_WORDS = ['موثوق', 'جيد', 'الحكم', 'التقييمات'];
const EN_TRUST_WORDS = ['trusted', 'trustworthy', 'good merchant', 'verdict', 'rating'];

describe('reliabilityBandLabel', () => {
  it.each([
    ['strong', 'تقدير قوة آلي: قوية'],
    ['very_strong', 'تقدير قوة آلي: قوية جدًا'],
    ['medium', 'تقدير قوة آلي: متوسطة'],
    ['weak', 'تقدير قوة آلي: ضعيفة'],
    ['unknown_band', 'unknown_band'],
    ['', ''],
  ])('maps %s to its Arabic label', (band, expected) => {
    expect(reliabilityBandLabel(band, 'ar')).toBe(expected);
  });

  it('provides English labels without standalone trust claims', () => {
    expect(reliabilityBandLabel('strong', 'en')).toBe('Automated strength estimate: strong');
    expect(reliabilityBandLabel('weak', 'en')).toBe('Automated strength estimate: weak');
  });

  it('never presents the band as a standalone trust quality', () => {
    for (const label of [reliabilityBandLabel('strong'), reliabilityBandLabel('very_strong')]) {
      expect(label).toContain('تقدير قوة آلي');
    }
  });
});

describe('matchedOnLabel', () => {
  it('labels host fallback matches with dedicated phrases in Arabic and English', () => {
    expect(matchedOnLabel('website-host', 'ar')).toBe('تطابق نطاق الموقع');
    expect(matchedOnLabel('marketplace-host', 'ar')).toBe('تطابق نطاق الماركت بلايس');

    expect(matchedOnLabel('website-host', 'en')).toBe('Website domain match');
    expect(matchedOnLabel('marketplace-host', 'en')).toBe('Marketplace domain match');
  });

  it('labels the name-match tiers in both languages', () => {
    expect(matchedOnLabel('exact_name', 'ar')).toBe('تطابق اسم تام');
    expect(matchedOnLabel('exact_name', 'en')).toBe('Exact name match');

    expect(matchedOnLabel('exact_alias', 'ar')).toBe('تطابق اسم بديل');
    expect(matchedOnLabel('exact_alias', 'en')).toBe('Exact alias match');

    expect(matchedOnLabel('normalized_variant', 'ar')).toBe('صيغة قريبة من الاسم');
    expect(matchedOnLabel('normalized_variant', 'en')).toBe('Normalized name match');

    expect(matchedOnLabel('partial_name', 'ar')).toBe('تطابق جزئي في الاسم');
    expect(matchedOnLabel('partial_name', 'en')).toBe('Partial name match');

    expect(matchedOnLabel('typo', 'ar')).toBe('تشابه تقريبي في الاسم');
    expect(matchedOnLabel('typo', 'en')).toBe('Approximate name match');
  });

  it('keeps identifier kind labels intact', () => {
    expect(matchedOnLabel('phone', 'ar')).toBe('هاتف');
    expect(matchedOnLabel('phone', 'en')).toBe('Phone');
    expect(matchedOnLabel('google_maps', 'ar')).toBe('خرائط جوجل');
    expect(matchedOnLabel('google_maps', 'en')).toBe('Google Maps');
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
      expect(matchedOnLabel(tier, 'ar')).not.toBe(tier);
      expect(matchedOnLabel(tier, 'en')).not.toBe(tier);
    }
  });
});

describe('assessment and state labels', () => {
  it('provides Arabic and English labels for every identity level', () => {
    expect(Object.keys(IDENTITY_LEVEL_LABELS).sort()).toEqual(
      ['established', 'supported', 'uncertain'].sort(),
    );
    expect(identityLevelLabel('established', 'ar')).toBe('هوية مؤكدة بعلامات متعددة');
    expect(identityLevelLabel('established', 'en')).toBe('Identity confirmed by multiple markers');
  });

  it('provides Arabic and English labels for every coverage level', () => {
    expect(Object.keys(COVERAGE_LEVEL_LABELS).sort()).toEqual(
      ['none', 'limited', 'moderate', 'broad'].sort(),
    );
    expect(coverageLevelLabel('broad', 'ar')).toBe('تغطية واسعة');
    expect(coverageLevelLabel('broad', 'en')).toBe('Broad coverage');
  });

  it('keeps state labels free of trust language in both languages', () => {
    for (const label of Object.values(STATE_LABELS)) {
      for (const word of TRUST_WORDS) {
        expect(label).not.toContain(word);
      }
    }
    for (const state of Object.keys(STATE_LABELS)) {
      const enLabel = stateLabel(state, 'en').toLowerCase();
      for (const word of EN_TRUST_WORDS) {
        expect(enLabel).not.toContain(word);
      }
    }
  });
});

describe('bilingual taxonomy and content mappings', () => {
  it('maps claim types in both Arabic and English without falling back to raw snake_case', () => {
    expect(claimTypeLabel('delayed_delivery', 'ar')).toBe('تأخر في التسليم');
    expect(claimTypeLabel('delayed_delivery', 'en')).toBe('Delayed delivery');
    expect(claimTypeLabel('official_warning', 'ar')).toBe('تحذير رسمي');
    expect(claimTypeLabel('official_warning', 'en')).toBe('Official warning');
    expect(claimTypeLabel('warranty_coverage', 'en')).toBe('Warranty coverage');
  });

  it('maps author types in both Arabic and English', () => {
    expect(authorTypeLabel('customer', 'ar')).toBe('عميل');
    expect(authorTypeLabel('customer', 'en')).toBe('Customer');
    expect(authorTypeLabel('merchant', 'ar')).toBe('التاجر');
    expect(authorTypeLabel('merchant', 'en')).toBe('Merchant');
    expect(authorTypeLabel('regulator', 'en')).toBe('Regulator');
  });

  it('maps sentiment in both languages', () => {
    expect(sentimentLabel('positive', 'ar')).toBe('إيجابي');
    expect(sentimentLabel('positive', 'en')).toBe('Positive');
    expect(sentimentLabel('negative', 'en')).toBe('Negative');
    expect(sentimentLabel('neutral', 'en')).toBe('Neutral');
  });

  it('maps relations in both languages', () => {
    expect(relationLabel('identifier_collision', 'ar')).toBe('تطابق في المعرفات');
    expect(relationLabel('identifier_collision', 'en')).toBe('Identifier match');
  });

  it('maps source check status in both languages', () => {
    expect(checkStatusLabel('reachable', 'ar')).toBe('يمكن الوصول');
    expect(checkStatusLabel('reachable', 'en')).toBe('Reachable');
    expect(checkStatusLabel('not_checked', 'en')).toBe('Not checked yet');
  });

  it('maps identifier roles in both languages', () => {
    expect(roleLabel('contact', 'ar')).toBe('وسيلة تواصل');
    expect(roleLabel('contact', 'en')).toBe('Contact method');
    expect(roleLabel('owned_site', 'en')).toBe('Merchant-owned site');
  });

  it('maps source types in both languages', () => {
    expect(sourceTypeLabel('facebook_post', 'ar')).toBe('منشور فيسبوك');
    expect(sourceTypeLabel('facebook_post', 'en')).toBe('Facebook post');
  });
});
