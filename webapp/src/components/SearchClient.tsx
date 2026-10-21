'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  FileSearch,
  AlertCircle,
  RefreshCw,
  Search,
  Building2,
  Info,
  CircleHelp,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';

import type { SearchHit, SearchResult, SearchTier } from '@/lib/types';
import {
  categoryTags,
  CATEGORY_TAG_LABELS,
  normalizeGovernorate,
  GOVERNORATE_LABELS,
} from '@/lib/taxonomy';
import { formatDateAr } from '@/components/display';
import type { Locale } from '@/lib/i18n';
import { Pagination } from '@/components/Pagination';
import { SearchIndex } from '@/lib/search';
import type { IndexData } from '@/lib/db';
import { assetUrl } from '@/lib/asset-url';
const TIER_SECTION_CAPTIONS: Record<'ar' | 'en', Record<SearchTier, string>> = {
  ar: {
    exact_identifier: 'تطابق تام في المعرّف',
    exact_name: 'تطابق تام في الاسم',
    exact_alias: 'تطابق تام في الاسم البديل',
    normalized_variant: 'تطابق في الصيغ الموحدة للاسم',
    partial_name: 'تطابق جزئي في الاسم',
    category: 'تطابق في التصنيف والنشاط',
    claim: 'تطابق في الادّعاءات المسجلة',
    evidence: 'تطابق في نصوص الأدلة وملاحظاتها',
    source: 'تطابق في عناوين ومصادر الأدلة',
    typo: 'تصحيح إملائي محتمل',
  },
  en: {
    exact_identifier: 'Exact identifier match',
    exact_name: 'Exact name match',
    exact_alias: 'Exact alias match',
    normalized_variant: 'Normalized name variant match',
    partial_name: 'Partial name match',
    category: 'Category and activity match',
    claim: 'Registered claim match',
    evidence: 'Evidence text and note match',
    source: 'Source url and label match',
    typo: 'Potential typo recovery',
  },
};

const TIER_ORDER: SearchTier[] = [
  'exact_identifier',
  'exact_name',
  'exact_alias',
  'normalized_variant',
  'partial_name',
  'category',
  'claim',
  'evidence',
  'source',
  'typo',
];
const DIAGNOSTIC_COPY: Record<'ar' | 'en', Record<string, string>> = {
  ar: {
    too_short: 'استعلام البحث قصير جدًا — أدخل حرفين على الأقل.',
    stopword: 'عبارة البحث شائعة جدًا — أضف كلمة أخرى لتحديد النتائج.',
    empty: 'أدخل اسم تاجر، أو رقم هاتف، أو رابط صفحة للبحث.',
  },
  en: {
    too_short: 'Search query is too short — enter at least 2 characters.',
    stopword: 'Search query is too common — add another word to refine.',
    empty: 'Enter a vendor name, phone number, or page link to search.',
  },
};

function identityLabel(state: string, isEn: boolean): string {
  if (state.includes('VERIFIED')) {
    return isEn ? 'Verified identity record' : 'سجل هوية موثَّق';
  }
  if (state.includes('CLAIMED')) {
    return isEn ? 'Identity claimed by merchant' : 'هوية مصرّح بها من التاجر';
  }
  return isEn ? 'Unverified identity record' : 'سجل هوية غير موثَّق';
}

function formatDate(iso: string, isEn: boolean): string {
  if (isEn) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
  }
  return formatDateAr(iso);
}

function DataNotice({ isEn }: { isEn: boolean }) {
  return (
    <div className="data-notice">
      <Info size={18} aria-hidden="true" />
      <div>
        <strong>
          {isEn
            ? 'Scope of search and available data'
            : 'حدود البحث والبيانات المتاحة'}
        </strong>
        <p>
          {isEn
            ? 'Results rely on evidence gathered from publicly verifiable sources. The absence of a record does not imply an absence of business activity — it may simply mean the identity has not been researched yet.'
            : 'تعتمد النتائج على أدلة مجمعة من مصادر عامة قابلة للتحقق. غياب السجل لا يعني بالضرورة عدم وجود نشاط تجاري، بل قد يعني أن الهوية لم تخضع للفحص بعد.'}
        </p>
      </div>
    </div>
  );
}

