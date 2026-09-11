import { cookies } from 'next/headers';

export type Locale = 'ar' | 'en';

export const LOCALE_COOKIE = 'mi_lang';

/** Read the active locale from the cookie; Arabic is the default. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return value === 'en' ? 'en' : 'ar';
}

export const DIR_FOR: Record<Locale, 'rtl' | 'ltr'> = { ar: 'rtl', en: 'ltr' };

/**
 * UI chrome strings. Arabic is canonical (existing product voice); English
 * mirrors are added as part of the bilingual goal. Components call t(locale).
 */
const UI_STRINGS: Record<Locale, Record<string, string>> = {
  ar: {
    siteName: 'ميزان التاجر',
    tagline: 'بحث عن هوية التجار وأدلتهم',
    skipToContent: 'تخطَّ إلى المحتوى الرئيسي',
    searchPlaceholder: 'ابحث باسم التاجر أو الهاتف أو الرابط…',
    search: 'بحث',
    directory: 'دليل التجار',
    positiveEvidence: 'أدلة إيجابية',
    home: 'الرئيسية',
    language: 'English',
    switchTo: 'en',
    sourcesSection: 'المصادر',
    evidenceSection: 'الأدلة',
    claimsSection: 'الادّعاءات',
    identitySection: 'الهوية',
    briefSection: 'ملخص التاجر',
    unknownVendor: 'تاجر غير معروف',
    loading: 'جارٍ تحميل بيانات التاجر…',
    notFound: 'لم يتم العثور على التاجر',
    page: 'صفحة',
    results: 'نتائج',
    poweredBy: 'النتائج مبنية على بحث آلي في مصادر عامة وقد تكون قديمة أو غير مكتملة',
  },
  en: {
    siteName: 'Merchant Balance',
    tagline: 'Vendor identity and evidence lookup',
    skipToContent: 'Skip to main content',
    searchPlaceholder: 'Search by vendor name, phone, or link…',
    search: 'Search',
    directory: 'Vendor directory',
    positiveEvidence: 'Positive evidence',
    home: 'Home',
    language: 'العربية',
    switchTo: 'ar',
    sourcesSection: 'Sources',
    evidenceSection: 'Evidence',
    claimsSection: 'Claims',
    identitySection: 'Identity',
    briefSection: 'Vendor brief',
    unknownVendor: 'Unknown vendor',
    loading: 'Loading vendor data…',
    notFound: 'Vendor not found',
    page: 'Page',
    results: 'results',
    poweredBy: 'Results are generated from automated public-source research and may be outdated or incomplete',
  },
};

export type UiStrings = Record<string, string>;

export function t(locale: Locale): UiStrings {
  return UI_STRINGS[locale];
}
