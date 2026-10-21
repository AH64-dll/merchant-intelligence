import type { JSX } from 'react';
import { getAdSenseConfig, normalizePublisherId, type AdBannerProps } from '@/lib/ads';
import { AdSlotPush } from './AdSlotPush';

export interface AdSlotProps extends AdBannerProps {
  /** Ad unit layout format ('horizontal' | 'rectangle' | 'vertical' | 'auto'). */
  format: 'horizontal' | 'rectangle' | 'vertical' | 'auto';
  /** Tailwind min-height reservation class (e.g. 'min-h-[280px] sm:min-h-[130px]'). */
  reservedHeightClass: string;
  /** Whether to allow Google to expand the ad unit to full viewport width. */
  fullWidthResponsive?: boolean;
}

/**
 * Base AdSense ad unit slot.
 *
 * Requirements:
 * 1. Env-gated: Returns null if ads are disabled or client/slot IDs are missing.
 * 2. CLS-safe: Reserves vertical space upfront using `reservedHeightClass`.
 * 3. Auto-collapsing: Disappears when AdSense sets data-ad-status="unfilled".
 * 4. Distinct presentation: Dashed hairline border + small advertisement badge.
 */
export function AdSlot({
  clientId,
  slotId,
  enabled,
  format,
  reservedHeightClass,
  fullWidthResponsive = true,
  className = '',
  style,
  locale = 'ar',
  label,
}: AdSlotProps): JSX.Element | null {
  const config = getAdSenseConfig();
  const isEnabled = enabled !== undefined ? enabled : config.enabled;
  const effectiveClientId = clientId ? normalizePublisherId(clientId) : config.clientId;
  const effectiveSlotId = slotId ?? (format === 'horizontal' ? config.slots.bottom : config.slots.sidebar);

  if (!isEnabled || !effectiveClientId || !effectiveSlotId) {
    return null;
  }

  const badgeText = label ?? (locale === 'en' ? '“Ad”' : '«إعلان»');
  const badgeAria = locale === 'en' ? 'Advertisement' : 'إعلان';

  return (
    <div
      className={`ad-slot w-full ${reservedHeightClass} flex flex-col items-center justify-center p-2 my-4 border border-dashed border-[#e4e3de] bg-[#fdfcf9] rounded-[5px] transition-all has-[ins[data-ad-status='unfilled']]:hidden ${className}`.trim()}
      style={style}
    >
      <style>{`.ad-slot:has(ins[data-ad-status='unfilled']) { display: none !important; }`}</style>
      <div
        className="text-[11px] font-sans tracking-wider text-[#7a8085] uppercase select-none mb-1 text-center"
        aria-label={badgeAria}
      >
        {badgeText}
      </div>
      <div className="w-full flex justify-center items-center overflow-hidden">
        <ins
          className="adsbygoogle"
          style={{ display: 'block', width: '100%' }}
          data-ad-client={effectiveClientId}
          data-ad-slot={effectiveSlotId}
          data-ad-format={format}
          data-full-width-responsive={fullWidthResponsive ? 'true' : undefined}
        />
      </div>
      <AdSlotPush />
    </div>
  );
}
