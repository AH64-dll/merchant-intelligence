import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnalysisSection } from '@/components/AnalysisSection';
import { EvidenceCard } from '@/components/EvidenceCard';
import { ClaimCards } from '@/components/ClaimCards';
import { IdentifierList } from '@/components/IdentifierList';
import { MerchantEvidenceOverview } from '@/components/MerchantEvidenceOverview';
import { RelatedMerchants } from '@/components/RelatedMerchants';
import { IDENTITY_LEVEL_LABELS } from '@/lib/labels';
import { assessIdentity } from '@/lib/assessment';
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

      {/* 3 — Seller-centric evidence overview */}
      <MerchantEvidenceOverview
        state={merchant.state}
        identifiers={detail.identifiers}
        evidence={detail.evidence}
        sentiment={detail.sentiment}
        snapshotGeneratedAt={snapshot.generatedAt}
      />

      <AnalysisSection analysis={detail.analysis} />

      {detail.aliases.length > 0 ? (
        <>
          <h2>أسماء بديلة</h2>
          <p dir="auto">{detail.aliases.join('، ')}</p>
        </>
      ) : null}

      {/* 4 — All evidence / provenance */}
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

      {/* 5 — Claims */}
      {detail.claims.length > 0 ? (
        <>
          <h2>الادعاءات</h2>
          <ClaimCards claims={detail.claims} />
        </>
      ) : null}

      {/* 6 — Identifiers */}
      {detail.identifiers.length > 0 ? (
        <>
          <h2>المعرفات</h2>
          <IdentifierList identifiers={detail.identifiers} />
        </>
      ) : null}

      {/* 7 — Possibly related profiles */}
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
