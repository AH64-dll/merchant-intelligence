import type { JSX } from 'react';
import { ChevronDown, ExternalLink, FileText, MessageCircle, Scale, ShieldAlert } from 'lucide-react';

import type { EvidenceItem } from '@/lib/types';
import {
  authorTypeLabel,
  sentimentLabel,
  sourceTypeLabel,
} from '@/lib/labels';
import { t, type Locale } from '@/lib/i18n';
import {
  displaySummary,
  formatDate,
  safeHttpUrl,
  sourceCategoryLabel,
  STALE_PUBLISHED_DAYS,
} from './display';
import { SourceCitations } from './SourceCitations';

function CategoryIcon({ sourceCategory }: { sourceCategory: string }) {
  switch (sourceCategory) {
    case 'social':
      return <MessageCircle size={21} />;
    case 'official_registry':
    case 'regulatory':
      return <ShieldAlert size={21} />;
    case 'customer_report':
      return <FileText size={21} />;
    default:
      return <Scale size={21} />;
  }
}
function isStale(publishedAt: string): boolean {
  return Date.now() - new Date(publishedAt).getTime() > STALE_PUBLISHED_DAYS * 24 * 60 * 60 * 1000;
}

function PublishedDate({
  publishedAt,
  locale = 'ar',
}: {
  publishedAt: string | null;
  locale?: Locale;
}) {
  const strings = t(locale);
  if (publishedAt === null) {
    return <span>{strings.undated}</span>;
  }
  return (
    <span>
      <time dateTime={publishedAt.slice(0, 10)} dir="ltr">
        {formatDate(publishedAt, locale)}
      </time>
      {isStale(publishedAt) ? (
        <span className="font-bold">{strings.oldEvidenceWarning}</span>
      ) : null}
    </span>
  );
}

export function EvidenceCard({
  evidence,
  locale = 'ar',
}: {
  evidence: EvidenceItem;
  locale?: Locale;
}): JSX.Element {
  const strings = t(locale);
  const isDuplicate = evidence.duplicateOf !== null;
  const crossMerchant = evidence.duplicateRootMerchantId !== null;
  const safeUrl = safeHttpUrl(evidence.url);
  const stanceClass =
    evidence.sentiment === 'positive'
      ? 'supporting'
      : evidence.sentiment === 'negative'
        ? 'negative'
        : 'mixed';

  return (
    <article
      id={`evidence-${evidence.id}`}
      className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 sm:p-5 space-y-3.5 transition-colors"
    >
      <div className="flex items-start gap-3.5">
        <div className="method-icon flex-shrink-0" aria-hidden="true">
          <CategoryIcon sourceCategory={evidence.sourceCategory} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-2 text-xs">
            <span className={`stance ${stanceClass} inline-flex items-center gap-1.5 whitespace-nowrap`}>
              <span className="stance-dot shrink-0" aria-hidden="true" />
              <span>
                {strings.evidenceDirection}
                {sentimentLabel(evidence.sentiment, locale)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[#56606a]">
              <span className="text-[#7a8085]" aria-hidden="true">·</span>
              <span>
                {strings.sourceCategoryLabelPrefix}
                <strong className="font-medium text-[#2a3441]">{sourceCategoryLabel(evidence.sourceCategory, locale)}</strong>
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[#56606a]" dir="auto">
              <span className="text-[#7a8085]" aria-hidden="true">·</span>
              <span>
                {strings.platformLabel}<bdi className="font-medium">{evidence.platform}</bdi>
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[#56606a]">
              <span className="text-[#7a8085]" aria-hidden="true">·</span>
              <span>
                {strings.evidenceAuthor}{authorTypeLabel(evidence.authorType, locale)}
              </span>
            </span>
          </div>
          <p dir="auto" className="text-sm font-medium text-[#2a3441] leading-relaxed">
            {displaySummary(evidence.summary, locale)}
          </p>
        </div>
      </div>

      {evidence.quotedExcerpt.trim().length > 0 ? (
        <blockquote className="border-s-2 border-[#4a7c7e] ps-3.5 py-1 text-sm text-[#3d4a5c] italic bg-[#fafaf6] rounded-e">
          <span dir="auto">«{evidence.quotedExcerpt}»</span>
        </blockquote>
      ) : null}

      <p className="text-xs text-[#7a8085] flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{strings.publishedDatePrefix}<PublishedDate publishedAt={evidence.publishedAt} locale={locale} /></span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true">·</span>
          <span>
            {strings.capturedDatePrefix}
            <time dateTime={evidence.capturedAt.slice(0, 10)} dir="ltr">
              {formatDate(evidence.capturedAt, locale)}
            </time>
          </span>
        </span>
      </p>

      {evidence.citations && evidence.citations.length > 0 ? (
        <SourceCitations citations={evidence.citations} locale={locale} />
      ) : (
        <p className="text-xs">
          {safeUrl !== null ? (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link"
            >
              <span>{strings.openOriginalSource}</span>
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <span className="text-[#7a8085]">
              {strings.sourceTextOnly}<span className="ltr-isolate wrap-anywhere">{evidence.url}</span>
            </span>
          )}
        </p>
      )}

      <details className="text-xs text-[#7a8085] border-t border-[#e4e3de] pt-2 group">
        <summary className="min-h-[44px] inline-flex items-center gap-1.5 cursor-pointer font-medium hover:text-[#2a3441]">
          <ChevronDown size={14} className="transition-transform group-open:rotate-180 text-[#7a8085] shrink-0" aria-hidden="true" />
          <span>{strings.sourceDetailsSummary}</span>
        </summary>
        <ul className="mt-2 space-y-1 text-xs list-none p-0 text-[#56606a]">
          <li>
            {strings.rawSourceType}<span dir="auto">{sourceTypeLabel(evidence.sourceType, locale)}</span>
            {evidence.sourceType ? (
              <span className="text-[11px] text-[#7a8085]"> ({evidence.sourceType})</span>
            ) : null}
          </li>
          <li>
            {evidence.verified ? strings.includedInVerification : strings.notIncludedInVerification}
          </li>
          <li>
            {isDuplicate
              ? strings.duplicateRootNotice.replace('{root}', evidence.duplicateOf ?? strings.unknownDate)
              : strings.notDuplicateNotice}
          </li>
          {crossMerchant ? (
            <li>
              {strings.crossMerchantDuplicateNotice}
            </li>
          ) : null}
          <li>
            {strings.technicalDatesPublished}
            <span dir="ltr" className="ltr-isolate">{evidence.publishedAt ?? strings.unknownDate}</span>
            {strings.technicalDatesCaptured}
            <span dir="ltr" className="ltr-isolate">{evidence.capturedAt}</span>
          </li>
        </ul>
      </details>
    </article>
  );
}
