'use client';

import { useSearchParams } from 'next/navigation';
import type { JSX } from 'react';

import { SearchBox } from './SearchBox';
import type { Locale } from '@/lib/i18n';

/**
 * SearchBox variant that reads `?q=` from the URL itself.
 * Used ONLY on /[locale]/search inside a Suspense boundary — keeping
 * useSearchParams out of plain <SearchBox> avoids forcing Suspense on
 * every page that embeds it (home, directory) under `output: 'export'`.
 */
export function SearchBoxFromParams({
  locale,
  compact,
}: {
  locale: Locale;
  compact?: boolean;
}): JSX.Element {
  const params = useSearchParams();
  return <SearchBox locale={locale} compact={compact} initial={params?.get('q') ?? ''} />;
}
