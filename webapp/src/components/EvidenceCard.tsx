import type { JSX } from 'react';

import type { EvidenceItem } from '@/lib/types';
import { reliabilityBandLabel, SENTIMENT_LABELS } from '@/lib/labels';
import { authorTypeLabel } from '@/lib/taxonomy';

/** Safe original link: only http/https is clickable; other schemes are text. */
function sourceLink(evidence: EvidenceItem): JSX.Element {
  const clickable = evidence.url.startsWith('http://') || evidence.url.startsWith('https://');
  if (clickable) {
    return (
      <a href={evidence.url} target="_blank" rel="noopener noreferrer" className="underline" dir="ltr">
        المصدر الأصلي
      </a>
    );
  }
  return <span dir="ltr">{evidence.url}</span>;
}

export function EvidenceCard({ evidence }: { evidence: EvidenceItem }): JSX.Element {
  const publishedText =
    evidence.publishedAt !== null && evidence.publishedAt.length >= 10
      ? evidence.publishedAt.slice(0, 10)
      : 'تاريخ النشر غير معروف';
  const capturedText = evidence.capturedAt.length >= 10 ? evidence.capturedAt.slice(0, 10) : evidence.capturedAt;
  const isDuplicate = evidence.duplicateOf !== null;
  const crossMerchant = evidence.duplicateRootMerchantId !== null;

  return (
    <article id={`evidence-${evidence.id}`} className="border border-black p-3 space-y-2">
      <p>
        [{SENTIMENT_LABELS[evidence.sentiment]}] · <span dir="auto">{evidence.platform}</span> ·{' '}
        {publishedText} · <span dir="auto">{authorTypeLabel(evidence.authorType)}</span> ·{' '}
        {sourceLink(evidence)}
      </p>
      <p dir="auto">{evidence.summary}</p>
      {evidence.quotedExcerpt.trim().length > 0 ? (
        <blockquote dir="auto" className="border-r-2 border-black pr-3">
          {evidence.quotedExcerpt}
        </blockquote>
      ) : null}
      <p>تم الالتقاط في: {capturedText}</p>
      <details>
        <summary>تفاصيل المصدر</summary>
        <ul>
          <li>
            نوع المصدر (خام): <span dir="auto">{evidence.sourceType}</span>
          </li>
          <li>{reliabilityBandLabel(evidence.reliabilityBand)}</li>
          <li>{evidence.verified ? 'دُرِج في جولة تحقق آلية' : 'لم يُدرَج في جولة تحقق آلية'}</li>
          <li>{evidence.independent ? 'غير مُعلَّم كمكرر' : 'مُعلَّم كمكرر'}</li>
          {isDuplicate ? (
            <li>
              مكرر من: <span dir="ltr">{evidence.duplicateOf}</span>
              {crossMerchant ? ' (الجذر على تاجر آخر — انتبه للإسناد)' : ''}
            </li>
          ) : null}
          <li>
            نشر: <span dir="ltr">{evidence.publishedAt ?? 'غير معروف'}</span> · التقاط:{' '}
            <span dir="ltr">{evidence.capturedAt}</span>
          </li>
        </ul>
      </details>
    </article>
  );
}
