import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { DirectoryBrowser } from '@/components/DirectoryBrowser';
import { isLocale, t, type Locale } from '@/lib/i18n';
import PositiveEvidenceDirectoryLoading from './loading';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const active: Locale = isLocale(locale) ? locale : 'ar';
  return { title: t(active).positiveEvidencePageTitle };
}

/**
 * Sellers ordered by the strongest documented positive evidence — the
 * deterministic selector order, never a scalar score. Filtering + pagination
 * run client-side over directory.json.
 */
export default async function PositiveEvidenceDirectoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const strings = t(locale);

  return (
    <Suspense fallback={<PositiveEvidenceDirectoryLoading />}>
      <DirectoryBrowser
        view="positive-evidence"
        locale={locale}
        title={strings.positiveEvidenceTitle}
        intro={
          <div className="flex max-w-3xl flex-col gap-2">
            <p dir="auto">{strings.positiveEvidenceIntro1}</p>
            <p dir="auto" className="text-sm">
              {strings.positiveEvidenceIntro2}
            </p>
          </div>
        }
        listLabel={strings.positiveListLabel}
        emptyState={
          <div className="flex flex-col gap-2">
            <p className="font-medium text-[var(--ink)]">{strings.noMatchingVendors}</p>
            <p className="text-xs text-[var(--muted)]">
              {locale === 'en' ? (
                <>
                  Filters may be too restrictive for this list. Try relaxing filters, or browse{' '}
                  <Link
                    href={`/${locale}/merchants/positive-evidence`}
                    className="text-[var(--teal)] underline underline-offset-2 hover:text-[#344e27]"
                  >
                    the full list
                  </Link>{' '}
                  without filtering.
                </>
              ) : (
                <>
                  قد تكون المرشحات ضيقة على هذه القائمة. جرّب تخفيف المرشحات، أو استعرض{' '}
                  <Link
                    href={`/${locale}/merchants/positive-evidence`}
                    className="text-[var(--teal)] underline underline-offset-2 hover:text-[#344e27]"
                  >
                    القائمة كاملة
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
