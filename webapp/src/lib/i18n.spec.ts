import { describe, expect, it } from 'vitest';
import { DIR_FOR, t, type Locale } from './i18n';

describe('i18n module', () => {
  it('defines the correct direction for both supported locales', () => {
    expect(DIR_FOR.ar).toBe('rtl');
    expect(DIR_FOR.en).toBe('ltr');
  });

  it('guarantees complete translation coverage between Arabic and English', () => {
    const arStrings = t('ar');
    const enStrings = t('en');

    const arKeys = Object.keys(arStrings).sort();
    const enKeys = Object.keys(enStrings).sort();

    expect(arKeys).toEqual(enKeys);

    for (const key of arKeys as Array<keyof typeof arStrings>) {
      expect(typeof arStrings[key]).toBe('string');
      expect(arStrings[key].trim().length).toBeGreaterThan(0);

      expect(typeof enStrings[key]).toBe('string');
      expect(enStrings[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('returns distinct localized strings for primary chrome and content', () => {
    const ar = t('ar');
    const en = t('en');

    expect(ar.siteName).toBe('دليل التجار');
    expect(en.siteName).toBe('Daleel El-Togar');

    expect(ar.allMerchants).toBe('جميع البائعين');
    expect(en.allMerchants).toBe('All Vendors');

    expect(ar.positiveEvidenceNav).toBe('البائعون ذوو أقوى الأدلة الإيجابية');
    expect(en.positiveEvidenceNav).toBe('Vendors with Strongest Positive Evidence');

    expect(ar.privacy).toBe('سياسة الخصوصية والإعلانات');
    expect(en.privacy).toBe('Privacy & Ads Policy');

    expect(ar.brandDescription).toBe('للبحث في البائعين');
    expect(en.brandDescription).toBe('Vendor research');

    expect(ar.independent).toBe('منصة بحث مستقلة');
    expect(en.independent).toBe('Independent research platform');

    expect(ar.menu).toBe('فتح القائمة');
    expect(en.menu).toBe('Open menu');

    expect(ar.close).toBe('إغلاق');
    expect(en.close).toBe('Close');

    expect(ar.footerTagline).toBe('دليل التجار — للبحث، لا للترويج.');
    expect(en.footerTagline).toBe('Daleel El-Togar — research, not promotion.');

    expect(ar.footerNote).toBe('المعلومة في سياقها. والقرار لك.');
    expect(en.footerNote).toBe('Information in context. The decision is yours.');
  });

  it('falls back to Arabic for unknown locale at runtime', () => {
    const fallback = t('fr' as unknown as Locale);
    expect(fallback.siteName).toBe('دليل التجار');
  });
});
