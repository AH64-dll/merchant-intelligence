import { Suspense } from 'react';
import { FileSearch, Search } from 'lucide-react';

import { SearchClient } from '@/components/SearchClient';
import { SearchBoxFromParams } from '@/components/SearchBoxFromParams';
import { isLocale, type Locale } from '@/lib/i18n';

/**
 * Search page shell — fully static under `output: 'export'`.
 * `?q=`/`?page=` are read client-side (SearchBox + SearchClient via
 * useSearchParams inside Suspense) instead of server `searchParams`,
 * which would force dynamic rendering and break the static export.
 */
export default async function SearchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const active: Locale = isLocale(locale) ? locale : 'ar';
  const isEn = active === 'en';

  return (
    <div className="page-search">
      <div className="page-heading">
        <div className="eyebrow">
          <span />
          {isEn ? 'SEARCH RECORDS' : 'سجلات البحث'}
        </div>
        <h1>
          <FileSearch size={27} aria-hidden="true" />
          {isEn ? 'Search results' : 'نتائج البحث'}
        </h1>
        <p>
          {isEn
            ? 'Explore merchant records, identity verifications, and public evidence.'
            : 'ابحث في سجلات التجار وبيانات الهوية والأدلة العامة المتاحة.'}
        </p>
      </div>

      <Suspense
        fallback={
          <div className="search-block compact">
            <div className="search-form" aria-hidden="true">
              <Search className="search-leading" size={23} />
            </div>
          </div>
        }
      >
        <SearchBoxFromParams locale={active} compact />
      </Suspense>

      <Suspense
        fallback={
          <section className="search-empty-panel" aria-busy="true">
            <div className="large-empty-icon">
              <FileSearch size={38} aria-hidden="true" />
            </div>
            <h2>{isEn ? 'Searching records…' : 'جارٍ البحث في السجلات…'}</h2>
            <p>
              {isEn
                ? 'Loading search index and analyzing evidence…'
                : 'جارٍ تحميل فهرس البحث وتحليل الأدلة…'}
            </p>
          </section>
        }
      >
        <SearchClient locale={active} />
      </Suspense>
    </div>
  );
}
