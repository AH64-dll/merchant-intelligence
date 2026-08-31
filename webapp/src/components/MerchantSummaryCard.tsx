import type { JSX, ReactNode } from 'react';
import Link from 'next/link';

import type { MerchantDirectoryEntry } from '@/lib/types';
import { COVERAGE_LEVEL_LABELS, IDENTITY_LEVEL_LABELS, SENTIMENT_LABELS } from '@/lib/labels';
import { formatDateAr } from './display';

/**
 * Public seller summary card — the one shared markup for both directories.
 *
 * Renders only the safe projection fields: no state, no confidence numbers,
 * no reliability band. The location count is always labeled as stored
 * records, never a claimed branch count. The seller name links to the
 * detail page; every interactive target is ≥44px tall.
 */
export function MerchantSummaryCard({
  entry,
  children,
}: {
  entry: MerchantDirectoryEntry;
  /** Optional extra section (e.g. the positive highlight). */
  children?: ReactNode;
}): JSX.Element {
  const { evidence } = entry;
  return (
    <article className="space-y-2 border border-black p-4">
      <h2 className="text-lg font-bold">
        <Link
          href={`/merchant/${entry.id}`}
          className="inline-block min-h-[44px] py-1 underline underline-offset-2"
        >
          <span dir="auto">{entry.canonicalName}</span>
        </Link>
      </h2>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="inline font-bold">التصنيف: </dt>
          <dd className="inline" dir="auto">
            {entry.categoryTags.length > 0 ? entry.categoryTags.join('، ') : 'تصنيف غير محدد'}
          </dd>
        </div>
        <div>
          <dt className="inline font-bold">الموقع: </dt>
          <dd className="inline" dir="auto">
            {entry.locationLabel}
          </dd>
        </div>
      </dl>
      {entry.locationCount > 1 ? (
        <p className="text-sm">
          عدة مواقع مسجَّلة — <span dir="ltr">{entry.locationCount}</span> سجل
          موقع موثَّق (وليست تعدادًا مؤكدًا للفروع).
        </p>
      ) : null}
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="inline font-bold">الهوية: </dt>
          <dd className="inline">{IDENTITY_LEVEL_LABELS[entry.identityLevel]}</dd>
        </div>
        <div>
          <dt className="inline font-bold">تغطية الأدلة: </dt>
          <dd className="inline">{COVERAGE_LEVEL_LABELS[entry.coverageLevel]}</dd>
        </div>
      </dl>
      <p className="text-sm">
        الأدلة: <span dir="ltr">{evidence.total}</span> إجمالًا، منها{' '}
        <span dir="ltr">{evidence.nonDuplicate}</span> غير مكررة من{' '}
        <span dir="ltr">{evidence.distinctSources}</span> مصادر مختلفة.
      </p>
      <p className="text-sm">
        {SENTIMENT_LABELS.positive}: <span dir="ltr">{evidence.positive}</span> ·{' '}
        {SENTIMENT_LABELS.neutral}: <span dir="ltr">{evidence.neutral}</span> ·{' '}
        {SENTIMENT_LABELS.negative}: <span dir="ltr">{evidence.negative}</span>{' '}
        (من الأدلة غير المكررة).
      </p>
      <p className="text-sm">
        أحدث نشر موثَّق:{' '}
        {evidence.latestPublishedAt !== null ? (
          <time dateTime={evidence.latestPublishedAt.slice(0, 10)} dir="ltr">
            {formatDateAr(evidence.latestPublishedAt)}
          </time>
        ) : (
          'غير مؤرَّخ'
        )}
        {' · '}
        آخر التقاط للأدلة:{' '}
        {evidence.lastCapturedAt !== null ? (
          <time dateTime={evidence.lastCapturedAt.slice(0, 10)} dir="ltr">
            {formatDateAr(evidence.lastCapturedAt)}
          </time>
        ) : (
          'غير معروف'
        )}
      </p>
      {children}
    </article>
  );
}
