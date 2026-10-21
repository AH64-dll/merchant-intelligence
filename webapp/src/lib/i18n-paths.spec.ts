import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  DIR_FOR,
  isLocale,
  localeFromPathname,
  LOCALES,
  switchLocalePath,
} from './i18n';

describe('locale path utilities', () => {
  it('isLocale accepts only ar/en', () => {
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('localeFromPathname reads the first segment', () => {
    expect(localeFromPathname('/en')).toBe('en');
    expect(localeFromPathname('/en/merchants')).toBe('en');
    expect(localeFromPathname('/ar/search')).toBe('ar');
    expect(localeFromPathname('/merchants')).toBe(DEFAULT_LOCALE);
    expect(localeFromPathname('/')).toBe(DEFAULT_LOCALE);
    expect(localeFromPathname('/fr/x')).toBe(DEFAULT_LOCALE);
  });

  it('switchLocalePath swaps the locale segment preserving the tail', () => {
    expect(switchLocalePath('/en/search', 'ar')).toBe('/ar/search');
    expect(switchLocalePath('/ar/merchant/abc', 'en')).toBe('/en/merchant/abc');
    expect(switchLocalePath('/en', 'ar')).toBe('/ar');
    expect(switchLocalePath('/', 'en')).toBe('/en');
    expect(switchLocalePath('/merchants', 'en')).toBe('/en/merchants');
  });

  it('switchLocalePath preserves deep paths and trailing content', () => {
    expect(switchLocalePath('/en/merchants/positive-evidence', 'ar')).toBe(
      '/ar/merchants/positive-evidence',
    );
  });

  it('dir mapping is stable', () => {
    expect(DIR_FOR.ar).toBe('rtl');
    expect(DIR_FOR.en).toBe('ltr');
    expect(LOCALES).toContain('ar');
    expect(LOCALES).toContain('en');
    expect(LOCALES.length).toBe(2);
  });
});
