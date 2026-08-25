import type { JSX } from 'react';

import type { MerchantDetail } from '@/lib/types';

const RELATION_LABELS: Record<string, string> = {
  identifier_collision: 'تطابق معرفات',
  name_identifier_conflict: 'تعارض اسم/معرف',
};

export function RelatedMerchants({ related }: { related: MerchantDetail['related'] }): JSX.Element | null {
  if (related.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-1">
      {related.map((entry) => (
        <li key={entry.id}>
          <a href={`/merchant/${entry.id}`} className="underline">
            <span dir="auto">{entry.name}</span>
          </a>{' '}
          — {RELATION_LABELS[entry.relation] ?? entry.relation} ({Math.round(entry.confidence * 100)}%)
        </li>
      ))}
    </ul>
  );
}
