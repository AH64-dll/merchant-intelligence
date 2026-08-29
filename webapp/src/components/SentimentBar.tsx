import type { JSX } from 'react';

import type { SentimentCounts } from '@/lib/types';

const SENTIMENT_LABELS: Record<keyof SentimentCounts, string> = {
  positive: 'إيجابي',
  negative: 'سلبي',
  neutral: 'محايد',
};

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
      <p>
        {SENTIMENT_LABELS.positive}: {sentiment.positive} · {SENTIMENT_LABELS.negative}: {sentiment.negative} ·{' '}
        {SENTIMENT_LABELS.neutral}: {sentiment.neutral}
        {' '}
        <span dir="auto">(تُحتسب من الأدلة غير المكررة فقط{duplicateCount > 0 ? ` — ${duplicateCount} دليل مكرر مستثنى` : ''})</span>
      </p>
    </section>
  );
}
