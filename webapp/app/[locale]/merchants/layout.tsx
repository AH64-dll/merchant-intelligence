import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { AdBottomBanner, AdSidebarBanner } from '@/components/ads';
import { isLocale } from '@/lib/i18n';
import { areAdsEnabled } from '@/lib/ads';

/**
 * Shell for the two browse routes (`/merchants`, `/merchants/positive-evidence`).
 *
 * Advertising placement lives here rather than in the root layout for a policy
 * reason: these routes list sellers with aggregate evidence coverage and never
 * carry an adverse claim about one named business, so an ad unit may sit beside
 * them. `/merchant/[id]` is the opposite case and gates its own ad unit behind
 * `canDisplayAdsOnPage`.
 *
 * Both slots are env-gated server components: with advertising disabled they
 * render nothing, so the grid collapses to the single content column.
 */
export default async function MerchantsLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  if (!areAdsEnabled()) {
    return <div className="min-w-0">{children}</div>;
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8">
      <div className="min-w-0">{children}</div>
      <aside
        aria-label={locale === 'ar' ? 'إعلان في الشريط الجانبي' : 'Sidebar advertisement'}
        className="hidden lg:block lg:sticky lg:top-4"
      >
        <AdSidebarBanner locale={locale} />
      </aside>
      <div className="lg:col-span-2">
        <AdBottomBanner locale={locale} />
      </div>
    </div>
  );
}
