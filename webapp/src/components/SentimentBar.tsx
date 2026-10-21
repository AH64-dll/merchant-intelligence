import type { JSX } from 'react';

import type { SentimentCounts } from '@/lib/types';
import { sentimentLabel } from '@/lib/labels';
import { t, type Locale } from '@/lib/i18n';

/**
 * Evidence-direction section. Counts are over non-duplicate evidence only;
 * the duplicate count is always stated explicitly so the two bases are
 * never mixed silently.
 */
export function SentimentBar({
  sentiment,
  duplicateCount,
  locale = 'ar',
}: {
  sentiment: SentimentCounts;
  duplicateCount: number;
  locale?: Locale;
}): JSX.Element {
  const strings = t(locale);
  return (
    <section aria-labelledby="sentiment-heading" className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 space-y-3">
      <h2 id="sentiment-heading" className="font-semibold text-sm text-[#2a3441]">{strings.evidenceSentimentHeading}</h2>
      <dl className="flex flex-wrap gap-2.5">
        <div className="stance supporting inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="stance-dot shrink-0" aria-hidden="true" />
          <dt className="inline font-bold">{sentimentLabel('positive', locale)}: </dt>
          <dd className="inline">
            <span dir="ltr">{sentiment.positive}</span>
          </dd>
        </div>
        <div className="stance negative inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="stance-dot shrink-0" aria-hidden="true" />
          <dt className="inline font-bold">{sentimentLabel('negative', locale)}: </dt>
          <dd className="inline">
            <span dir="ltr">{sentiment.negative}</span>
          </dd>
        </div>
        <div className="stance mixed inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="stance-dot shrink-0" aria-hidden="true" />
          <dt className="inline font-bold">{sentimentLabel('neutral', locale)}: </dt>
          <dd className="inline">
            <span dir="ltr">{sentiment.neutral}</span>
          </dd>
        </div>
      </dl>
      <p className="text-xs text-[#56606a]">
        {duplicateCount > 0
          ? strings.sentimentDuplicateTally.replace('{count}', String(duplicateCount))
          : strings.sentimentZeroDuplicateTally}
      </p>
    </section>
  );
}
