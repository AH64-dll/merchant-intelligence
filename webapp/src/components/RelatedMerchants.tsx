import type { JSX } from 'react';

import type { RelatedMerchant } from '@/lib/types';
import { relationLabel } from '@/lib/taxonomy';

export function RelatedMerchants({ related }: { related: RelatedMerchant[] }): JSX.Element | null {
  if (related.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-1">
      {related.map((entry) => (
        <li key={`${entry.id}:${entry.relation}`}>
          <a href={`/merchant/${entry.id}`} className="underline">
            <span dir="auto">{entry.name}</span>
          </a>{' '}
          — <span dir="auto">{relationLabel(entry.relation)}</span>
          {entry.rationale.trim().length > 0 ? (
            <span dir="auto"> — {entry.rationale}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
