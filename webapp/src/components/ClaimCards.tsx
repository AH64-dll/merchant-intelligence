import type { JSX, ReactNode } from 'react';
import { MessageSquareQuote } from 'lucide-react';

import type { ClaimItem, EvidenceItem } from '@/lib/types';
import {
  claimTypeLabel,
  sentimentLabel,
} from '@/lib/labels';
import { t, type Locale } from '@/lib/i18n';
import { displaySummary, formatDate, sourceCategoryLabel } from './display';
import { SourceCitations } from './SourceCitations';
function EvidenceAnchors({
  evidenceIds,
  locale = 'ar',
}: {
  evidenceIds: string[];
  locale?: Locale;
}): ReactNode {
  if (evidenceIds.length === 0) return null;
  const strings = t(locale);
  return (
    <p className="text-xs text-[#7a8085] pt-1">
      {strings.linkedEvidence}
      {evidenceIds.slice(0, 5).map((evidenceId, index) => (
        <span key={`${evidenceId}:${index}`} className="inline-flex items-center gap-1 whitespace-nowrap">
          {index > 0 ? <span aria-hidden="true" className="text-[#7a8085]">·</span> : null}
          <a href={`#evidence-${evidenceId}`} className="text-[#4a7c7e] hover:underline">
            {strings.evidenceAnchor.replace('{n}', String(index + 1))}
          </a>
        </span>
      ))}
    </p>
  );
}

function ClaimCard({
  claim,
  evidence,
  locale = 'ar',
}: {
  claim: ClaimItem;
  evidence?: EvidenceItem[];
  locale?: Locale;
}): JSX.Element {
  const strings = t(locale);
  const linkedEvidence = evidence
    ? evidence.filter((e) => claim.evidenceIds.includes(e.id))
    : [];

  let latestDate: string | null = null;
  for (const item of linkedEvidence) {
    const d = item.publishedAt ?? item.capturedAt;
    if (latestDate === null || d > latestDate) {
      latestDate = d;
    }
  }

  const primaryCategory = linkedEvidence.length > 0 ? linkedEvidence[0].sourceCategory : null;
  const stanceClass =
    claim.sentiment === 'positive'
      ? 'supporting'
      : claim.sentiment === 'negative'
        ? 'negative'
        : 'mixed';

  return (
    <article className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 space-y-3 transition-colors">
      <div className="flex items-center justify-between gap-2 border-b border-[#e4e3de] pb-2">
        <span className="font-semibold text-sm text-[#2a3441] flex items-center gap-1.5" dir="auto">
          <MessageSquareQuote size={16} className="text-[#4a7c7e]" aria-hidden="true" />
          <span>{claimTypeLabel(claim.claimType, locale)}</span>
        </span>
        <span className={`stance ${stanceClass} inline-flex items-center gap-1.5 whitespace-nowrap`}>
          <span className="stance-dot shrink-0" aria-hidden="true" />
          <span>{sentimentLabel(claim.sentiment, locale)}</span>
        </span>
      </div>

      <dl className="space-y-1.5 text-xs text-[#56606a]">
        <div className="sr-only">
          <dt className="font-bold">{strings.claimKind}</dt>
          <dd dir="auto">{claimTypeLabel(claim.claimType, locale)}</dd>
        </div>
        <div className="sr-only">
          <dt className="font-bold">{strings.claimSentiment}</dt>
          <dd>{sentimentLabel(claim.sentiment, locale)}</dd>
        </div>
        {primaryCategory !== null ? (
          <div className="flex items-center justify-between gap-2">
            <dt className="font-medium text-[#7a8085]">{strings.claimSourceCategory}</dt>
            <dd dir="auto" className="font-medium text-[#2a3441]">{sourceCategoryLabel(primaryCategory, locale)}</dd>
          </div>
        ) : null}
        {latestDate !== null ? (
          <div className="flex items-center justify-between gap-2">
            <dt className="font-medium text-[#7a8085]">{strings.claimLatestDate}</dt>
            <dd dir="ltr" className="text-[#2a3441]">
              <time dateTime={latestDate.slice(0, 10)}>{formatDate(latestDate, locale)}</time>
            </dd>
          </div>
        ) : null}
        {claim.summary.trim().length > 0 ? (
          <div className="pt-1 border-t border-[#f0eee9]">
            <dt className="font-medium text-[#7a8085] mb-0.5">{strings.claimSummary}</dt>
            <dd dir="auto" className="text-sm font-medium text-[#2a3441] leading-relaxed">
              {displaySummary(claim.summary, locale)}
            </dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 pt-1">
          <dt className="font-medium text-[#7a8085]">{strings.nonDuplicateSources}</dt>
          <dd className="font-semibold text-[#2a3441]">
            <span dir="ltr">{claim.independentSourceCount}</span>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="font-medium text-[#7a8085]">{strings.totalObservations}</dt>
          <dd className="font-semibold text-[#2a3441]">
            <span dir="ltr">{claim.mentionCount}</span>
          </dd>
        </div>
      </dl>

      {/* ALL direct web citations without cap */}
      {linkedEvidence.length > 0 ? (
        <div className="pt-2 border-t border-[#e4e3de]">
          <SourceCitations evidence={linkedEvidence} locale={locale} />
        </div>
      ) : null}

      <EvidenceAnchors evidenceIds={claim.evidenceIds} locale={locale} />
    </article>
  );
}

/** Responsive semantic claim cards — never a wide table on mobile. */
export function ClaimCards({
  claims,
  evidence,
  locale = 'ar',
}: {
  claims: ClaimItem[];
  evidence?: EvidenceItem[];
  locale?: Locale;
}): JSX.Element | null {
  if (claims.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {claims.map((claim) => (
        <ClaimCard key={claim.id} claim={claim} evidence={evidence} locale={locale} />
      ))}
    </div>
  );
}
