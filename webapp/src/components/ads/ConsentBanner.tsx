'use client';

import { useSyncExternalStore, useState } from 'react';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const CONSENT_COOKIE_NAME = 'mi_ad_consent';

function getStoredConsent(): 'accepted' | 'rejected' | 'pending' {
  if (typeof document === 'undefined') {
    return 'pending';
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE_NAME}=([^;]*)`));
  if (match) {
    return match[1] === 'accepted' ? 'accepted' : 'rejected';
  }
  return 'pending';
}

function subscribe() {
  return () => {};
}

export interface ConsentBannerProps {
  /** Optional language override ('ar' | 'en'). Defaults to 'ar'. */
  locale?: 'ar' | 'en';
}

/**
 * Cookie consent banner for Google AdSense Consent Mode v2.
 * Uses useSyncExternalStore to avoid hydration mismatch and setState in effects.
 */
export function ConsentBanner({ locale = 'ar' }: ConsentBannerProps) {
  const [overrideState, setOverrideState] = useState<'accepted' | 'rejected' | null>(null);
  const storedState = useSyncExternalStore(subscribe, getStoredConsent, () => 'pending');
  const currentState = overrideState ?? storedState;

  if (currentState !== 'pending') {
    return null;
  }

  const handleChoice = (accepted: boolean) => {
    const value = accepted ? 'accepted' : 'rejected';
    const maxAge = 60 * 60 * 24 * 365; // 1 year
    document.cookie = `${CONSENT_COOKIE_NAME}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;

    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        ad_storage: accepted ? 'granted' : 'denied',
        ad_user_data: accepted ? 'granted' : 'denied',
        ad_personalization: accepted ? 'granted' : 'denied',
        analytics_storage: accepted ? 'granted' : 'denied',
      });
    }

    setOverrideState(value);
  };

  const isAr = locale === 'ar';

  return (
    <aside
      role="region"
      aria-label={isAr ? 'إشعار الخصوصية وملفات تعريف الارتباط' : 'Privacy and cookie notice'}
      className="fixed bottom-0 inset-x-0 z-50 p-4 bg-[#fdfcf9] border-t border-[#e4e3de] shadow-[0_-4px_16px_rgba(42,52,65,0.06)] text-sm text-[#2a3441]"
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-xs sm:text-sm leading-relaxed text-[#56606a]">
          {isAr
            ? 'نستخدم ملفات تعريف الارتباط لتحسين تجربة التصفح وعرض الإعلانات المناسبة وفق سياسة الخصوصية.'
            : 'We use cookies to improve your browsing experience and display relevant advertising according to our privacy policy.'}
        </p>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleChoice(false)}
            className="px-4 py-2 border border-[#e4e3de] bg-[#f5f3ef] hover:bg-[#eae8e3] text-[#2a3441] rounded-[4px] transition-colors text-xs font-medium"
          >
            {isAr ? 'رفض' : 'Reject'}
          </button>
          <button
            type="button"
            onClick={() => handleChoice(true)}
            className="px-4 py-2 bg-[#4a7c7e] text-white hover:bg-[#3d686a] rounded-[4px] transition-colors text-xs font-medium"
          >
            {isAr ? 'موافق' : 'Accept'}
          </button>
        </div>
      </div>
    </aside>
  );
}
