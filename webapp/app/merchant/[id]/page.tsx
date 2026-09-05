import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CitedBrief } from '@/components/CitedBrief';
import { ClaimCards } from '@/components/ClaimCards';
import { EvidenceCard } from '@/components/EvidenceCard';
import { IdentifierList } from '@/components/IdentifierList';
import { RelatedMerchants } from '@/components/RelatedMerchants';
import {
  ageInDays,
  formatDateAr,
  safeHttpUrl,
  sourceCategoryLabel,
  STALE_PUBLISHED_DAYS,
} from '@/components/display';
import {
  assessEvidenceCoverage,
  assessIdentity,
  isRiskEvidence,
  isWarningEvidence,
} from '@/lib/assessment';
import { IDENTITY_LEVEL_LABELS } from '@/lib/labels';
import { getDb } from '@/lib/singletons';
import {
  categoryTags,
  CATEGORY_TAG_LABELS,
  GOVERNORATE_LABELS,
  normalizeGovernorate,
  splitCityDisplay,
  type SourceCategory,
} from '@/lib/taxonomy';
import type { ClaimItem, EvidenceItem } from '@/lib/types';

interface MerchantPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: MerchantPageProps): Promise<Metadata> {
  const { id } = await params;
  const detail = getDb().getMerchantDetail(id);
  if (!detail) return { title: 'تاجر غير موجود' };
  return { title: detail.merchant.canonicalName };
}

