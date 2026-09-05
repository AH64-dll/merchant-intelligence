import type { JSX } from 'react';
import Link from 'next/link';

import type { MerchantDirectoryEntry } from '@/lib/types';
import { MerchantSummaryCard } from './MerchantSummaryCard';
import { formatDateAr, safeHttpUrl, sourceCategoryLabel } from './display';

/**
 * Directory card for the positive-evidence view: the shared seller summary
 * plus the strongest selected positive evidence excerpt.
 *
 * The excerpt links to its exact evidence row on the seller detail page
 * (`#evidence-<id>`) and to the original source when it is a safe http(s)
 * URL. The selected highlight is one documented observation — never a
 * guarantee of the seller or of a purchase outcome.
 */
export function PositiveEvidenceCard({
  entry,
}: {
  entry: MerchantDirectoryEntry;
}): JSX.Element | null {
  if (entry.positiveHighlight === null) return null;
  const highlight = entry.positiveHighlight;
  return (
    <MerchantSummaryCard entry={entry}>
      <section aria-label="أبرز دليل إيجابي موثق" className="border-t border-black pt-2">
        <h3 className="text-base font-bold">أبرز دليل إيجابي موثق</h3>
        <p dir="auto">{highlight.summary}</p>
        <p className="text-sm">
          ملاحظات إيجابية موثَّقة من عملاء في مصادر مستقلة:{' '}
          <span dir="ltr">{entry.evidence.customerPositiveSources}</span> ·{' '}
          المصادر المستقلة للأدلة المنشورة:{' '}
          <span dir="ltr">{entry.evidence.distinctSources}</span>
        </p>
        <p className="text-sm">
          فئة المصدر: {sourceCategoryLabel(highlight.sourceCategory)}
          {' · '}
          نُشر:{' '}
          {highlight.publishedAt !== null ? (
            <time dateTime={highlight.publishedAt.slice(0, 10)} dir="ltr">
              {formatDateAr(highlight.publishedAt)}
            </time>
          ) : (
            'غير مؤرَّخ'
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Link
            href={`/merchant/${entry.id}#evidence-${highlight.evidenceId}`}
            className="inline-block min-h-[44px] underline underline-offset-2"
          >
            الدليل كاملًا في صفحة البائع
          </Link>
          {safeHttpUrl(highlight.sourceUrl) !== null ? (
            <a
              href={highlight.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block min-h-[44px] underline underline-offset-2"
              dir="ltr"
            >
              فتح المصدر الأصلي
            </a>
          ) : null}
        </p>
      </section>
    </MerchantSummaryCard>
  );
}
