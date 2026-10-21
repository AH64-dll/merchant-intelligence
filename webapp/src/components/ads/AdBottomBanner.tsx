import type { JSX } from 'react';
import type { AdBannerProps } from '@/lib/ads';
import { AdSlot } from './AdSlot';

/**
 * Bottom / footer banner ad slot.
 *
 * Layout: Horizontal leaderboard format.
 * CLS mitigation: Reserves ~130px on desktop and ~280px on mobile screens.
 * Env gate: Renders null when ads are disabled or slot/client IDs are not configured.
 */
export function AdBottomBanner({
  className = '',
  ...props
}: AdBannerProps): JSX.Element | null {
  return (
    <AdSlot
      format="horizontal"
      reservedHeightClass="min-h-[280px] sm:min-h-[130px]"
      fullWidthResponsive={true}
      className={`max-w-4xl mx-auto ${className}`.trim()}
      {...props}
    />
  );
}
