'use client';

import { AlertCircle, RotateCcw } from 'lucide-react';
import { DIR_FOR, localeFromPathname, t } from '@/lib/i18n';


/**
 * Root-level error boundary. `app/error.tsx` cannot catch failures thrown by
 * the root layout, so this file replaces the whole document with generic,
 * non-leaking copy in the active locale. No error details are rendered.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Error boundaries render only on the client — window is safe.
  const locale = localeFromPathname(window.location.pathname);
  const dir = DIR_FOR[locale];
  const strings = t(locale);

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body>
        <main
          className="main-content"
          style={{
            display: 'flex',
            minHeight: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <section
            className="search-empty-panel"
            role="alert"
            style={{ maxWidth: '600px', width: '100%' }}
          >
            <div className="large-empty-icon" aria-hidden="true">
              <AlertCircle size={38} />
            </div>
            <h2>{strings.errorTitle}</h2>
            <p>{strings.errorDesc}</p>
            <div className="empty-actions">
              <button
                type="button"
                onClick={() => reset()}
                className="secondary-button"
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span>{strings.retry}</span>
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
