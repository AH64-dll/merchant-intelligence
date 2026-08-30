import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnalysisSection } from '@/components/AnalysisSection';
import { EvidenceCard } from '@/components/EvidenceCard';
import { ClaimCards } from '@/components/ClaimCards';
import { IdentifierList } from '@/components/IdentifierList';
import { RelatedMerchants } from '@/components/RelatedMerchants';
import { SentimentBar } from '@/components/SentimentBar';
import { COVERAGE_LEVEL_LABELS, IDENTITY_LEVEL_LABELS } from '@/lib/labels';
import { assessEvidenceCoverage, assessIdentity, assessReputation } from '@/lib/assessment';
import { categoryTags, CATEGORY_TAG_LABELS, normalizeGovernorate, GOVERNORATE_LABELS, splitCityDisplay } from '@/lib/taxonomy';
import { getDb } from '@/lib/singletons';

interface MerchantPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: MerchantPageProps): Promise<Metadata> {
  const { id } = await params;
  const detail = getDb().getMerchantDetail(id);
  if (!detail) return { title: 'تاجر غير موجود' };
  return { title: detail.merchant.canonicalName };
}

export default async function MerchantPage({ params }: MerchantPageProps) {
  const { id } = await params;
  const detail = getDb().getMerchantDetail(id);
  if (!detail) notFound();

  const { merchant, snapshot } = detail;
  const identity = assessIdentity(merchant.state, detail.identifiers, detail.related.map((r) => r.relation));
  const coverage = assessEvidenceCoverage(detail.evidence);
  const reputation = assessReputation(merchant.state, detail.evidence);
  const tags = categoryTags(merchant.category);
  const governorateKey = normalizeGovernorate(merchant.governorate);
  const { districtHints } = splitCityDisplay(merchant.city);

  return (
    <article>
      <h1 dir="auto">{merchant.canonicalName}</h1>

      {/* 1 — Identity */}
      <p>
        <span dir="auto">{merchant.category}</span>
        {' · '}
        <span dir="auto">{merchant.city}</span>
        {' · '}
        <span dir="auto">
          {governorateKey !== null ? GOVERNORATE_LABELS[governorateKey].ar : merchant.governorate}
        </span>
      </p>
      {districtHints.length > 0 ? (
        <p>
          أحياء محتملة: {districtHints.map((hint) => <span key={hint} dir="auto">{hint}</span>).reduce((acc, el, i) => (
            <>{acc}{i > 0 ? '، ' : ''}{el}</>
          ), <></>)}
        </p>
      ) : null}
      <p>تصنيفات: {tags.map((tag) => CATEGORY_TAG_LABELS[tag].ar).join('، ')}</p>

      {/* 2 — Identity certainty */}
      <section aria-labelledby="identity-heading">
        <h2 id="identity-heading">{IDENTITY_LEVEL_LABELS[identity.level]}</h2>
        <ul>
          {identity.reasons.map((reason, i) => (
            <li key={i} dir="auto">{reason}</li>
          ))}
        </ul>
      </section>

      {/* 3 — Evidence coverage / freshness */}
      <section aria-labelledby="coverage-heading">
        <h2 id="coverage-heading">{COVERAGE_LEVEL_LABELS[coverage.level]}</h2>
        <p>
          <span dir="ltr">{coverage.nonDuplicate}</span> دليل غير مكرر من أصل{' '}
          <span dir="ltr">{coverage.total}</span>
          {coverage.duplicateCount > 0 ? ` (منها ${coverage.duplicateCount} مكرر)` : ''} ·{' '}
          <span dir="ltr">{coverage.distinctSources}</span> مصدر غير مكرر
        </p>
        <p>
          أحدث نشر معروف:{' '}
          {coverage.latestPublishedAt !== null ? (
            <span dir="ltr">{coverage.latestPublishedAt.slice(0, 10)}</span>
          ) : (
            'غير معروف'
          )}{' '}
          · آخر التقاط: <span dir="ltr">{coverage.lastCapturedAt?.slice(0, 10) ?? '—'}</span>
          {coverage.undatedCount > 0 ? ` · ${coverage.undatedCount} دليل بلا تاريخ نشر` : ''}
        </p>
        <p>
          تاريخ توليد اللقطة: <span dir="ltr">{snapshot.generatedAt.slice(0, 10)}</span>
        </p>
      </section>

      {/* 4 — What the evidence indicates (sentiment direction) */}
      <SentimentBar sentiment={detail.sentiment} duplicateCount={detail.duplicateEvidenceCount} />

      <AnalysisSection analysis={detail.analysis} />

      {/* 5 — Notable signals, source-backed */}
      <section aria-labelledby="reputation-heading">
        <h2 id="reputation-heading">{reputation.headline}</h2>
        <p dir="auto">{reputation.explanation}</p>
        {reputation.caveat !== null ? <p dir="auto">تنبيه: {reputation.caveat}</p> : null}
        {reputation.evidenceIds.length > 0 ? (
          <p>
            الأدلة ذات الصلة:{' '}
            {reputation.evidenceIds.slice(0, 5).map((evidenceId, i) => (
              <span key={evidenceId}>
                {i > 0 ? ' · ' : ''}
                <a href={`#evidence-${evidenceId}`} className="underline" dir="ltr">
                  {evidenceId}
                </a>
              </span>
            ))}
          </p>
        ) : null}
      </section>

      {detail.aliases.length > 0 ? (
        <>
          <h2>أسماء بديلة</h2>
          <p dir="auto">{detail.aliases.join('، ')}</p>
        </>
      ) : null}

      {/* 6 — All evidence / provenance */}
      {detail.evidence.length > 0 ? (
        <>
          <h2>الأدلة والمصادر</h2>
          <ul className="flex flex-col gap-4 p-0 list-none">
            {detail.evidence.map((evidence) => (
              <li key={evidence.id}>
                <EvidenceCard evidence={evidence} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {/* 7 — Claims */}
      {detail.claims.length > 0 ? (
        <>
          <h2>الادعاءات</h2>
          <ClaimCards claims={detail.claims} />
        </>
      ) : null}

      {/* 8 — Identifiers */}
      {detail.identifiers.length > 0 ? (
        <>
          <h2>المعرفات</h2>
          <IdentifierList identifiers={detail.identifiers} />
        </>
      ) : null}

      {/* 9 — Possibly related profiles */}
      {detail.related.length > 0 ? (
        <>
          <h2>ملفات قد تكون مرتبطة</h2>
          <p>هذه العلاقات مشتقة من تطابقات آلية — قد يكون مرتبطًا، وليست إثباتًا لملكية مشتركة.</p>
          <RelatedMerchants related={detail.related} />
        </>
      ) : null}
    </article>
  );
}