function SearchTips({ isEn }: { isEn: boolean }) {
  return (
    <section className="search-tips">
      <h3>
        <CircleHelp size={18} aria-hidden="true" />
        {isEn ? 'Tips for better search results' : 'نصائح للحصول على نتائج أفضل'}
      </h3>
      <div>
        <p>
          <span>01</span>
          {isEn
            ? 'Use the vendor name as it appears on their public page without unusual abbreviations.'
            : 'استخدم الاسم كما يظهر في الصفحة العامة أو الإعلان دون اختصارات غير شائعة.'}
        </p>
        <p>
          <span>02</span>
          {isEn
            ? 'Try searching with an Egyptian phone number starting with 01 or with country code (+20).'
            : 'جرّب البحث برقم الهاتف مع رمز الدولة (+20) أو بدونه.'}
        </p>
        <p>
          <span>03</span>
          {isEn
            ? 'Paste the exact page URL or handle to locate evidence tied directly to that identity.'
            : 'الصق رابط الصفحة أو معرّف الحساب كما هو للوصول إلى أدلة هذا المعرّف تحديدًا.'}
        </p>
      </div>
    </section>
  );
}

function HitCard({
  hit,
  isEn,
  locale,
}: {
  hit: SearchHit;
  isEn: boolean;
  locale: Locale;
}) {
  const { merchant, match } = hit;
  const tags = categoryTags(merchant.category);
  const governorateKey = normalizeGovernorate(merchant.governorate);
  const lastCaptured = merchant.updatedAt;
  const localeKey = isEn ? 'en' : 'ar';
  const delimiter = isEn ? ', ' : '، ';

  return (
    <li className="hit-card">
      <Link href={`/${locale}/merchant/${merchant.id}`}>
        <span dir="auto" className="hit-title">
          {merchant.canonicalName}
        </span>
        <span className="hit-meta">
          {tags.map((tag) => CATEGORY_TAG_LABELS[tag][localeKey]).join(delimiter)}
          {merchant.city ? ` · ${merchant.city}` : ''}
          {governorateKey !== null
            ? ` · ${GOVERNORATE_LABELS[governorateKey][localeKey]}`
            : ''}
        </span>
        <span className="hit-reason">
          {isEn ? 'Match reason: ' : 'سبب المطابقة: '}
          {match.label}
        </span>
        <span dir="auto" className="ltr-isolate wrap-anywhere hit-value">
          <bdi>{match.value}</bdi>
        </span>
        <span className="hit-meta">{identityLabel(merchant.state, isEn)}</span>
        <span className="hit-date">
          {isEn ? 'Data last updated: ' : 'آخر تحديث للبيانات: '}
          <span dir="ltr">{formatDate(lastCaptured, isEn)}</span>
        </span>
      </Link>
    </li>
  );
}

