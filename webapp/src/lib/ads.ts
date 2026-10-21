/**
 * Google AdSense integration helpers and configuration.
 *
 * Configuration is gated via environment variables:
 * - NEXT_PUBLIC_ENABLE_ADS: 'true' | '1' | 'yes' | 'on' to enable. Safe default is disabled.
 * - NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID: Publisher ID (e.g. 'ca-pub-1234567890123456' or 'pub-1234567890123456').
 * - NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM: Slot ID for the footer/bottom horizontal banner.
 * - NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR: Slot ID for the sidebar rectangle/vertical unit.
 */

export interface AdSenseConfig {
  enabled: boolean;
  clientId: string | null;
  slots: {
    bottom: string | null;
    sidebar: string | null;
  };
}

export interface AdBannerProps {
  /** Optional override for publisher client ID. Defaults to env. */
  clientId?: string;
  /** Optional override for ad slot ID. Defaults to env. */
  slotId?: string;
  /** Optional master enable flag override. Defaults to env. */
  enabled?: boolean;
  /** Additional CSS classes for the outer container. */
  className?: string;
  /** Custom inline styles for the outer container. */
  style?: React.CSSProperties;
  /** Language/locale for the ad badge label ('ar' -> «إعلان», 'en' -> “Ad”). */
  locale?: 'ar' | 'en';
  /** Custom text for the ad badge label. Overrides locale default. */
  label?: string;
}

/** Check whether ads are globally enabled in the environment. */
export function areAdsEnabled(): boolean {
  const val = process.env.NEXT_PUBLIC_ENABLE_ADS?.trim().toLowerCase();
  return val === 'true' || val === '1' || val === 'yes' || val === 'on';
}

/**
 * Normalizes publisher ID to canonical AdSense format ('ca-pub-XXXXXXXXXXXXXXXX').
 * Handles 'pub-XXXXXXXX', 'ca-pub-XXXXXXXX', or raw numeric strings.
 */
export function normalizePublisherId(rawId: string): string {
  const trimmed = rawId.trim();
  if (trimmed.startsWith('ca-pub-')) {
    return trimmed;
  }
  if (trimmed.startsWith('pub-')) {
    return `ca-${trimmed}`;
  }
  if (trimmed.startsWith('ca-')) {
    return trimmed;
  }
  return `ca-pub-${trimmed}`;
}

/**
 * Reads and validates AdSense configuration from environment variables.
 * Both enabled flag AND valid client ID are required for `enabled: true`.
 */
export function getAdSenseConfig(): AdSenseConfig {
  const enabled = areAdsEnabled();
  const rawClientId = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID?.trim() || null;
  const clientId = rawClientId ? normalizePublisherId(rawClientId) : null;
  const bottomSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM?.trim() || null;
  const sidebarSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR?.trim() || null;

  return {
    enabled: Boolean(enabled && clientId),
    clientId,
    slots: {
      bottom: bottomSlot,
      sidebar: sidebarSlot,
    },
  };
}

/**
 * Brand safety policy check (used by `app/merchant/[id]/page.tsx` and detail views):
 * Google AdSense policy and editorial integrity forbid displaying advertising alongside
 * adverse claims, official warnings, or high-risk flags about a named seller.
 *
 * Returns false if the merchant has adverse claims, official warnings, or high risk signals,
 * signaling the caller to suppress ad slots.
 */
export function canDisplayAdsOnPage(options?: {
  hasAdverseClaims?: boolean;
  hasOfficialWarning?: boolean;
  isHighRisk?: boolean;
}): boolean {
  if (!options) return true;
  if (options.hasAdverseClaims || options.hasOfficialWarning || options.isHighRisk) {
    return false;
  }
  return true;
}
