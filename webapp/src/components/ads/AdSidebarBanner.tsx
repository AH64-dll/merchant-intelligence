import type { JSX } from 'react';
import type { AdBannerProps } from '@/lib/ads';
import { AdSlot } from './AdSlot';

/**
 * Sidebar banner ad slot.
 *
 * Layout: Medium rectangle / vertical format tailored for a ~300px column.
 * CLS mitigation: Reserves 250px height upfront.
 * Env gate: Renders null when ads are disabled or slot/client IDs are not configured.
 */
export function AdSidebarBanner({
  className = '',
  ...props
}: AdBannerProps): JSX.Element | null {
  return (
    <AdSlot
      format="rectangle"
      reservedHeightClass="min-h-[250px]"
      fullWidthResponsive={false}
      className={`w-full max-w-[300px] mx-auto ${className}`.trim()}
      {...props}
    />
  );
}
