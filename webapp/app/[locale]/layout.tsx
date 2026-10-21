import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AdSenseScript, ConsentBanner } from '@/components/ads';
import { areAdsEnabled } from '@/lib/ads';
import { DIR_FOR, isLocale, LOCALES, type Locale } from '@/lib/i18n';
import { ShellChrome } from '@/components/ShellChrome';

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  const active = isLocale(locale) ? locale : 'ar';
  return {
    title:
      active === 'en'
        ? 'Merchant Scale — vendor identity search and public evidence'
        : 'دليل التجار — بحث عن هوية التجار وأدلتهم',
    alternates: {
      languages: { ar: '/ar', en: '/en' },
    },
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div lang={locale} dir={DIR_FOR[locale]} className="contents">
      {/* Renders nothing unless NEXT_PUBLIC_ENABLE_ADS is on and the publisher
          id is configured; the consent banner is pointless without ad units. */}
      <AdSenseScript />
      {areAdsEnabled() ? <ConsentBanner locale={locale} /> : null}
      <ShellChrome locale={locale}>{children}</ShellChrome>
    </div>
  );
}