function TieredHits({
  hits,
  isEn,
  locale,
}: {
  hits: SearchHit[];
  isEn: boolean;
  locale: Locale;
}) {
  const byTier: Partial<Record<SearchTier, SearchHit[]>> = {};
  for (const hit of hits) {
    const tier = hit.match.kind;
    const mapped: SearchTier = (TIER_ORDER as string[]).includes(tier)
      ? (tier as SearchTier)
      : 'exact_identifier';
    (byTier[mapped] ??= []).push(hit);
  }
  const localeKey = isEn ? 'en' : 'ar';

  return (
    <>
      {TIER_ORDER.filter((tier) => byTier[tier] !== undefined).map((tier) => (
        <section key={tier} aria-labelledby={`tier-${tier}`}>
          <div
            style={{
              padding: '10px 23px',
              background: '#f4f6f1',
              borderBottom: '1px solid var(--border, #e4e3de)',
            }}
          >
            <h3
              id={`tier-${tier}`}
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: '#596a58',
                margin: 0,
              }}
            >
              {TIER_SECTION_CAPTIONS[localeKey][tier]}
            </h3>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {byTier[tier]!.map((hit) => (
              <HitCard
                key={`${hit.merchant.id}:${hit.match.kind}`}
                hit={hit}
                isEn={isEn}
                locale={locale}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function SearchPagination({
  result,
  q,
  locale,
}: {
  result: SearchResult;
  q: string;
  locale: Locale;
}) {
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <Pagination
      basePath={`/${locale}/search`}
      page={result.page}
      totalPages={totalPages}
      query={[['q', q]]}
      locale={locale}
    />
  );
}

type IndexState = 'loading' | 'ready' | 'error';

export interface SearchClientProps {
  locale: Locale;
  initialQ?: string;
  initialPage?: number;
  initialIndex?: SearchIndex;
  suppressResultQuery?: boolean;
}

/**
 * Client-side search: lazy-fetches the serialized index (~700KB gzip) once,
 * then runs the identical SearchIndex ranking in the browser.
 */
export function SearchClient({
  locale,
  initialQ = '',
  initialPage = 1,
  initialIndex,
  suppressResultQuery = false,
}: SearchClientProps) {
  const isEn = locale === 'en';
  const localeKey = isEn ? 'en' : 'ar';
  const [indexState, setIndexState] = useState<IndexState>(
    initialIndex ? 'ready' : 'loading',
  );
  const [index, setIndex] = useState<SearchIndex | null>(initialIndex ?? null);
  const searchParams = useSearchParams();
  const rawQ = searchParams?.get('q') ?? initialQ;
  const q = rawQ?.trim() ?? '';
  const rawPage = searchParams?.get('page');
  const parsedPage =
    rawPage === null || rawPage === undefined
      ? initialPage
      : Number.parseInt(rawPage, 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  useEffect(() => {
    if (initialIndex) return;
    let cancelled = false;
    fetch(assetUrl('/data/search-index.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`index ${response.status}`);
        return response.json() as Promise<IndexData>;
      })
      .then((data) => {
        if (!cancelled) {
          setIndex(new SearchIndex(data));
          setIndexState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setIndexState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [initialIndex]);

  const result = useMemo(
    () => (index === null || q === '' ? null : index.search(q, page, undefined, locale)),
    [index, q, page, locale],
  );

  const showDynamicResultQuery = !suppressResultQuery && Boolean(q);

  if (indexState === 'error') {
    return (
      <>
        {showDynamicResultQuery ? (
          <div className="result-query">
            {isEn ? 'Results for: ' : 'نتائج البحث عن: '}
            <strong dir="auto">«{q}»</strong>
          </div>
        ) : null}
        <section className="search-empty-panel">
          <div className="large-empty-icon">
            <AlertCircle size={38} aria-hidden="true" />
          </div>
          <h2>{isEn ? 'Search index unavailable' : 'فهرس البحث غير متاح حاليًا'}</h2>
          <p>
            {isEn
              ? 'Search index failed to load. Check your connection and retry.'
              : 'تعذّر تحميل فهرس البحث. تحقق من الاتصال وأعد المحاولة.'}
          </p>
          <div className="empty-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {isEn ? 'Retry' : 'إعادة المحاولة'}
            </button>
          </div>
        </section>
      </>
    );
  }

  if (q === '') {
    return (
      <>
        <section className="search-empty-panel">
          <div className="large-empty-icon">
            <FileSearch size={38} aria-hidden="true" />
          </div>
          <h2>{isEn ? 'Start your vendor search' : 'ابدأ البحث عن تاجر'}</h2>
          <p>
            {isEn
              ? 'Search by vendor name, Egyptian phone number, or page link to view identity records and public evidence.'
              : 'ابحث باسم التاجر، أو برقم هاتف مصري، أو برابط صفحته للاطلاع على سجلات الهوية والأدلة العامة.'}
          </p>
        </section>
        <DataNotice isEn={isEn} />
        <SearchTips isEn={isEn} />
      </>
    );
  }

  if (q.length > 300) {
    return (
      <>
        {showDynamicResultQuery ? (
          <div className="result-query">
            {isEn ? 'Results for: ' : 'نتائج البحث عن: '}
            <strong dir="auto">«{q}»</strong>
          </div>
        ) : null}
        <section className="search-empty-panel">
          <div className="large-empty-icon">
            <AlertCircle size={38} aria-hidden="true" />
          </div>
          <h2>{isEn ? 'Query too long' : 'استعلام البحث طويل جدًا'}</h2>
          <p>
            {isEn
              ? 'The search query is too long (300 characters maximum).'
              : 'استعلام البحث طويل جدًا (الحد الأقصى 300 حرف).'}
          </p>
        </section>
      </>
    );
  }

  if (indexState === 'loading' || result === null) {
    return (
      <>
        {showDynamicResultQuery ? (
          <div className="result-query">
            {isEn ? 'Results for: ' : 'نتائج البحث عن: '}
            <strong dir="auto">«{q}»</strong>
          </div>
        ) : null}
        <section className="search-empty-panel" aria-busy="true">
          <div className="large-empty-icon">
            <Search size={38} aria-hidden="true" />
          </div>
          <h2>{isEn ? 'Searching records…' : 'جارٍ البحث في السجلات…'}</h2>
          <p>
            {isEn
              ? 'Loading search index and analyzing evidence…'
              : 'جارٍ تحميل فهرس البحث وتحليل الأدلة…'}
          </p>
        </section>
      </>
    );
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      {showDynamicResultQuery ? (
        <div className="result-query">
          {isEn ? 'Results for: ' : 'نتائج البحث عن: '}
          <strong dir="auto">«{q}»</strong>
        </div>
      ) : null}

      {result.total === 0 ? (
        <>
          <section className="search-empty-panel">
            <div className="large-empty-icon">
              <FileSearch size={38} aria-hidden="true" />
            </div>
            <h2>
              {isEn
                ? 'No records found for this query'
                : 'لا توجد سجلات مطابقة لهذا البحث'}
            </h2>
            <p>
              {isEn
                ? 'Try an Egyptian phone number starting with 01 or +20, the vendor name as shown in public sources, or a profile/account link.'
                : 'جرّب رقم هاتف مصري يبدأ بـ 01 أو +20، أو اسم التاجر كما يظهر في مصادره، أو رابط صفحته أو حسابه.'}
            </p>
            <div className="empty-actions">
              <Link href={`/${locale}/merchants`} className="secondary-button">
                <Building2 size={16} aria-hidden="true" />
                {isEn ? 'Explore merchant directory' : 'استكشف دليل التجار'}
              </Link>
              <Link href={`/${locale}`} className="text-link">
                {isEn ? 'Back to home' : 'العودة للرئيسية'}
                {isEn ? (
                  <ArrowRight size={14} className="link-arrow" aria-hidden="true" />
                ) : (
                  <ArrowLeft size={14} className="link-arrow" aria-hidden="true" />
                )}
              </Link>
            </div>
          </section>
          <DataNotice isEn={isEn} />
          <SearchTips isEn={isEn} />
        </>
      ) : result.page > totalPages ? (
        <section className="search-empty-panel">
          <div className="large-empty-icon">
            <AlertCircle size={38} aria-hidden="true" />
          </div>
          <h2>{isEn ? 'Page out of range' : 'الصفحة المطلوبة خارج المدى'}</h2>
          <p>
            {isEn ? (
              <>
                Total results <span dir="ltr">{result.total}</span> distributed
                across <span dir="ltr">{totalPages}</span> pages.
              </>
            ) : (
              <>
                العدد الإجمالي للنتائج <span dir="ltr">{result.total}</span> موزع
                على <span dir="ltr">{totalPages}</span> صفحات.
              </>
            )}
          </p>
          <div className="empty-actions">
            <Link
              href={`/${locale}/search?${new URLSearchParams({ q, page: String(totalPages) }).toString()}`}
              className="secondary-button"
            >
              {isEn ? 'Go to last page' : 'الانتقال إلى الصفحة الأخيرة'}
            </Link>
          </div>
        </section>
      ) : (
        <>
          <div className="index-panel">
            <div className="index-toolbar">
              <h2>
                <Building2 size={18} aria-hidden="true" />
                {isEn ? 'Matching vendors' : 'التجار المطابقون'}
                <span className="unavailable-count">({result.total})</span>
              </h2>
              <div style={{ fontSize: '12px', color: '#7a8085' }} aria-live="polite">
                {isEn ? (
                  <>
                    Showing <span dir="ltr">{result.pageSize}</span> per page
                  </>
                ) : (
                  <>
                    تُعرض <span dir="ltr">{result.pageSize}</span> نتيجة في الصفحة
                  </>
                )}
              </div>
            </div>

            {result.diagnostic !== null &&
              DIAGNOSTIC_COPY[localeKey][result.diagnostic] !== undefined && (
                <div
                  style={{
                    padding: '13px 23px',
                    background: '#faf6eb',
                    borderBottom: '1px solid #e7dfcb',
                    fontSize: '12px',
                    color: '#715a28',
                  }}
                >
                  <p>{DIAGNOSTIC_COPY[localeKey][result.diagnostic]}</p>
                </div>
              )}

            {result.ambiguous && (
              <div
                style={{
                  padding: '13px 23px',
                  background: '#fcf3f2',
                  borderBottom: '1px solid #ebd7d5',
                  fontSize: '12px',
                  color: 'var(--brick, #a65d57)',
                }}
              >
                <p>
                  {isEn
                    ? 'Multiple vendors match this search. These are potential matches and not a confirmation — compare location, identifiers, and evidence dates to choose the correct vendor.'
                    : 'أكثر من تاجر يطابق هذا البحث. هذه نتائج محتملة وليست تأكيدًا — قارن الموقع والمعرفات وتواريخ الأدلة لاختيار التاجر الصحيح.'}
                </p>
              </div>
            )}

            <TieredHits hits={result.hits} isEn={isEn} locale={locale} />

            {totalPages > 1 && (
              <div className="index-footer">
                <SearchPagination result={result} q={q} locale={locale} />
              </div>
            )}

            <DataNotice isEn={isEn} />
          </div>

          <SearchTips isEn={isEn} />
        </>
      )}
    </>
  );
}
