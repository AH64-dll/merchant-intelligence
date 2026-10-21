import type { JSX } from 'react';
import Link from 'next/link';

import { t, type Locale } from '@/lib/i18n';

/**
 * Pure presentational footer content — matches Bayyna .footer layout
 * (tagline on start, note + mark on end), while preserving snapshot freshness
 * and privacy metadata for specs and transparency.
 *
 * Lives in its own file (not SiteFooter.tsx) so client components can import it
 * without pulling the server-only `getSnapshotInfo` singleton into the browser
 * bundle — a hard failure under `output: 'export'`.
 */
export function FooterContent({
  generatedAt,
  stale,
  locale = 'ar',
}: {
  generatedAt?: string;
  stale?: boolean;
  locale?: Locale;
}): JSX.Element {
  const strings = t(locale);
  const footerTagline = strings.footerTagline;
  const footerNote = strings.footerNote;
  const mark = locale === 'ar' ? 'د.' : 'D.';

  return (
    <>
      <span>
        <span>{footerTagline}</span>
        <span style={{ display: 'block', fontSize: '9px', opacity: 0.85, marginTop: '2px' }}>
          {generatedAt ? (
            <>
              {strings.snapshotGeneratedAt}{' '}
              <time dateTime={generatedAt.slice(0, 10)} dir="ltr">
                {generatedAt.slice(0, 10)}
              </time>
              {stale ? (
                <span className="font-bold" style={{ marginInlineStart: '6px' }}>
                  {strings.staleSnapshotWarning}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <span aria-hidden="true"> · </span>
                <Link href={`/${locale}/privacy`} className="inline-flex items-center min-h-[44px] underline hover:opacity-100" style={{ textDecoration: 'underline' }}>
                  {strings.privacy}
                </Link>
              </span>
            </>
          ) : (
            <Link href={`/${locale}/privacy`} className="inline-flex items-center min-h-[44px] underline hover:opacity-100" style={{ textDecoration: 'underline' }}>
              {strings.privacy}
            </Link>
          )}
        </span>
      </span>
      <span>
        <span>{footerNote}</span>
        <span className="footer-mark">{mark}</span>
      </span>
    </>
  );
}
