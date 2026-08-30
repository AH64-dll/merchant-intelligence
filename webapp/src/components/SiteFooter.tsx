import type { JSX } from 'react';

import { getSnapshotInfo } from '@/lib/singletons';
import { ageInDays, STALE_SNAPSHOT_DAYS } from './display';

/**
 * Pure presentational footer content — the seam used by component specs so
 * tests never touch the snapshot database.
 */
export function FooterContent({
  generatedAt,
  stale,
}: {
  generatedAt: string;
  stale: boolean;
}): JSX.Element {
  return (
    <>
      <p>
        النتائج مبنية على بحث آلي في مصادر عامة، وقد تكون قديمة أو غير مكتملة،
        وهي ليست ضمانًا ولا حكمًا نهائيًا على أي تاجر — راجع المصادر الأصلية
        بنفسك.
      </p>
      <p className="mt-2">
        لقطة البيانات وُلِّدت في:{' '}
        <time dateTime={generatedAt.slice(0, 10)} dir="ltr">
          {generatedAt.slice(0, 10)}
        </time>
        {stale ? (
          <span className="font-bold">
            {' '}— لقطة أقدم من أسبوع؛ قد تكون البيانات قديمة، حدِّث اللقطة.
          </span>
        ) : null}
      </p>
    </>
  );
}

/** Server footer: reads the snapshot manifest for the freshness caption. */
export async function SiteFooter(): Promise<JSX.Element> {
  const generatedAt = getSnapshotInfo().generatedAt;
  const days = ageInDays(generatedAt);
  return (
    <footer className="border-t border-black pt-4 mt-12 text-sm">
      <FooterContent generatedAt={generatedAt} stale={days !== null && days > STALE_SNAPSHOT_DAYS} />
    </footer>
  );
}
