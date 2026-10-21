import type { JSX } from 'react';
import { Database, FileText, Scale } from 'lucide-react';

import {
  assessEvidenceCoverage,
  assessReputation,
  type ReputationAssessment,
} from '@/lib/assessment';
import {
  coverageLevelLabel,
  sentimentLabel,
} from '@/lib/labels';
import type {
  EvidenceItem,
  Identifier,
  MerchantState,
  Sentiment,
  SentimentCounts,
} from '@/lib/types';
import type { SourceCategory } from '@/lib/taxonomy';
import { t, type Locale } from '@/lib/i18n';
import { displaySummary, formatDate, sourceCategoryLabel } from './display';

export interface MerchantEvidenceOverviewProps {
  state: MerchantState;
  identifiers: Identifier[];
  evidence: EvidenceItem[];
  sentiment: SentimentCounts;
  snapshotGeneratedAt: string;
  locale?: Locale;
}

const MAX_HIGHLIGHTS = 3;

function evidenceTime(item: EvidenceItem): number {
  const parsed = Date.parse(item.publishedAt ?? item.capturedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function newestFirst(a: EvidenceItem, b: EvidenceItem): number {
  return evidenceTime(b) - evidenceTime(a) || a.id.localeCompare(b.id);
}

function addEvidence(
  selected: EvidenceItem[],
  selectedIds: Set<string>,
  item: EvidenceItem,
): void {
  if (selected.length >= MAX_HIGHLIGHTS || selectedIds.has(item.id)) return;
  selected.push(item);
  selectedIds.add(item.id);
}

/**
 * Selects a small, decision-oriented sample without treating positive rows as
 * the default. Assessment-backed warnings and risks take precedence. For a
 * mixed assessment, one row per available direction is preferred before a
 * second row of the same direction; remaining slots use the newest independent
 * evidence with the same diversity rule.
 */
export function selectDecisionEvidence(
  evidence: EvidenceItem[],
  reputation: ReputationAssessment,
): EvidenceItem[] {
  const byId = new Map<string, EvidenceItem>();
  for (const item of evidence) byId.set(item.id, item);
  const priority = reputation.evidenceIds
    .map((id) => byId.get(id))
    .filter((item): item is EvidenceItem => item !== undefined && item.duplicateOf === null);
  const fallback = evidence
    .filter((item) => item.independent && item.duplicateOf === null)
    .sort(newestFirst);

  const selected: EvidenceItem[] = [];
  const selectedIds = new Set<string>();

  if (reputation.kind === 'OFFICIAL_WARNING' || reputation.kind === 'HIGH_RISK_SIGNALS') {
    for (const item of priority) {
      addEvidence(selected, selectedIds, item);
      if (selected.length === MAX_HIGHLIGHTS) break;
    }
  } else {
    const directions = new Set<Sentiment>();
    for (const item of priority) {
      if (directions.has(item.sentiment)) continue;
      addEvidence(selected, selectedIds, item);
      directions.add(item.sentiment);
    }

    // Before repeating a direction from the assessment sample, show a newer
    // independent row of another direction when one is available.
    for (const item of fallback) {
      if (directions.has(item.sentiment)) continue;
      addEvidence(selected, selectedIds, item);
      directions.add(item.sentiment);
    }

    for (const item of priority) {
      addEvidence(selected, selectedIds, item);
      if (selected.length === MAX_HIGHLIGHTS) break;
    }
  }

  for (const item of fallback) {
    addEvidence(selected, selectedIds, item);
    if (selected.length === MAX_HIGHLIGHTS) break;
  }
  return selected;
}

function DateValue({
  value,
  empty,
  locale = 'ar',
}: {
  value: string | null;
  empty: string;
  locale?: Locale;
}): JSX.Element {
  if (value === null) return <>{empty}</>;
  return (
    <time dateTime={value.slice(0, 10)} dir="ltr">
      {formatDate(value, locale)}
    </time>
  );
}

function locationRecordText(identifiers: Identifier[], locale: Locale = 'ar'): JSX.Element {
  const addressRecords = new Set(
    identifiers
      .filter((identifier) => identifier.displayable && identifier.kind === 'address')
      .map((identifier) => identifier.normalizedValue.trim() || identifier.value.trim())
      .filter(Boolean),
  );

  if (addressRecords.size === 0) {
    return locale === 'en' ? (
      <>No displayable address records in this snapshot.</>
    ) : (
      <>لا توجد سجلات عناوين قابلة للعرض ضمن هذه اللقطة.</>
    );
  }
  if (addressRecords.size === 1) {
    return locale === 'en' ? (
      <>Single location record in this snapshot.</>
    ) : (
      <>يوجد سجل موقع واحد ضمن هذه اللقطة.</>
    );
  }
  return locale === 'en' ? (
    <>
      Multiple recorded locations: <span dir="ltr">{addressRecords.size}</span> distinct address records in the snapshot. Some records may represent variant spellings of the same location.
    </>
  ) : (
    <>
      توجد عدة مواقع مسجلة: <span dir="ltr">{addressRecords.size}</span> سجلات عناوين مختلفة في
      اللقطة. قد تمثل بعض السجلات صيغًا مختلفة للموقع نفسه.
    </>
  );
}

export function MerchantEvidenceOverview({
  state,
  identifiers,
  evidence,
  sentiment,
  snapshotGeneratedAt,
  locale = 'ar',
}: MerchantEvidenceOverviewProps): JSX.Element {
  const strings = t(locale);
  const coverage = assessEvidenceCoverage(evidence);
  const reputation = assessReputation(state, evidence, locale);
  const highlights = selectDecisionEvidence(evidence, reputation);
  const sourceCounts = new Map<SourceCategory, number>();
  for (const item of evidence) {
    if (item.duplicateOf !== null) continue;
    sourceCounts.set(item.sourceCategory, (sourceCounts.get(item.sourceCategory) ?? 0) + 1);
  }
  const sourceBreakdown = [...sourceCounts.entries()].sort(
    ([categoryA, countA], [categoryB, countB]) =>
      countB - countA || sourceCategoryLabel(categoryA, locale).localeCompare(sourceCategoryLabel(categoryB, locale), locale),
  );

  return (
    <section aria-labelledby="evidence-overview-heading" className="space-y-6">
      <div className="border-b border-[#e4e3de] pb-4">
        <h2 id="evidence-overview-heading" className="text-lg font-semibold text-[#2a3441] flex items-center gap-2">
          <Scale size={20} className="text-[#4a7c7e]" aria-hidden="true" />
          <span>{locale === 'en' ? 'Vendor Evidence Overview' : 'نظرة عامة على أدلة البائع'}</span>
        </h2>
        <p className="text-xs text-[#7a8085] mt-1">{locationRecordText(identifiers, locale)}</p>
      </div>

      <div className="stance-guide">
        <h3 className="font-semibold text-base text-[#2a3441] flex items-center gap-2">
          <Database size={18} className="text-[#4a7c7e]" aria-hidden="true" />
          <span>{coverageLevelLabel(coverage.level, locale)}</span>
        </h3>
        <dl className="stance-grid">
          <div className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-3">
            <dt className="font-bold">{strings.totalEvidence}</dt>
            <dd dir="ltr">{coverage.total}</dd>
          </div>
          <div className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-3">
            <dt className="font-bold">{strings.nonDuplicateEvidence}</dt>
            <dd dir="ltr">{coverage.nonDuplicate}</dd>
          </div>
          <div className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-3">
            <dt className="font-bold">{strings.distinctNonDuplicateSources}</dt>
            <dd dir="ltr">{coverage.distinctSources}</dd>
          </div>
        </dl>
        <p className="text-xs text-[#7a8085] mt-3">
          {locale === 'en' ? (
            <>
              Duplicate evidence was excluded from direction and source counts
              {coverage.duplicateCount > 0 ? (
                <>
                  {' '}— totaling <span dir="ltr">{coverage.duplicateCount}</span>
                </>
              ) : (
                ' — with no duplicate evidence excluded'
              )}
              .
            </>
          ) : (
            <>
              استُبعدت الأدلة المكررة من أعداد الاتجاهات والمصادر
              {coverage.duplicateCount > 0 ? (
                <>
                  {' '}— وعددها <span dir="ltr">{coverage.duplicateCount}</span>
                </>
              ) : (
                ' — ولا توجد أدلة مكررة مستثناة'
              )}
              .
            </>
          )}
        </p>
      </div>

      <div className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 space-y-3">
        <h3 className="font-semibold text-sm text-[#2a3441]">
          {locale === 'en' ? 'Direction of non-duplicate evidence' : 'اتجاه الأدلة غير المكررة'}
        </h3>
        <dl className="flex flex-wrap gap-3">
          <div className="stance supporting inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="stance-dot shrink-0" aria-hidden="true" />
            <dt className="inline font-bold">{sentimentLabel('positive', locale)}: </dt>
            <dd className="inline" dir="ltr">{sentiment.positive}</dd>
          </div>
          <div className="stance negative inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="stance-dot shrink-0" aria-hidden="true" />
            <dt className="inline font-bold">{sentimentLabel('negative', locale)}: </dt>
            <dd className="inline" dir="ltr">{sentiment.negative}</dd>
          </div>
          <div className="stance mixed inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="stance-dot shrink-0" aria-hidden="true" />
            <dt className="inline font-bold">{sentimentLabel('neutral', locale)}: </dt>
            <dd className="inline" dir="ltr">{sentiment.neutral}</dd>
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 space-y-2">
          <h3 className="font-semibold text-sm text-[#2a3441]">
            {locale === 'en' ? 'Evidence and snapshot freshness' : 'حداثة الأدلة واللقطة'}
          </h3>
          <dl className="space-y-1.5 text-xs text-[#56606a]">
            <div>
              <dt className="inline font-bold">{strings.latestKnownPublication}: </dt>
              <dd className="inline">
                <DateValue value={coverage.latestPublishedAt} empty={strings.unknownDate} locale={locale} />
              </dd>
            </div>
            <div>
              <dt className="inline font-bold">{strings.latestCaptureLabel}: </dt>
              <dd className="inline">
                <DateValue value={coverage.lastCapturedAt} empty={strings.unknownDate} locale={locale} />
              </dd>
            </div>
            <div>
              <dt className="inline font-bold">{strings.snapshotGeneratedDateLabel}: </dt>
              <dd className="inline">
                <DateValue value={snapshotGeneratedAt} empty={strings.unknownDate} locale={locale} />
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-[#fdfcf9] border border-[#e4e3de] rounded p-4 space-y-2">
          <h3 className="font-semibold text-sm text-[#2a3441]">
            {locale === 'en' ? 'Source categories of non-duplicate evidence' : 'فئات مصادر الأدلة غير المكررة'}
          </h3>
          {sourceBreakdown.length > 0 ? (
            <ul className="flex flex-wrap gap-2 text-xs list-none p-0 m-0">
              {sourceBreakdown.map(([category, count]) => (
                <li key={category} className="bg-white border border-[#e4e3de] px-2.5 py-1 rounded text-[#2a3441]">
                  {sourceCategoryLabel(category, locale)}: <span dir="ltr">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[#7a8085]">{locale === 'en' ? 'No non-duplicate sources to display.' : 'لا توجد مصادر غير مكررة لعرضها.'}</p>
          )}
        </div>
      </div>

      <div aria-labelledby="reputation-heading" className="bg-[#fafaf6] border border-[#e4e3de] rounded p-4 space-y-2">
        <h3 id="reputation-heading" className="font-semibold text-sm text-[#2a3441]">{reputation.headline}</h3>
        <p dir="auto" className="text-sm text-[#56606a] leading-relaxed">{reputation.explanation}</p>
        {reputation.caveat !== null ? (
          <p dir="auto" className="text-xs text-[#a65d57] font-medium">{locale === 'en' ? 'Notice: ' : 'تنبيه: '}{reputation.caveat}</p>
        ) : null}
      </div>

      {highlights.length > 0 ? (
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-base text-[#2a3441]">
              {locale === 'en' ? 'Key evidence highlights for review before decision' : 'أدلة بارزة للمراجعة قبل القرار'}
            </h3>
            <p className="text-xs text-[#7a8085] mt-0.5">
              {locale === 'en'
                ? 'A concise selection that does not replace the full evidence list below.'
                : 'اختيار مختصر لا يستبدل قائمة الأدلة الكاملة أدناه.'}
            </p>
          </div>
          <div className="method-list">
            {highlights.map((item, index) => {
              const stanceClass =
                item.sentiment === 'positive'
                  ? 'supporting'
                  : item.sentiment === 'negative'
                    ? 'negative'
                    : 'mixed';
              return (
                <div key={item.id} className="method-item">
                  <span className="method-number">{String(index + 1).padStart(2, '0')}</span>
                  <div className="method-icon" aria-hidden="true">
                    <FileText size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                      <span className={`stance ${stanceClass} inline-flex items-center gap-1.5 whitespace-nowrap`}>
                        <span className="stance-dot shrink-0" aria-hidden="true" />
                        <span>{sentimentLabel(item.sentiment, locale)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-[#56606a]">
                        <span className="text-[#7a8085]" aria-hidden="true">·</span>
                        <span>{sourceCategoryLabel(item.sourceCategory, locale)}</span>
                      </span>
                    </div>
                    <a
                      href={`#evidence-${item.id}`}
                      className="inline-flex min-h-[44px] items-center text-sm font-medium text-[#2a3441] hover:text-[#4a7c7e] underline underline-offset-2"
                      dir="auto"
                    >
                      {displaySummary(item.summary, locale)}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
