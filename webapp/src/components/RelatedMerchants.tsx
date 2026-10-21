import Link from 'next/link';

import type { RelatedMerchant } from '@/lib/types';
import { relationLabel } from '@/lib/labels';
import type { Locale } from '@/lib/i18n';

/**
 * Possibly-related profiles. Always framed as "قد يكون مرتبطًا" — automated
 * link relations are never proof of shared ownership, and raw link
 * confidence is never shown.
 */
export function RelatedMerchants({
  related,
  locale = 'ar',
}: {
  related: RelatedMerchant[];
  locale?: Locale;
}) {
  if (related.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 list-none p-0 m-0">
      {related.map((entry) => (
        <li
          key={`${entry.id}:${entry.relation}`}
          className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-3.5 space-y-1 transition-colors"
        >
          <div>
            <Link
              href={`/${locale}/merchant/${entry.id}`}
              className="inline-flex min-h-[44px] items-center text-sm font-medium text-[#2a3441] hover:text-[#4a7c7e] underline underline-offset-2"
            >
              <span dir="auto">{entry.name}</span>
            </Link>
          </div>
          <p className="text-xs text-[#56606a]" dir="auto">
            <span>{relationLabel(entry.relation, locale)}</span>
            {entry.rationale.trim().length > 0 ? (
              <span> — {entry.rationale}</span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
