import Link from 'next/link';

import type { RelatedMerchant } from '@/lib/types';
import { relationLabel } from '@/lib/taxonomy';

/**
 * Possibly-related profiles. Always framed as "قد يكون مرتبطًا" — automated
 * link relations are never proof of shared ownership, and raw link
 * confidence is never shown.
 */
export function RelatedMerchants({ related }: { related: RelatedMerchant[] }) {
  if (related.length === 0) return null;
  return (
    <ul className="space-y-2">
      {related.map((entry) => (
        <li key={`${entry.id}:${entry.relation}`}>
          <Link
            href={`/merchant/${entry.id}`}
            className="inline-block min-h-[44px] underline underline-offset-2"
          >
            <span dir="auto">{entry.name}</span>
          </Link>
          {' — '}
          <span dir="auto">{relationLabel(entry.relation)}</span>
          {entry.rationale.trim().length > 0 ? (
            <span dir="auto"> — {entry.rationale}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
