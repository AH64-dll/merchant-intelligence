'use client';

import { AlertCircle, RotateCcw } from 'lucide-react';
import { localeFromPathname, t } from '@/lib/i18n';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Error boundaries only ever render client-side — window is safe.
  // Error boundaries render only on the client — window is safe.
  const locale = localeFromPathname(window.location.pathname);
  const strings = t(locale);

  return (
    <section className="search-empty-panel" role="alert">
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
  );
}
