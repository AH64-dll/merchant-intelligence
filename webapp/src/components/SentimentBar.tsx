import type { JSX } from 'react';

import type { SentimentCounts } from '@/lib/types';
import { SENTIMENT_LABELS } from '@/lib/labels';

/**
 * Evidence-direction section. Counts are over non-duplicate evidence only;
 * the duplicate count is always stated explicitly so the two bases are
 * never mixed silently.
 */
export function SentimentBar({
  sentiment,
  duplicateCount,
}: {
  sentiment: SentimentCounts;
  duplicateCount: number;
}): JSX.Element {
  return (
    <section aria-labelledby="sentiment-heading">
      <h2 id="sentiment-heading">اتجاه الأدلة</h2>
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        <div>
          <dt className="inline font-bold">{SENTIMENT_LABELS.positive}: </dt>
          <dd className="inline">
            <span dir="ltr">{sentiment.positive}</span>
          </dd>
        </div>
        <div>
          <dt className="inline font-bold">{SENTIMENT_LABELS.negative}: </dt>
          <dd className="inline">
            <span dir="ltr">{sentiment.negative}</span>
          </dd>
        </div>
        <div>
          <dt className="inline font-bold">{SENTIMENT_LABELS.neutral}: </dt>
          <dd className="inline">
            <span dir="ltr">{sentiment.neutral}</span>
          </dd>
        </div>
      </dl>
      <p className="text-sm">
        تُحتسب الأعداد أعلاه من الأدلة غير المكررة فقط
        {duplicateCount > 0 ? (
          <>
            {' — '}استُثني <span dir="ltr">{duplicateCount}</span> دليل مكرر
          </>
        ) : (
          ' — ولا توجد أدلة مكررة مستثناة'
        )}
        .
      </p>
    </section>
  );
}
