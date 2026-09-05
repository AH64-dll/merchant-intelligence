import type { JSX, ReactNode } from 'react';

import type { ClaimItem, EvidenceItem } from '@/lib/types';
import { claimTypeLabel } from '@/lib/taxonomy';
import { SENTIMENT_LABELS } from '@/lib/labels';
import { formatDateAr, sourceCategoryLabel } from './display';
import { SourceCitations } from './SourceCitations';

function EvidenceAnchors({ evidenceIds }: { evidenceIds: string[] }): ReactNode {
  if (evidenceIds.length === 0) return null;
  return (
    <p className="text-xs text-neutral-600">
      الأدلة المرتبطة:{' '}
      {evidenceIds.slice(0, 5).map((evidenceId, index) => (
        <span key={evidenceId}>
          {index > 0 ? ' · ' : ''}
          <a href={`#evidence-${evidenceId}`} className="underline" dir="ltr">
            دليل {index + 1}
          </a>
        </span>
      ))}
    </p>
  );
}

function ClaimCard({
  claim,
  evidence,
}: {
  claim: ClaimItem;
  evidence?: EvidenceItem[];
}): JSX.Element {
  const linkedEvidence = evidence
    ? evidence.filter((e) => claim.evidenceIds.includes(e.id))
    : [];

  let latestDate: string | null = null;
  for (const item of linkedEvidence) {
    const d = item.publishedAt ?? item.capturedAt;
    if (latestDate === null || d > latestDate) {
      latestDate = d;
    }
  }

  const primaryCategory = linkedEvidence.length > 0 ? linkedEvidence[0].sourceCategory : null;

  return (
    <article className="border border-black p-3 space-y-2">
      <dl className="space-y-1">
        <div>
          <dt className="font-bold">النوع</dt>
          <dd dir="auto">{claimTypeLabel(claim.claimType)}</dd>
        </div>
        <div>
          <dt className="font-bold">التوجه</dt>
          <dd>{SENTIMENT_LABELS[claim.sentiment]}</dd>
        </div>
        {primaryCategory !== null ? (
          <div>
            <dt className="font-bold">فئة المصدر</dt>
            <dd dir="auto">{sourceCategoryLabel(primaryCategory)}</dd>
          </div>
        ) : null}
        {latestDate !== null ? (
          <div>
            <dt className="font-bold">أحدث تاريخ مسجل</dt>
            <dd dir="ltr">
              <time dateTime={latestDate.slice(0, 10)}>{formatDateAr(latestDate)}</time>
            </dd>
          </div>
        ) : null}
        {claim.summary.trim().length > 0 ? (
          <div>
            <dt className="font-bold">الملخص</dt>
            <dd dir="auto">{claim.summary}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-bold">مصادر غير مكررة</dt>
          <dd>
            <span dir="ltr">{claim.independentSourceCount}</span>
          </dd>
        </div>
        <div>
          <dt className="font-bold">إجمالي الملاحظات</dt>
          <dd>
            <span dir="ltr">{claim.mentionCount}</span>
          </dd>
        </div>
      </dl>

      {/* ALL direct web citations without cap */}
      {linkedEvidence.length > 0 ? (
        <div className="pt-1">
          <SourceCitations evidence={linkedEvidence} />
        </div>
      ) : null}

      <EvidenceAnchors evidenceIds={claim.evidenceIds} />
    </article>
  );
}

/** Responsive semantic claim cards — never a wide table on mobile. */
export function ClaimCards({
  claims,
  evidence,
}: {
  claims: ClaimItem[];
  evidence?: EvidenceItem[];
}): JSX.Element | null {
  if (claims.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {claims.map((claim) => (
        <ClaimCard key={claim.id} claim={claim} evidence={evidence} />
      ))}
    </div>
  );
}
