'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Locale } from '@/lib/i18n';

export function CopyReportButton({ locale }: { locale: Locale }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 3000);
    } catch {
      setCopyState('failed');
    }
  }

  const copyText = locale === 'ar' ? 'نسخ رابط التقرير' : 'Copy report link';
  const copiedText = locale === 'ar' ? 'تم نسخ الرابط' : 'Report link copied';
  const failedText =
    locale === 'ar'
      ? 'تعذّر النسخ؛ يمكنك نسخ الرابط من شريط العنوان.'
      : 'Copy failed; you can copy the link from the address bar.';

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        className="copy-button"
        onClick={copy}
        aria-label={copyText}
      >
        {copyState === 'copied' ? (
          <Check size={16} aria-hidden="true" />
        ) : (
          <Copy size={16} aria-hidden="true" />
        )}
        <span>{copyState === 'copied' ? copiedText : copyText}</span>
      </button>
      {copyState === 'failed' && (
        <p className="input-error text-xs mt-1" role="status">
          {failedText}
        </p>
      )}
    </div>
  );
}
