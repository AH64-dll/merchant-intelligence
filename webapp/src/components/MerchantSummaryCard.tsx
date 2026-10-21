import type { JSX, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Fingerprint } from 'lucide-react';

import type { MerchantDirectoryEntry } from '@/lib/types';
import {
  coverageLevelLabel,
  identityLevelLabel,
  sentimentLabel,
} from '@/lib/labels';
import { t, type Locale } from '@/lib/i18n';
import { formatDate } from './display';

/**
 * Public seller summary card — the one shared markup for both directories.
 *
 * Renders only the safe projection fields: no state, no confidence numbers,
 * no reliability band. The location count is always labeled as stored
 * records, never a claimed branch count. The seller name links to the
 * detail page; every interactive target is ≥44px tall.
 */
export function MerchantSummaryCard({
  entry,
  children,
  locale = 'ar',
}: {
  entry: MerchantDirectoryEntry;
  children?: ReactNode;
  locale?: Locale;
}): JSX.Element {
  const strings = t(locale);
  const delimiter = locale === 'en' ? ', ' : '، ';
  const { evidence } = entry;

  const Chevron = locale === 'ar' ? ChevronLeft : ChevronRight;

  return (
    <article className="merchant-card space-y-3">
      <div className="flex items-start justify-between gap-3 border-b border-[#e4e3de] pb-2">
        <h2 className="text-base font-semibold text-[#2a3441]">
          <Link
            href={`/${locale}/merchant/${entry.id}`}
            className="card-title-link"
          >
            <Fingerprint size={18} className="text-[#4a7c7e] flex-shrink-0" aria-hidden="true" />
            <span dir="auto">{entry.canonicalName}</span>
            <Chevron size={15} className="card-chevron" aria-hidden="true" />
          </Link>
        </h2>
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#56606a]">
        <div>
          <dt className="inline font-bold">{strings.categoryLabel}</dt>
          <dd className="inline" dir="auto">
            {entry.categoryTags.length > 0 ? entry.categoryTags.join(delimiter) : strings.unspecifiedCategory}
          </dd>
        </div>
        <div>
          <dt className="inline font-bold">{strings.locationLabel}</dt>
          <dd className="inline" dir="auto">
            {entry.locationLabel}
          </dd>
        </div>
      </dl>

      {entry.locationCount > 1 ? (
        <p className="text-xs text-[#56606a]">
          {strings.multipleRecordedLocations.replace('{count}', String(entry.locationCount))}
        </p>
      ) : null}

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#56606a]">
        <div>
          <dt className="inline font-bold">{strings.identityLabel}</dt>
          <dd className="inline font-medium text-[#2a3441]">{identityLevelLabel(entry.identityLevel, locale)}</dd>
        </div>
        <div>
          <dt className="inline font-bold">{strings.evidenceCoverageLabel}</dt>
          <dd className="inline font-medium text-[#2a3441]">{coverageLevelLabel(entry.coverageLevel, locale)}</dd>
        </div>
      </dl>

      <p className="text-xs text-[#56606a]">
        {strings.evidenceSummaryTally
          .replace('{total}', String(evidence.total))
          .replace('{nonDuplicate}', String(evidence.nonDuplicate))
          .replace('{distinctSources}', String(evidence.distinctSources))}
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
        <span className="stance supporting inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="stance-dot shrink-0" aria-hidden="true" />
          <span>{sentimentLabel('positive', locale)}: <span dir="ltr" className="font-semibold">{evidence.positive}</span></span>
        </span>
        <span className="stance mixed inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="stance-dot shrink-0" aria-hidden="true" />
          <span>{sentimentLabel('neutral', locale)}: <span dir="ltr" className="font-semibold">{evidence.neutral}</span></span>
        </span>
        <span className="stance negative inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="stance-dot shrink-0" aria-hidden="true" />
          <span>{sentimentLabel('negative', locale)}: <span dir="ltr" className="font-semibold">{evidence.negative}</span></span>
        </span>
        <span className="text-xs text-[#56606a]">{strings.fromNonDuplicateEvidence}</span>
      </div>

      <p className="text-xs text-[#56606a] pt-1 border-t border-[#f0eee9] flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          {strings.latestPublished}
          {evidence.latestPublishedAt !== null ? (
            <time dateTime={evidence.latestPublishedAt.slice(0, 10)} dir="ltr">
              {formatDate(evidence.latestPublishedAt, locale)}
            </time>
          ) : (
            strings.undated
          )}
        </span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span aria-hidden="true">·</span>
          <span>
            {strings.latestCapture}
            {evidence.lastCapturedAt !== null ? (
              <time dateTime={evidence.lastCapturedAt.slice(0, 10)} dir="ltr">
                {formatDate(evidence.lastCapturedAt, locale)}
              </time>
            ) : (
              strings.unknownDate
            )}
          </span>
        </span>
      </p>
      {children}
    </article>
  );
}
