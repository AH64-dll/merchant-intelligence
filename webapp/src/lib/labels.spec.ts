import { describe, expect, it } from 'vitest';
import { matchedOnLabel, reliabilityBandLabel } from './labels';

describe('reliabilityBandLabel', () => {
  it.each([
    ['strong', 'قوية'],
    ['very_strong', 'قوية جدًا'],
    ['weak', 'weak'],
    ['unknown_band', 'unknown_band'],
    ['', ''],
  ])('maps %s to its label', (band, expected) => {
    expect(reliabilityBandLabel(band)).toBe(expected);
  });
});

describe('matchedOnLabel', () => {
  it('labels host fallback matches with dedicated phrases', () => {
    expect(matchedOnLabel('website-host')).toBe('تطابق نطاق الموقع');
    expect(matchedOnLabel('marketplace-host')).toBe('تطابق نطاق الماركت بلايس');
  });

  it('keeps identifier kind and name-match labels intact', () => {
    expect(matchedOnLabel('phone')).toBe('هاتف');
    expect(matchedOnLabel('google_maps')).toBe('خرائط جوجل');
    expect(matchedOnLabel('name_exact')).toBe('تطابق اسم تام');
    expect(matchedOnLabel('alias_exact')).toBe('تطابق اسم بديل');
    expect(matchedOnLabel('name_fuzzy')).toBe('تشابه في الاسم');
  });
});
