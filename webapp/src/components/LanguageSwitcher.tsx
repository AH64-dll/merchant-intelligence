'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Globe2 } from 'lucide-react';

import { switchLocalePath, type Locale } from '@/lib/i18n';

function SwitcherLink({ locale }: { locale: Locale }) {
  const pathname = usePathname() ?? `/${locale}`;
  const searchParams = useSearchParams();
  const otherLang: Locale = locale === 'ar' ? 'en' : 'ar';
  const otherLabel = locale === 'ar' ? 'English' : 'العربية';
  const switchAria = locale === 'ar' ? 'التحويل إلى اللغة الإنجليزية' : 'Switch to Arabic';
  const search = searchParams?.toString();

  return (
    <Link
      href={`${switchLocalePath(pathname, otherLang)}${search ? `?${search}` : ''}`}
      aria-label={switchAria}
      lang={otherLang}
      dir={otherLang === 'ar' ? 'rtl' : 'ltr'}
      className="language-button"
      onClick={() => {
        // Persist the choice immediately so /api/locale-free paths and future
        // first-loads land in the right language, then flip the live <html>
        // attrs — client-side navigation does not remount app/layout.tsx, so
        // without this the document stays in the previous locale's dir.
        document.cookie = `mi_lang=${otherLang}; path=/; max-age=31536000; SameSite=Lax`;
        document.documentElement.lang = otherLang;
        document.documentElement.dir = otherLang === 'ar' ? 'rtl' : 'ltr';
      }}
    >
      <Globe2 size={15} aria-hidden="true" />
      <span lang={otherLang}>{otherLabel}</span>
    </Link>
  );
}

/**
 * Locale toggle: a plain link to the same path under the other locale.
 * `useSearchParams` requires a Suspense boundary in static export; SSR output
 * shows a same-page fallback href.
 */
export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const otherLang: Locale = locale === 'ar' ? 'en' : 'ar';
  const otherLabel = locale === 'ar' ? 'English' : 'العربية';
  const switchAria = locale === 'ar' ? 'التحويل إلى اللغة الإنجليزية' : 'Switch to Arabic';

  return (
    <Suspense
      fallback={
        <Link
          href={`/${otherLang}`}
          aria-label={switchAria}
          lang={otherLang}
          dir={otherLang === 'ar' ? 'rtl' : 'ltr'}
          className="language-button"
        >
          <Globe2 size={15} aria-hidden="true" />
          <span lang={otherLang}>{otherLabel}</span>
        </Link>
      }
    >
      <SwitcherLink locale={locale} />
    </Suspense>
  );
}
