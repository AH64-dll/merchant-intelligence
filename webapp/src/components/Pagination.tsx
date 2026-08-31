import type { JSX } from 'react';
import Link from 'next/link';

/**
 * One already-encoded query entry; `undefined` filters drop the pair so a
 * clean URL is the canonical form of an unfiltered directory/search page.
 */
export type QueryEntry = readonly [key: string, value: string];

/** Build a page link that preserves every normalized query parameter. */
function pageHref(basePath: string, page: number, query: readonly QueryEntry[]): string {
  const params = new URLSearchParams();
  for (const [key, value] of query) params.set(key, value);
  params.set('page', String(page));
  const qs = params.toString();
  return qs.length > 0 ? `${basePath}?${qs}` : basePath;
}

/**
 * Accessible pagination shared by search and both directory pages.
 *
 * Server-rendered links only — the current page is an aria-current span,
 * never a link, and every target is at least 44px tall. The window shows up
 * to five pages around the current one, always anchored to page 1.
 */
export function Pagination({
  basePath,
  page,
  totalPages,
  query = [],
  ariaLabel = 'تصفح النتائج',
}: {
  basePath: string;
  page: number;
  totalPages: number;
  /** Normalized query pairs preserved across page links. */
  query?: readonly QueryEntry[];
  ariaLabel?: string;
}): JSX.Element | null {
  if (totalPages <= 1) return null;
  const windowFrom = Math.max(1, Math.min(page - 2, totalPages - 4));
  const from = Math.max(1, windowFrom);
  const to = Math.min(totalPages, from + 4);
  const pages: number[] = [];
  for (let p = from; p <= to; p += 1) pages.push(p);
  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {prev !== null ? (
        <Link
          href={pageHref(basePath, prev, query)}
          className="inline-block min-h-[44px] border border-black px-3 py-2 underline"
        >
          السابق
        </Link>
      ) : null}
      {pages.map((p) =>
        p === page ? (
          <span key={p} aria-current="page" className="border border-black px-3 py-2 font-bold">
            <span dir="ltr">{p}</span>
          </span>
        ) : (
          <Link
            key={p}
            href={pageHref(basePath, p, query)}
            className="inline-block min-h-[44px] border border-black px-3 py-2 underline"
          >
            <span dir="ltr">{p}</span>
          </Link>
        ),
      )}
      {next !== null ? (
        <Link
          href={pageHref(basePath, next, query)}
          className="inline-block min-h-[44px] border border-black px-3 py-2 underline"
        >
          التالي
        </Link>
      ) : null}
      <span className="text-sm">
        صفحة <span dir="ltr">{page}</span> من <span dir="ltr">{totalPages}</span>
      </span>
    </nav>
  );
}
