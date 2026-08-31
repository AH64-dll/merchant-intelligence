import type { Metadata } from 'next';

import { DirectoryPageShell } from '@/components/DirectoryPageShell';
import { normalizeDirectoryQuery } from '@/lib/directory';
import { directoryPageInput } from '@/lib/directory-page';
import { getDb } from '@/lib/singletons';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'جميع البائعين — ميزان التاجر',
};

interface DirectoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * All canonical sellers, one page of 20, ordered by canonical name.
 *
 * GET filters are normalized by the shared directory selector — this page does
 * no ranking of its own. A syntactically invalid hand-edited query fails the
 * render and reaches the existing error boundary, mirroring the 400 the list
 * API returns for the same input.
 */
export default async function MerchantsDirectoryPage({ searchParams }: DirectoryPageProps) {
  const raw = await searchParams;
  const query = normalizeDirectoryQuery(directoryPageInput(raw, 'all'));
  const result = getDb().getMerchantDirectory(query);
  return (
    <DirectoryPageShell
      title="جميع البائعين"
      intro={
        <p dir="auto" className="max-w-3xl">
          قائمة بجميع البائعين الأساسيين في اللقطة الحالية، مرتَّبة أبجديًا
          باسم البائع الثابت. كل صف يمثل بائعًا واحدًا؛ صفحة البائع تحتفظ
          بكل المواقع المسجَّلة والأسماء البديلة والأدلة الكاملة.
        </p>
      }
      basePath="/merchants"
      result={result}
      view="all"
      activeFilters={query}
      cardKind="summary"
      listLabel="قائمة البائعين"
      emptyState={
        <div className="flex flex-col gap-2">
          <p>لا يوجد بائعون يطابقون هذه التصفية.</p>
          <p className="text-sm">
            جرّب تخفيف المرشحات — كل التصنيفات وكل المحافظات وكل المستويات —
            أو استعرض{' '}
            <a href="/merchants" className="underline underline-offset-2">
              جميع البائعين
            </a>{' '}
            من دون تصفية.
          </p>
        </div>
      }
    />
  );
}
