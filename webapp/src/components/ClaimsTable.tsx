import type { ReactNode } from 'react';

import type { ClaimItem } from '@/lib/types';
import { claimTypeLabel } from '@/lib/taxonomy';
import { SENTIMENT_LABELS } from '@/lib/labels';

export function ClaimsTable({ claims }: { claims: ClaimItem[] }): ReactNode | null {
  if (claims.length === 0) {
    return null;
  }
  return (
    <div className="space-y-3">
      {claims.map((claim) => (
        <article key={claim.id} className="border border-black p-2 space-y-1">
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
              <dt className="font-bold">المصادر غير المكررة</dt>
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
          {claim.evidenceIds.length > 0 ? (
            <p>
              الأدلة المرتبطة:{' '}
              {claim.evidenceIds.slice(0, 5).map((evidenceId, index) => (
                <span key={evidenceId}>
                  {index > 0 ? ' · ' : ''}
                  <a href={`#evidence-${evidenceId}`} className="underline" dir="ltr">
                    {evidenceId}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
