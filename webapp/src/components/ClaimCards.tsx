import type { JSX, ReactNode } from 'react';

import type { ClaimItem } from '@/lib/types';
import { claimTypeLabel } from '@/lib/taxonomy';
import { SENTIMENT_LABELS } from '@/lib/labels';

function EvidenceAnchors({ evidenceIds }: { evidenceIds: string[] }): ReactNode {
  if (evidenceIds.length === 0) return null;
  return (
    <p>
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

function ClaimCard({ claim }: { claim: ClaimItem }): JSX.Element {
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
      <EvidenceAnchors evidenceIds={claim.evidenceIds} />
    </article>
  );
}

/** Responsive semantic claim cards — never a wide table on mobile. */
export function ClaimCards({ claims }: { claims: ClaimItem[] }): JSX.Element | null {
  if (claims.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {claims.map((claim) => (
        <ClaimCard key={claim.id} claim={claim} />
      ))}
    </div>
  );
}
