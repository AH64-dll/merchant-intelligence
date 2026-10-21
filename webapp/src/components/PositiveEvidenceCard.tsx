import type { JSX } from 'react';
import Link from 'next/link';

import type { MerchantDirectoryEntry } from '@/lib/types';
import { t, type Locale } from '@/lib/i18n';
import { MerchantSummaryCard } from './MerchantSummaryCard';
import { displaySummary, formatDate, safeHttpUrl, sourceCategoryLabel } from './display';

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
  locale = 'ar',
}: {
  entry: MerchantDirectoryEntry;
  locale?: Locale;
}): JSX.Element | null {
  if (entry.positiveHighlight === null) return null;
  const strings = t(locale);
  const highlight = entry.positiveHighlight;
  const safeSourceUrl = safeHttpUrl(highlight.sourceUrl);

  return (
    <MerchantSummaryCard entry={entry} locale={locale}>
      <section aria-label={strings.highlightedPositiveEvidence} className="border-t border-[#e4e3de] pt-3 mt-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-xs font-semibold text-[#2a3441] leading-snug">{strings.highlightedPositiveEvidence}</h3>
          <span className="stance supporting shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="stance-dot shrink-0" aria-hidden="true" />
            <span>{locale === 'ar' ? 'إيجابي' : 'Positive'}</span>
          </span>
        </div>
        <p dir="auto" className="text-sm font-medium text-[#2a3441] leading-relaxed line-clamp-3">
          {displaySummary(highlight.summary, locale)}
        </p>
        <p className="text-xs text-[#56606a] flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {strings.positiveNotesFromCustomers}
            <span dir="ltr" className="font-semibold">{entry.evidence.customerPositiveSources}</span>
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span aria-hidden="true">·</span>
            <span>
              {strings.independentSourcesCountLabel}
              <span dir="ltr" className="font-semibold">{entry.evidence.distinctSources}</span>
            </span>
          </span>
        </p>
        <p className="text-xs text-[#56606a] flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {strings.sourceCategoryLabelPrefix}
            <strong className="font-medium text-[#2a3441]">{sourceCategoryLabel(highlight.sourceCategory, locale)}</strong>
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span aria-hidden="true">·</span>
            <span>
              {strings.publishedDatePrefix}
              {highlight.publishedAt !== null ? (
                <time dateTime={highlight.publishedAt.slice(0, 10)} dir="ltr">
                  {formatDate(highlight.publishedAt, locale)}
                </time>
              ) : (
                strings.undated
              )}
            </span>
          </span>
        </p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs pt-1">
          <Link
            href={`/${locale}/merchant/${entry.id}#evidence-${highlight.evidenceId}`}
            className="inline-flex min-h-[44px] items-center text-[#4a7c7e] hover:text-[#2a3441] underline underline-offset-2"
          >
            {strings.fullEvidenceOnMerchantPage}
          </Link>
          {safeSourceUrl !== null ? (
            <a
              href={safeSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center text-[#4a7c7e] hover:text-[#2a3441] underline underline-offset-2"
            >
              {strings.openOriginalSource}
            </a>
          ) : null}
        </p>
      </section>
    </MerchantSummaryCard>
  );
}
