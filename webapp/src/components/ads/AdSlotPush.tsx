'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * Pushes an ad request to window.adsbygoogle on mount.
 * Wrapped in try/catch to safely handle ad blockers or blocked CDN loaders.
 */
export function AdSlotPush() {
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) {
      return;
    }
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Ad blocker, script blocker, or duplicate push should not crash the page.
    }
  }, []);

  return null;
}
