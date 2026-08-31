import type { JSX } from 'react';

import {
  assessEvidenceCoverage,
  assessReputation,
  type ReputationAssessment,
} from '@/lib/assessment';
import { COVERAGE_LEVEL_LABELS, SENTIMENT_LABELS } from '@/lib/labels';
import type {
  EvidenceItem,
  Identifier,
  MerchantState,
  Sentiment,
  SentimentCounts,
} from '@/lib/types';
import type { SourceCategory } from '@/lib/taxonomy';
import { formatDateAr, sourceCategoryLabel } from './display';

interface MerchantEvidenceOverviewProps {
  state: MerchantState;
  identifiers: Identifier[];
  evidence: EvidenceItem[];
  sentiment: SentimentCounts;
  snapshotGeneratedAt: string;
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

function DateValue({ value, empty }: { value: string | null; empty: string }): JSX.Element {
  if (value === null) return <>{empty}</>;
  return (
    <time dateTime={value.slice(0, 10)} dir="ltr">
      {formatDateAr(value)}
    </time>
  );
}

function locationRecordText(identifiers: Identifier[]): JSX.Element {
  const addressRecords = new Set(
    identifiers
      .filter((identifier) => identifier.displayable && identifier.kind === 'address')
      .map((identifier) => identifier.normalizedValue.trim() || identifier.value.trim())
      .filter(Boolean),
  );

  if (addressRecords.size === 0) {
    return <>لا توجد سجلات عناوين قابلة للعرض ضمن هذه اللقطة.</>;
  }
  if (addressRecords.size === 1) {
    return <>يوجد سجل موقع واحد ضمن هذه اللقطة.</>;
  }
  return (
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
}: MerchantEvidenceOverviewProps): JSX.Element {
  const coverage = assessEvidenceCoverage(evidence);
  const reputation = assessReputation(state, evidence);
  const highlights = selectDecisionEvidence(evidence, reputation);
  const sourceCounts = new Map<SourceCategory, number>();
  for (const item of evidence) {
    if (item.duplicateOf !== null) continue;
    sourceCounts.set(item.sourceCategory, (sourceCounts.get(item.sourceCategory) ?? 0) + 1);
  }
  const sourceBreakdown = [...sourceCounts.entries()].sort(
    ([categoryA, countA], [categoryB, countB]) =>
      countB - countA || sourceCategoryLabel(categoryA).localeCompare(sourceCategoryLabel(categoryB), 'ar'),
  );

  return (
    <section aria-labelledby="evidence-overview-heading" className="border border-black p-4 space-y-5">
      <div>
        <h2 id="evidence-overview-heading">نظرة عامة على أدلة البائع</h2>
        <p>{locationRecordText(identifiers)}</p>
      </div>

      <div>
        <h3 className="font-bold">{COVERAGE_LEVEL_LABELS[coverage.level]}</h3>
        <dl className="grid gap-2 sm:grid-cols-3">
          <div>
            <dt className="font-bold">إجمالي الأدلة</dt>
            <dd dir="ltr">{coverage.total}</dd>
          </div>
          <div>
            <dt className="font-bold">أدلة غير مكررة</dt>
            <dd dir="ltr">{coverage.nonDuplicate}</dd>
          </div>
          <div>
            <dt className="font-bold">مصادر مختلفة غير مكررة</dt>
            <dd dir="ltr">{coverage.distinctSources}</dd>
          </div>
        </dl>
        <p className="text-sm">
          استُبعدت الأدلة المكررة من أعداد الاتجاهات والمصادر
          {coverage.duplicateCount > 0 ? (
            <>
              {' '}— وعددها <span dir="ltr">{coverage.duplicateCount}</span>
            </>
          ) : (
            ' — ولا توجد أدلة مكررة مستثناة'
          )}
          .
        </p>
      </div>

      <div>
        <h3 className="font-bold">اتجاه الأدلة غير المكررة</h3>
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <div>
            <dt className="inline font-bold">{SENTIMENT_LABELS.positive}: </dt>
            <dd className="inline" dir="ltr">{sentiment.positive}</dd>
          </div>
          <div>
            <dt className="inline font-bold">{SENTIMENT_LABELS.negative}: </dt>
            <dd className="inline" dir="ltr">{sentiment.negative}</dd>
          </div>
          <div>
            <dt className="inline font-bold">{SENTIMENT_LABELS.neutral}: </dt>
            <dd className="inline" dir="ltr">{sentiment.neutral}</dd>
          </div>
        </dl>
      </div>

      <div>
        <h3 className="font-bold">حداثة الأدلة واللقطة</h3>
        <dl className="space-y-1">
          <div>
            <dt className="inline font-bold">أحدث نشر معروف: </dt>
            <dd className="inline">
              <DateValue value={coverage.latestPublishedAt} empty="غير معروف" />
            </dd>
          </div>
          <div>
            <dt className="inline font-bold">آخر التقاط: </dt>
            <dd className="inline">
              <DateValue value={coverage.lastCapturedAt} empty="غير معروف" />
            </dd>
          </div>
          <div>
            <dt className="inline font-bold">تاريخ توليد اللقطة: </dt>
            <dd className="inline">
              <DateValue value={snapshotGeneratedAt} empty="غير معروف" />
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <h3 className="font-bold">فئات مصادر الأدلة غير المكررة</h3>
        {sourceBreakdown.length > 0 ? (
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {sourceBreakdown.map(([category, count]) => (
              <li key={category}>
                {sourceCategoryLabel(category)}: <span dir="ltr">{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>لا توجد مصادر غير مكررة لعرضها.</p>
        )}
      </div>

      <div aria-labelledby="reputation-heading">
        <h3 id="reputation-heading" className="font-bold">{reputation.headline}</h3>
        <p dir="auto">{reputation.explanation}</p>
        {reputation.caveat !== null ? <p dir="auto">تنبيه: {reputation.caveat}</p> : null}
      </div>

      {highlights.length > 0 ? (
        <div>
          <h3 className="font-bold">أدلة بارزة للمراجعة قبل القرار</h3>
          <p className="text-sm">اختيار مختصر لا يستبدل قائمة الأدلة الكاملة أدناه.</p>
          <ul className="mt-2 space-y-2">
            {highlights.map((item) => (
              <li key={item.id}>
                <a
                  href={`#evidence-${item.id}`}
                  className="inline-flex min-h-[44px] items-center underline"
                  dir="auto"
                >
                  {item.summary}
                </a>
                <span className="text-sm">
                  {' '}— {SENTIMENT_LABELS[item.sentiment]} · {sourceCategoryLabel(item.sourceCategory)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