function evidenceTimestamp(item: EvidenceItem): number {
  const d = item.publishedAt ?? item.capturedAt;
  const parsed = Date.parse(d);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function selectImportantClaims(claims: ClaimItem[], evidence: EvidenceItem[]): ClaimItem[] {
  const evidenceMap = new Map<string, EvidenceItem>();
  for (const ev of evidence) {
    evidenceMap.set(ev.id, ev);
  }

  // Filter for meaningful claims: backed by at least one meaningful evidence item or non-empty summary
  const meaningful = claims.filter((claim) => {
    const linked = claim.evidenceIds
      .map((id) => evidenceMap.get(id))
      .filter((e): e is EvidenceItem => e !== undefined);
    if (linked.some((e) => e.isMeaningful)) return true;
    return claim.summary.trim().length > 0 && claim.independentSourceCount > 0;
  });

  function claimTier(claim: ClaimItem): number {
    const linked = claim.evidenceIds
      .map((id) => evidenceMap.get(id))
      .filter((e): e is EvidenceItem => e !== undefined);

    // Tier 1: Official warning / regulator / official notice
    if (
      claim.claimType === 'official_warning' ||
      linked.some((e) => isWarningEvidence(e) || e.authorType === 'regulator')
    ) {
      return 1;
    }

    // Tier 2: Customer complaints / negative / risk signals
    if (
      claim.sentiment === 'negative' ||
      linked.some((e) => isRiskEvidence(e) || e.authorType === 'customer')
    ) {
      return 2;
    }

    // Tier 3: Corroborated positive / neutral
    return 3;
  }

  function latestLinkedTime(claim: ClaimItem): number {
    const linked = claim.evidenceIds
      .map((id) => evidenceMap.get(id))
      .filter((e): e is EvidenceItem => e !== undefined);

    let maxTime = 0;
    for (const e of linked) {
      const t = evidenceTimestamp(e);
      if (t > maxTime) maxTime = t;
    }
    return maxTime;
  }

  const sorted = [...meaningful].sort((a, b) => {
    const tierA = claimTier(a);
    const tierB = claimTier(b);
    if (tierA !== tierB) return tierA - tierB;

    const timeA = latestLinkedTime(a);
    const timeB = latestLinkedTime(b);
    if (timeA !== timeB) return timeB - timeA;

    return b.independentSourceCount - a.independentSourceCount || a.id.localeCompare(b.id);
  });

  return sorted.slice(0, 6);
}

export default async function MerchantPage({ params }: MerchantPageProps) {
  const { id } = await params;
  const detail = getDb().getMerchantDetail(id);
  if (!detail) notFound();

  const { merchant, snapshot } = detail;
  const identity = assessIdentity(
    merchant.state,
    detail.identifiers,
    detail.related.map((r) => r.relation),
  );
  const coverage = assessEvidenceCoverage(detail.evidence);
  const tags = categoryTags(merchant.category);
  const governorateKey = normalizeGovernorate(merchant.governorate);
  const { districtHints } = splitCityDisplay(merchant.city);

  const importantClaims = selectImportantClaims(detail.claims, detail.evidence);

  // 4 — Unknowns / caveats computation
  const caveats: string[] = [];
  if (coverage.level === 'none' || coverage.level === 'limited') {
    caveats.push(
      'تغطية الأدلة محدودة: المعلومات المتوفرة تعتمد على عدد قليل من المصادر، ولا تكفي لتكوين صورة شاملة ومؤكدة عن المتجر.',
    );
  }
  if (
    coverage.latestPublishedAt !== null &&
    ageInDays(coverage.latestPublishedAt) !== null &&
    ageInDays(coverage.latestPublishedAt)! > STALE_PUBLISHED_DAYS
  ) {
    caveats.push(
      `حداثة البيانات: أحدث دليل منشور يعود إلى تاريخ ${formatDateAr(coverage.latestPublishedAt)} (أقدم من سنتين)، وقد لا يعكس الوضع الحالي للتعامل مع المتجر.`,
    );
  }
  if (detail.sourceOnlyCount > 0) {
    caveats.push(
      `مصادر محفوظة بلا سياق نصي: يتضمن السجل ${detail.sourceOnlyCount} مصدرًا محفوظًا دون ملخص أو نص مقتبس، وتُحفظ للتوثيق فقط دون احتسابها كحقائق مستقلة.`,
    );
  }

  // 5 — Evidence separation
  const rootEvidence = detail.evidence.filter((e) => e.duplicateOf === null);
  const duplicateChildren = detail.evidence.filter((e) => e.duplicateOf !== null);

  const categoryCounts = new Map<SourceCategory, number>();
  for (const item of rootEvidence) {
    categoryCounts.set(item.sourceCategory, (categoryCounts.get(item.sourceCategory) ?? 0) + 1);
  }
  const availableCategories = [...categoryCounts.entries()].sort(
    ([catA, countA], [catB, countB]) =>
      countB - countA || sourceCategoryLabel(catA).localeCompare(sourceCategoryLabel(catB), 'ar'),
  );

  // 8 — Link-check summary counts
  const checkCounts: Record<string, number> = {
    reachable: 0,
    redirected: 0,
    not_found: 0,
    access_limited: 0,
    server_error: 0,
    network_error: 0,
    not_checked: 0,
  };

  const seenSources = new Set<string>();
  for (const item of detail.evidence) {
    if (item.citations && item.citations.length > 0) {
      for (const citation of item.citations) {
        const key = citation.sourceId
          ? `id:${citation.sourceId}`
          : citation.webUrl
            ? `url:${citation.webUrl}`
            : `note:${citation.locatorNote}`;
        if (seenSources.has(key)) continue;
        seenSources.add(key);

        const status = citation.checkStatus;
        if (status && status in checkCounts) {
          checkCounts[status] += 1;
        } else {
          checkCounts.not_checked += 1;
        }
      }
    } else if (item.url) {
      if (!seenSources.has(item.url)) {
        seenSources.add(item.url);
        checkCounts.not_checked += 1;
      }
    }
  }

  // Official links from displayable identifiers
  const officialWebsites = detail.identifiers.filter(
    (i) => i.displayable && (i.kind === 'website' || i.role === 'owned_site'),
  );

  const addressIdentifiers = detail.identifiers.filter(
    (i) => i.displayable && i.kind === 'address',
  );

  return (
    <article className="space-y-8 max-w-4xl mx-auto px-4 py-6" dir="rtl">
      {/* 1 — Identity header */}
      <header className="space-y-3 border-b border-black pb-4">
        <h1 dir="auto" className="text-2xl font-bold">
          {merchant.canonicalName}
        </h1>

        <p className="text-sm text-neutral-800">
          <span dir="auto">{merchant.category}</span>
          {' · '}
          <span dir="auto">{merchant.city}</span>
          {' · '}
          <span dir="auto">
            {governorateKey !== null ? GOVERNORATE_LABELS[governorateKey].ar : merchant.governorate}
          </span>
        </p>

        {districtHints.length > 0 ? (
          <p className="text-xs text-neutral-600">
            أحياء محتملة:{' '}
            {districtHints
              .map((hint) => (
                <span key={hint} dir="auto">
                  {hint}
                </span>
              ))
              .reduce((acc, el, i) => (
                <>
                  {acc}
                  {i > 0 ? '، ' : ''}
                  {el}
                </>
              ), <></>)}
          </p>
        ) : null}

        <p className="text-xs text-neutral-600">
          تصنيفات: {tags.map((tag) => CATEGORY_TAG_LABELS[tag].ar).join('، ')}
        </p>

        <div className="text-sm pt-1 space-y-1">
          <p className="font-bold text-neutral-900">{IDENTITY_LEVEL_LABELS[identity.level]}</p>
          <ul className="list-disc list-inside space-y-0.5 text-neutral-700 text-xs">
            {identity.reasons.map((reason, i) => (
              <li key={i} dir="auto">
                {reason}
              </li>
            ))}
          </ul>
        </div>

        {detail.aliases.length > 0 ? (
          <p className="text-xs text-neutral-600 pt-1" dir="auto">
            أسماء بديلة مسجلة: {detail.aliases.join('، ')}
          </p>
        ) : null}
      </header>

      {/* 2 — Current picture */}
      <CitedBrief
        brief={detail.brief}
        state={merchant.state}
        identifiers={detail.identifiers}
        evidence={detail.evidence}
        relatedRelations={detail.related.map((r) => r.relation)}
      />

      {/* 3 — Important observations */}
      {importantClaims.length > 0 ? (
        <section aria-labelledby="important-claims-heading" className="space-y-4">
          <h2 id="important-claims-heading" className="font-bold text-xl">
            ملاحظات مهمة من التعامل
          </h2>
          <p className="text-sm text-neutral-700">
            ملاحظات وادعاءات رئيسية مستندة إلى أدلة موثقة في السجل، مرتبة حسب الأهمية وحداثة التجارب.
          </p>
          <ClaimCards claims={importantClaims} evidence={detail.evidence} />
        </section>
      ) : null}

      {/* 4 — What is still unknown */}
      {caveats.length > 0 ? (
        <section
          aria-labelledby="unknowns-heading"
          className="border border-neutral-300 p-4 space-y-2 bg-neutral-50"
        >
          <h2 id="unknowns-heading" className="font-bold text-base text-neutral-900">
            ما لا يزال غير معلوم
          </h2>
          <ul className="space-y-1.5 list-disc list-inside text-sm text-neutral-800">
            {caveats.map((caveat, idx) => (
              <li key={idx} dir="auto">
                {caveat}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 5 — All evidence and sources */}
      {rootEvidence.length > 0 ? (
        <section aria-labelledby="all-evidence-heading" className="space-y-4">
          <h2 id="all-evidence-heading" className="font-bold text-xl">
            جميع الأدلة والمصادر
          </h2>
          <p className="text-sm text-neutral-700">
            سجلات الأدلة الأصلية المستقلة المرصودة لهذا المتجر مع مصادرها المباشرة.
          </p>

          {/* Filter chips / source categories */}
          {availableCategories.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="فئات المصادر">
              <span className="font-bold text-neutral-700">فئات المصادر المتوفرة:</span>
              {availableCategories.map(([cat, count]) => (
                <span
                  key={cat}
                  className="border border-neutral-300 px-2 py-1 rounded bg-white text-neutral-800"
                >
                  {sourceCategoryLabel(cat)}: <span dir="ltr">{count}</span>
                </span>
              ))}
            </div>
          ) : null}

          {/* Root evidence list */}
          <ul className="flex flex-col gap-4 p-0 list-none">
            {rootEvidence.map((evidence) => (
              <li key={evidence.id}>
                <EvidenceCard evidence={evidence} />
              </li>
            ))}
          </ul>

          {/* Duplicate children disclosure */}
          {duplicateChildren.length > 0 ? (
            <details className="border border-neutral-300 p-3 rounded text-sm">
              <summary className="font-bold cursor-pointer min-h-[44px] inline-flex items-center">
                سجلات مكررة مستبعدة من الاحتساب المستقل ({duplicateChildren.length})
              </summary>
              <p className="mt-2 text-xs text-neutral-600">
                هذه السجلات تطابق أدلة أصلية مسجلة أعلاه، وتُحفظ للتوثيق المرجعي دون تكرار احتسابها
                كتجارب منفصلة.
              </p>
              <ul className="mt-3 flex flex-col gap-3 list-none p-0">
                {duplicateChildren.map((evidence) => (
                  <li key={evidence.id}>
                    <EvidenceCard evidence={evidence} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {/* Source-only disclosure */}
          {detail.sourceOnlyCount > 0 ? (
            <details className="border border-neutral-300 p-3 rounded text-sm">
              <summary className="font-bold cursor-pointer min-h-[44px] inline-flex items-center">
                مصادر محفوظة بلا سياق نصي ({detail.sourceOnlyCount})
              </summary>
              <p className="mt-2 text-xs text-neutral-600">
                مصادر رُصدت في السجل دون أن تشتمل على ملخص أو اقتباس نصي مباشر، وتُحفظ للتوثيق
                المرجعي دون احتسابها كحقائق مستقلة.
              </p>
            </details>
          ) : null}
        </section>
      ) : null}

      {/* 6 — Store details */}
      <section aria-labelledby="store-details-heading" className="space-y-4">
        <h2 id="store-details-heading" className="font-bold text-xl">
          بيانات المتجر المسجلة
        </h2>
        <p className="text-sm text-neutral-700">
          هذه بيانات ومعرفات مسجلة في اللقطة وليست فروعًا مؤكدة أو إقرارًا بملكيتها.
        </p>

        {officialWebsites.length > 0 ? (
          <div className="text-sm space-y-1">
            <h3 className="font-bold">الروابط الرسمية المتاحة</h3>
            <ul className="space-y-1 list-none p-0">
              {officialWebsites.map((site) => {
                const safe = safeHttpUrl(site.normalizedValue || site.value);
                if (safe) {
                  return (
                    <li key={site.id}>
                      <a
                        href={safe}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline break-all"
                        dir="ltr"
                      >
                        {site.value}
                      </a>
                    </li>
                  );
                }
                return (
                  <li key={site.id} dir="ltr">
                    {site.value}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {detail.identifiers.length > 0 ? (
          <div>
            <h3 className="font-bold text-sm mb-2">المعرفات ووسائل التواصل</h3>
            <IdentifierList identifiers={detail.identifiers} />
          </div>
        ) : null}

        {addressIdentifiers.length > 0 || merchant.city ? (
          <div className="text-sm space-y-1">
            <h3 className="font-bold">سجلات المواقع والعناوين</h3>
            <p className="text-neutral-800">
              المدينة المسجلة: <span dir="auto">{merchant.city}</span> (
              {governorateKey !== null
                ? GOVERNORATE_LABELS[governorateKey].ar
                : merchant.governorate}
              )
            </p>
            {addressIdentifiers.length > 1 ? (
              <p>
                توجد عدة مواقع مسجلة: <span dir="ltr">{addressIdentifiers.length}</span> سجلات
                عناوين مختلفة في اللقطة.
              </p>
            ) : null}
            <p className="text-xs text-neutral-500">
              تنبيه: سجلات العناوين المذكورة هي مواقع وردت في بيانات الرصد وليست فروعًا تجارية محسومة.
            </p>
          </div>
        ) : null}
      </section>

      {/* 7 — Possibly related profiles */}
      {detail.related.length > 0 ? (
        <section aria-labelledby="related-heading" className="space-y-3">
          <h2 id="related-heading" className="font-bold text-xl">
            ملفات قد تكون مرتبطة
          </h2>
          <p className="text-sm text-neutral-700">
            هذه العلاقات مشتقة من تطابقات آلية للمعرفات (قد يكون مرتبطًا) وليست إثباتًا لملكية
            مشتركة أو إدارة واحدة.
          </p>
          <RelatedMerchants related={detail.related} />
        </section>
      ) : null}

      {/* 8 — Freshness and method */}
      <footer
        aria-labelledby="freshness-method-heading"
        className="border-t border-black pt-4 space-y-3 text-sm text-neutral-700"
      >
        <h2 id="freshness-method-heading" className="font-bold text-lg text-neutral-900">
          الحداثة والمنهجية
        </h2>

        <div>
          <p>
            تاريخ توليد لقطة البيانات:{' '}
            <time dateTime={snapshot.generatedAt.slice(0, 10)} dir="ltr">
              {formatDateAr(snapshot.generatedAt)}
            </time>
          </p>
        </div>

        <div className="space-y-1">
          <h3 className="font-bold text-xs">حالة التحقق من روابط المصادر:</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <li>
              يمكن الوصول: <span dir="ltr">{checkCounts.reachable}</span>
            </li>
            <li>
              تم التوجيه: <span dir="ltr">{checkCounts.redirected}</span>
            </li>
            <li>
              غير موجود: <span dir="ltr">{checkCounts.not_found}</span>
            </li>
            <li>
              وصول محدود: <span dir="ltr">{checkCounts.access_limited}</span>
            </li>
            <li>
              خطأ خادم: <span dir="ltr">{checkCounts.server_error}</span>
            </li>
            <li>
              تعذر الاتصال: <span dir="ltr">{checkCounts.network_error}</span>
            </li>
            <li>
              لم يتم التحقق بعد: <span dir="ltr">{checkCounts.not_checked}</span>
            </li>
          </ul>
        </div>

        <p className="text-xs text-neutral-600">
          تتيح الروابط المنشورة للقارئ الاطلاع المباشر على المادة الأصلية والتحقق منها بنفسه.
        </p>
      </footer>
    </article>
  );
}
