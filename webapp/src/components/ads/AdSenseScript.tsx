import type { JSX } from 'react';
import { getAdSenseConfig, normalizePublisherId } from '@/lib/ads';

export interface AdSenseScriptProps {
  /** Optional override for client ID. Defaults to env. */
  clientId?: string;
  /** Optional override for enable state. Defaults to env. */
  enabled?: boolean;
}

/**
 * AdSense script loader and Consent Mode v2 initialization.
 *
 * Implements Consent Mode v2: denies ad_storage, ad_user_data, and
 * ad_personalization by default before the AdSense script executes.
 * In Next.js 15 / React 19, async script tags are natively hoisted into <head>.
 *
 * Returns null if ads are disabled or publisher ID is missing.
 */
export function AdSenseScript({
  clientId,
  enabled,
}: AdSenseScriptProps = {}): JSX.Element | null {
  const config = getAdSenseConfig();
  const isEnabled = enabled !== undefined ? enabled : config.enabled;
  const rawId = clientId ?? config.clientId;

  if (!isEnabled || !rawId) {
    return null;
  }

  const normalizedClient = normalizePublisherId(rawId);

  // Consent Mode v2 initialization snippet:
  // Must execute before the AdSense script tag to set initial privacy boundaries.
  const consentSnippet = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied'});`;

  return (
    <>
      <script
        id="google-consent-default"
        dangerouslySetInnerHTML={{ __html: consentSnippet }}
      />
      <script
        id="google-adsense"
        async
        crossOrigin="anonymous"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${normalizedClient}`}
      />
    </>
  );
}
