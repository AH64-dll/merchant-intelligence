import type { JSX } from 'react';

import type { EvidenceItem } from '@/lib/types';
import { reliabilityBandLabel } from '@/lib/labels';

const SENTIMENT_LABELS: Record<EvidenceItem['sentiment'], string> = {
  positive: 'إيجابي',
  negative: 'سلبي',
  neutral: 'محايد',
};

export function EvidenceCard({ evidence }: { evidence: EvidenceItem }): JSX.Element {
  const dateText = evidence.publishedAt ? evidence.publishedAt.slice(0, 10) : '—';
  return (
    <div className="border border-black p-3 space-y-2">
      <p>
        [{SENTIMENT_LABELS[evidence.sentiment]}] · <span dir="auto">{evidence.platform}</span> · {dateText}
        {evidence.independent ? ' · مستقل' : ''}
      </p>
      <p dir="auto">{evidence.summary}</p>
      {evidence.quotedExcerpt.trim().length > 0 ? (
        <blockquote dir="auto" className="border-r-2 border-black pr-3">
          {evidence.quotedExcerpt}
        </blockquote>
      ) : null}
      <p>
        الثقة: {Math.round(evidence.confidence * 100)}% · {reliabilityBandLabel(evidence.reliabilityBand)}
      </p>
    </div>
  );
}
