import type { JSX } from 'react';

import { getSnapshotInfo } from '@/lib/singletons';
import type { Locale } from '@/lib/i18n';
import { ageInDays, STALE_SNAPSHOT_DAYS } from './display';
import { FooterContent } from './SiteFooterContent';

export { FooterContent };

/** Footer: Bayyna .footer layout with snapshot freshness + privacy link. */
export function SiteFooter({ locale }: { locale: Locale }): JSX.Element {
  const generatedAt = getSnapshotInfo().generatedAt;
  const days = ageInDays(generatedAt);
  return (
    <footer className="footer">
      <FooterContent
        generatedAt={generatedAt}
        stale={days !== null && days > STALE_SNAPSHOT_DAYS}
        locale={locale}
      />
    </footer>
  );
}
