import type { JSX } from 'react';

import type { EvidenceItem } from '@/lib/types';
import { reliabilityBandLabel, SENTIMENT_LABELS } from '@/lib/labels';
import { authorTypeLabel } from '@/lib/taxonomy';
import { formatDateAr, safeHttpUrl, sourceCategoryLabel, STALE_PUBLISHED_DAYS } from './display';
import { SourceCitations } from './SourceCitations';

function isStale(publishedAt: string): boolean {
  return Date.now() - new Date(publishedAt).getTime() > STALE_PUBLISHED_DAYS * 24 * 60 * 60 * 1000;
}

function PublishedDate({ publishedAt }: { publishedAt: string | null }) {
  if (publishedAt === null) {
    return <span>غير مؤرَّخ</span>;
  }
  return (
    <span>
      <time dateTime={publishedAt.slice(0, 10)} dir="ltr">
        {formatDateAr(publishedAt)}
      </time>
      {isStale(publishedAt) ? <span className="font-bold"> (تاريخ قديم — تجاوز سنتين)</span> : null}
    </span>
  );
}

export function EvidenceCard({ evidence }: { evidence: EvidenceItem }): JSX.Element {
  const isDuplicate = evidence.duplicateOf !== null;
  const crossMerchant = evidence.duplicateRootMerchantId !== null;

  return (
    <article id={`evidence-${evidence.id}`} className="border border-black p-3 space-y-2">
      <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm">
        <span>اتجاه الدليل: {SENTIMENT_LABELS[evidence.sentiment]}</span>
        <span aria-hidden="true">·</span>
        <span>فئة المصدر: {sourceCategoryLabel(evidence.sourceCategory)}</span>
        <span aria-hidden="true">·</span>
        <span dir="auto">
          المنصة: <bdi>{evidence.platform}</bdi>
        </span>
        <span aria-hidden="true">·</span>
        <span>مصدر الدليل: {authorTypeLabel(evidence.authorType)}</span>
      </p>
      {evidence.summary.trim().length > 0 ? (
        <p dir="auto">{evidence.summary}</p>
      ) : null}
      {evidence.quotedExcerpt.trim().length > 0 ? (
        <blockquote dir="auto" className="border-r-2 border-black pr-3">
          «{evidence.quotedExcerpt}»
        </blockquote>
      ) : null}
      <p className="text-sm">
        نُشر: <PublishedDate publishedAt={evidence.publishedAt} />
        {' · '}
        التقط:{' '}
        <time dateTime={evidence.capturedAt.slice(0, 10)} dir="ltr">
          {formatDateAr(evidence.capturedAt)}
        </time>
      </p>

      {evidence.citations && evidence.citations.length > 0 ? (
        <SourceCitations citations={evidence.citations} />
      ) : (
        <p>
          {safeHttpUrl(evidence.url) !== null ? (
            <a
              href={evidence.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              dir="ltr"
            >
              فتح المصدر الأصلي
            </a>
          ) : (
            <span>
              المصدر (نص فقط): <span className="ltr-isolate wrap-anywhere">{evidence.url}</span>
            </span>
          )}
        </p>
      )}

      <details>
        <summary className="min-h-[44px] inline-flex items-center">تفاصيل المصدر والتوثيق</summary>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            نوع المصدر الخام: <span dir="auto">{evidence.sourceType}</span>
          </li>
          <li>{reliabilityBandLabel(evidence.reliabilityBand)}</li>
          <li>
            {evidence.verified ? 'دُرِج في جولة تحقق آلية' : 'لم يُدرَج في جولة تحقق آلية'}
          </li>
          <li>
            {isDuplicate
              ? `مكرر — الجذر الأصلي: ${evidence.duplicateOf ?? 'غير معروف'}`
              : 'ليس مكررًا (يُحتسب كدليل مستقل داخل القائمة)'}
          </li>
          {crossMerchant ? (
            <li>
              جذر هذا الدليل المكرر مسجَّل على تاجر آخر — راجع الإسناد قبل الاعتماد عليه.
            </li>
          ) : null}
          <li>
            التواريخ التقنية — نشر:{' '}
            <span dir="ltr" className="ltr-isolate">{evidence.publishedAt ?? 'غير معروف'}</span>
            {' · '}
            التقاط: <span dir="ltr" className="ltr-isolate">{evidence.capturedAt}</span>
          </li>
        </ul>
      </details>
    </article>
  );
}
