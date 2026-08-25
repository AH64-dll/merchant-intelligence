import type { JSX } from 'react';
import type { SentimentCounts } from '@/lib/types';

export function SentimentBar({ sentiment }: { sentiment: SentimentCounts }): JSX.Element {
  return (
    <section aria-labelledby="sentiment-heading">
      <h2 id="sentiment-heading">التقييمات</h2>
      <p>إيجابي: {sentiment.positive} · سلبي: {sentiment.negative} · محايد: {sentiment.neutral}</p>
    </section>
  );
}
