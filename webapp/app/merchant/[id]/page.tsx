import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnalysisSection } from '@/components/AnalysisSection';
import { EvidenceCard } from '@/components/EvidenceCard';
import { ClaimsTable } from '@/components/ClaimsTable';
import { IdentifierList } from '@/components/IdentifierList';
import { RelatedMerchants } from '@/components/RelatedMerchants';
import { SentimentBar } from '@/components/SentimentBar';
import { StateBadge } from '@/components/StateBadge';
import { VerdictCard } from '@/components/VerdictCard';
import { getDb } from '@/lib/singletons';
import { deriveVerdict } from '@/lib/verdict';

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

  const verdict = deriveVerdict(detail.merchant, detail.sentiment, detail.analysis);

  return (
    <article>
      <h1 dir="auto">{detail.merchant.canonicalName}</h1>

      <p>
        <span dir="auto">{detail.merchant.category}</span>
        {' · '}
        <span dir="auto">{detail.merchant.city}</span>
        {' · '}
        <span dir="auto">{detail.merchant.governorate}</span>
        {' · '}
        نسبة الثقة في الهوية: {Math.round(detail.merchant.identityConfidence * 100)}%
      </p>

      <p dir="auto">
        <StateBadge state={detail.merchant.state} />
      </p>

      <VerdictCard verdict={verdict} />

      <SentimentBar sentiment={detail.sentiment} />

      <AnalysisSection analysis={detail.analysis} />

      {detail.aliases.length > 0 ? (
        <>
          <h2>أسماء بديلة</h2>
          <p dir="auto">{detail.aliases.join('، ')}</p>
        </>
      ) : null}

      {detail.evidence.length > 0 ? (
        <>
          <h2>الأدلة</h2>
          <ul className="flex flex-col gap-4 p-0 list-none">
            {detail.evidence.map((evidence) => (
              <li key={evidence.id}>
                <EvidenceCard evidence={evidence} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {detail.claims.length > 0 ? (
        <>
          <h2>الادعاءات</h2>
          <ClaimsTable claims={detail.claims} />
        </>
      ) : null}

      {detail.identifiers.length > 0 ? (
        <>
          <h2>المعرفات</h2>
          <IdentifierList identifiers={detail.identifiers} />
        </>
      ) : null}

      {detail.related.length > 0 ? (
        <>
          <h2>تجار مرتبطون</h2>
          <RelatedMerchants related={detail.related} />
        </>
      ) : null}
    </article>
  );
}
