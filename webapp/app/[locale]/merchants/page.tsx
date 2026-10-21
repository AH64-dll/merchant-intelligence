import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { DirectoryBrowser } from '@/components/DirectoryBrowser';
import { isLocale, t, type Locale } from '@/lib/i18n';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const active: Locale = isLocale(locale) ? locale : 'ar';
  return { title: t(active).allMerchantsPageTitle };
}

/**
 * All canonical sellers, one page of 20, ordered by canonical name.
 * Static shell: filtering + pagination run client-side over directory.json.
 */
export default async function MerchantsDirectoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const strings = t(locale);

  return (
    <Suspense>
      <DirectoryBrowser
        view="all"
        locale={locale}
        title={strings.allMerchantsTitle}
        intro={
          <p dir="auto" className="max-w-3xl">
            {strings.allMerchantsIntro}
          </p>
        }
        listLabel={strings.merchantsListLabel}
        emptyState={
          <div className="flex flex-col gap-2">
            <p className="font-medium text-[var(--ink)]">{strings.noMatchingVendors}</p>
            <p className="text-xs text-[var(--muted)]">
              {locale === 'en' ? (
                <>
                  Try relaxing filters — all categories, governorates, and levels — or browse{' '}
                  <Link href={`/${locale}/merchants`} className="text-[var(--teal)] underline underline-offset-2 hover:text-[#344e27]">
                    all vendors
                  </Link>{' '}
                  without filtering.
                </>
              ) : (
                <>
                  جرّب تخفيف المرشحات — كل التصنيفات وكل المحافظات وكل المستويات — أو استعرض{' '}
                  <Link href={`/${locale}/merchants`} className="text-[var(--teal)] underline underline-offset-2 hover:text-[#344e27]">
                    جميع البائعين
                  </Link>{' '}
                  من دون تصفية.
                </>
              )}
            </p>
          </div>
        }
      />
    </Suspense>
  );
}
