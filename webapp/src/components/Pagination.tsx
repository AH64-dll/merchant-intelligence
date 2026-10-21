import type { JSX } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { t, type Locale } from '@/lib/i18n';

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
 * never a link, and every target is touch-accessible. The window shows up
 * to five pages around the current one, always anchored to page 1.
 */
export function Pagination({
  basePath,
  page,
  totalPages,
  query = [],
  ariaLabel,
  locale = 'ar',
}: {
  basePath: string;
  page: number;
  totalPages: number;
  /** Normalized query pairs preserved across page links. */
  query?: readonly QueryEntry[];
  ariaLabel?: string;
  locale?: Locale;
}): JSX.Element | null {
  if (totalPages <= 1) return null;
  const strings = t(locale);
  const isEn = locale === 'en';
  const activeAriaLabel = ariaLabel ?? strings.paginationAria;

  const windowFrom = Math.max(1, Math.min(page - 2, totalPages - 4));
  const from = Math.max(1, windowFrom);
  const to = Math.min(totalPages, from + 4);
  const pages: number[] = [];
  for (let p = from; p <= to; p += 1) pages.push(p);
  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;

  return (
    <nav
      aria-label={activeAriaLabel}
      className="pagination w-full flex flex-wrap items-center justify-between gap-3 text-xs"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {prev !== null ? (
          <Link
            href={pageHref(basePath, prev, query)}
            className="pagination-item pagination-prev inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-[var(--border)] bg-[var(--paper)] px-3 py-1.5 text-[var(--ink)] transition-colors hover:border-[#ccd4cb] hover:text-[var(--teal)]"
          >
            {isEn ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
            <span>{strings.previous}</span>
          </Link>
        ) : null}

        {pages.map((p) =>
          p === page ? (
            <span
              key={p}
              aria-current="page"
              className="pagination-item pagination-active inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-[var(--ink)] bg-[var(--ink)] px-3 py-1.5 font-medium !text-[#f8f8f3]"
            >
              <span dir="ltr">{p}</span>
            </span>
          ) : (
            <Link
              key={p}
              href={pageHref(basePath, p, query)}
              className="pagination-item hidden sm:inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-[var(--border)] bg-[var(--paper)] px-3 py-1.5 text-[var(--ink)] transition-colors hover:border-[#ccd4cb] hover:text-[var(--teal)]"
            >
              <span dir="ltr">{p}</span>
            </Link>
          ),
        )}

        {next !== null ? (
          <Link
            href={pageHref(basePath, next, query)}
            className="pagination-item pagination-next inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-[var(--border)] bg-[var(--paper)] px-3 py-1.5 text-[var(--ink)] transition-colors hover:border-[#ccd4cb] hover:text-[var(--teal)]"
          >
            <span>{strings.next}</span>
            {isEn ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </Link>
        ) : null}
      </div>

      <span className="pagination-status text-xs text-[#525a62]">
        {strings.page} <strong className="font-medium text-[var(--ink)]" dir="ltr">{page}</strong> {strings.pageOf}{' '}
        <strong className="font-medium text-[var(--ink)]" dir="ltr">{totalPages}</strong>
      </span>
    </nav>
  );
}
