import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  ChevronDown,
  Database,
  ExternalLink,
  FileSearch,
  Fingerprint,
  MessageSquareQuote,
  ShieldCheck,
} from 'lucide-react';

import { CitedBrief } from '@/components/CitedBrief';
import { ClaimCards } from '@/components/ClaimCards';
import { EvidenceCard } from '@/components/EvidenceCard';
import { IdentifierList } from '@/components/IdentifierList';
import { RelatedMerchants } from '@/components/RelatedMerchants';
import { AdBottomBanner } from '@/components/ads';
import { CopyReportButton } from './CopyReportButton';
import {
  ageInDays,
  formatDate,
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
import { canDisplayAdsOnPage } from '@/lib/ads';
import { checkStatusLabel, identityLevelLabel } from '@/lib/labels';
import { getDb } from '@/lib/singletons';
import { isLocale, LOCALES, t, type Locale } from '@/lib/i18n';
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
  params: Promise<{ locale: string; id: string }>;
}

export const dynamicParams = false;

export function generateStaticParams(): { locale: Locale; id: string }[] {
  const ids = getDb()
    .getMerchantDirectoryEntries()
    .map((entry) => entry.id);
  return LOCALES.flatMap((locale) => ids.map((id) => ({ locale, id })));
}

export async function generateMetadata({ params }: MerchantPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  const active: Locale = isLocale(locale) ? locale : 'ar';
  const strings = t(active);
  const detail = getDb().getMerchantDetailLocalized(id, active);
  if (!detail) return { title: strings.vendorNotFound };
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
  const { locale: rawLocale, id } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale;
  const strings = t(locale);
  const delimiter = locale === 'en' ? ', ' : '، ';

  const detail = getDb().getMerchantDetailLocalized(id, locale);
  if (!detail) notFound();

  const { merchant, snapshot } = detail;
  const identity = assessIdentity(
    merchant.state,
    detail.identifiers,
    detail.related.map((r) => r.relation),
    locale,
  );
  const coverage = assessEvidenceCoverage(detail.evidence);
  const tags = categoryTags(merchant.category);
  const governorateKey = normalizeGovernorate(merchant.governorate);
  const { districtHints } = splitCityDisplay(merchant.city);

  const importantClaims = selectImportantClaims(detail.claims, detail.evidence);

  // Brand safety gate for AdSense
  const hasAdverseClaims = detail.evidence.some(
    (e) => e.independent && e.sentiment === 'negative' && e.authorType !== 'merchant',
  );
  const hasOfficialWarning =
    merchant.state === 'OFFICIAL_WARNING' ||
    detail.claims.some((c) => c.claimType === 'official_warning') ||
    detail.evidence.some((e) => isWarningEvidence(e) || e.claimType === 'official_warning');
  const isHighRisk = merchant.state === 'HIGH_RISK_SIGNALS';

  const adsAllowed = canDisplayAdsOnPage({
    hasAdverseClaims,
    hasOfficialWarning,
    isHighRisk,
  });

  // Caveats computation
  const caveats: string[] = [];
  if (coverage.level === 'none' || coverage.level === 'limited') {
    caveats.push(strings.caveatLimitedCoverage);
  }
  if (
    coverage.latestPublishedAt !== null &&
    ageInDays(coverage.latestPublishedAt) !== null &&
    ageInDays(coverage.latestPublishedAt)! > STALE_PUBLISHED_DAYS
  ) {
    caveats.push(
      strings.caveatStaleData.replace('{date}', formatDate(coverage.latestPublishedAt, locale)),
    );
  }
  if (detail.sourceOnlyCount > 0) {
    caveats.push(
      strings.caveatSourceOnly.replace('{count}', String(detail.sourceOnlyCount)),
    );
  }

  // Evidence separation
  const rootEvidence = detail.evidence.filter((e) => e.duplicateOf === null);
  const duplicateChildren = detail.evidence.filter((e) => e.duplicateOf !== null);

  const categoryCounts = new Map<SourceCategory, number>();
  for (const item of rootEvidence) {
    categoryCounts.set(item.sourceCategory, (categoryCounts.get(item.sourceCategory) ?? 0) + 1);
  }
  const availableCategories = [...categoryCounts.entries()].sort(
    ([catA, countA], [catB, countB]) =>
      countB - countA || sourceCategoryLabel(catA, locale).localeCompare(sourceCategoryLabel(catB, locale), locale),
  );

  // Link-check summary counts
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

  const navSections = [
    { id: 'overview', title: strings.currentPictureHeading },
    ...(importantClaims.length > 0
      ? [{ id: 'claims', title: strings.importantObservations }]
      : []),
    ...(caveats.length > 0
      ? [{ id: 'coverage', title: strings.whatIsStillUnknown }]
      : []),
    ...(rootEvidence.length > 0
      ? [{ id: 'evidence', title: strings.allEvidenceAndSources }]
      : []),
    { id: 'identifiers', title: strings.registeredStoreData },
    ...(detail.related.length > 0
      ? [{ id: 'related', title: strings.possiblyRelatedProfiles }]
      : []),
    { id: 'sources', title: strings.freshnessAndMethod },
  ];

  return (
    <article className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* .report-top */}
      <div className="report-top">
        <Link href={`/${locale}/merchants`} className="text-link">
          {locale === 'ar' ? (
            <>
              <ArrowRight size={16} aria-hidden="true" />
              <span>{strings.directory}</span>
            </>
          ) : (
            <>
              <ArrowLeft size={16} aria-hidden="true" />
              <span>{strings.directory}</span>
            </>
          )}
        </Link>
        <CopyReportButton locale={locale} />
      </div>

      {/* 1 — Identity header */}
      <header className="page-heading">
        <div className="eyebrow">
          <span />
          {locale === 'ar' ? 'تقرير فحص التاجر' : 'MERCHANT INVESTIGATION REPORT'}
        </div>
        <h1>
          <Fingerprint size={28} className="text-[#4a7c7e] flex-shrink-0" aria-hidden="true" />
          <span dir="auto">{merchant.canonicalName}</span>
        </h1>

        <p className="text-sm text-[#56606a] mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span dir="auto">{merchant.category}</span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden="true">·</span>
            <span dir="auto">{merchant.city}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden="true">·</span>
            <span dir="auto">
              {governorateKey !== null ? GOVERNORATE_LABELS[governorateKey][locale] : merchant.governorate}
            </span>
          </span>
        </p>

        {districtHints.length > 0 ? (
          <p className="text-xs text-[#56606a] mt-1">
            {strings.potentialDistricts}
            {districtHints
              .map((hint) => (
                <span key={hint} dir="auto" className="font-medium text-[#56606a]">
                  {hint}
                </span>
              ))
              .reduce((acc, el, i) => (
                <>
                  {acc}
                  {i > 0 ? delimiter : ''}
                  {el}
                </>
              ), <></>)}
          </p>
        ) : null}

        <p className="text-xs text-[#56606a] mt-1">
          {strings.categoriesPrefix}
          <span className="text-[#56606a]">
            {tags.map((tag) => CATEGORY_TAG_LABELS[tag][locale]).join(delimiter)}
          </span>
        </p>

        <div className="mt-3 p-3 bg-[#fafbf6] border border-[#e4e3de] rounded text-sm space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-[#4a7c7e]" aria-hidden="true" />
            <p className="font-semibold text-xs text-[#2a3441]">{identityLevelLabel(identity.level, locale)}</p>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-xs text-[#56606a]">
            {identity.reasons.map((reason, i) => (
              <li key={i} dir="auto">
                {reason}
              </li>
            ))}
          </ul>
        </div>

        {detail.aliases.length > 0 ? (
          <p className="text-xs text-[#56606a] mt-2" dir="auto">
            {strings.registeredAliases}{detail.aliases.join(delimiter)}
          </p>
        ) : null}
      </header>

      {/* .report-nav */}
      <nav className="report-nav" aria-label={locale === 'ar' ? 'أقسام التقرير' : 'Report sections'}>
        {navSections.map((s) => (
          <a href={`#${s.id}`} key={s.id}>
            {s.title}
          </a>
        ))}
      </nav>

      <div className="report-sections">
        {/* 2 — Current picture */}
        <CitedBrief
          id="overview"
          brief={detail.brief}
          state={merchant.state}
          identifiers={detail.identifiers}
          evidence={detail.evidence}
          relatedRelations={detail.related.map((r) => r.relation)}
          locale={locale}
        />

        {/* 3 — Important observations */}
        {importantClaims.length > 0 ? (
          <section id="claims" aria-labelledby="important-claims-heading" className="report-section">
            <h2>
              <MessageSquareQuote size={21} aria-hidden="true" />
              <span id="important-claims-heading">{strings.importantObservations}</span>
            </h2>
            <p className="section-note">
              {strings.importantObservationsDesc}
            </p>
            <div className="mt-4">
              <ClaimCards claims={importantClaims} evidence={detail.evidence} locale={locale} />
            </div>
          </section>
        ) : null}

        {/* 4 — What is still unknown */}
        {caveats.length > 0 ? (
          <section id="coverage" aria-labelledby="unknowns-heading" className="report-section">
            <h2>
              <Database size={21} aria-hidden="true" />
              <span id="unknowns-heading">{strings.whatIsStillUnknown}</span>
            </h2>
            <p className="section-note">
              {locale === 'ar'
                ? 'التغطية تصف توفر الأدلة وحدودها، وليست مقياسًا للثقة.'
                : 'Coverage describes evidence availability and limits, not trust.'}
            </p>
            <div className="stance-guide mt-4">
              <ul className="space-y-1.5 list-disc list-inside text-xs text-[#56606a]">
                {caveats.map((caveat, idx) => (
                  <li key={idx} dir="auto">
                    {caveat}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* 5 — All evidence and sources */}
        {rootEvidence.length > 0 ? (
          <section id="evidence" aria-labelledby="all-evidence-heading" className="report-section">
            <h2>
              <FileSearch size={21} aria-hidden="true" />
              <span id="all-evidence-heading">{strings.allEvidenceAndSources}</span>
            </h2>
            <p className="section-note">
              {strings.allEvidenceDesc}
            </p>

            {/* Filter chips / source categories */}
            {availableCategories.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 mt-4" aria-label={strings.availableSourceCategories}>
                <span className="text-xs font-medium text-[#56606a]">{strings.availableSourceCategories}</span>
                {availableCategories.map(([cat, count]) => (
                  <span
                    key={cat}
                    className="border border-[#e4e3de] bg-[#fdfcf9] px-2.5 py-1 rounded text-xs text-[#2a3441]"
                  >
                    {sourceCategoryLabel(cat, locale)}: <span dir="ltr" className="font-semibold">{count}</span>
                  </span>
                ))}
              </div>
            ) : null}

            {/* Root evidence list */}
            <ul className="flex flex-col gap-4 p-0 list-none mt-4">
              {rootEvidence.map((evidence) => (
                <li key={evidence.id}>
                  <EvidenceCard evidence={evidence} locale={locale} />
                </li>
              ))}
            </ul>

            {/* Duplicate children disclosure */}
            {duplicateChildren.length > 0 ? (
              <details className="group border border-[#e4e3de] bg-[#fafaf6] p-3.5 rounded text-xs mt-4">
                <summary className="font-medium text-[#56606a] cursor-pointer min-h-[44px] inline-flex items-center gap-1.5">
                  <ChevronDown size={14} className="transition-transform group-open:rotate-180 text-[#56606a] flex-shrink-0" aria-hidden="true" />
                  <span>{strings.duplicateRecordsExcluded.replace('{count}', String(duplicateChildren.length))}</span>
                </summary>
                <p className="mt-2 text-xs text-[#56606a]">
                  {strings.duplicateRecordsDesc}
                </p>
                <ul className="mt-3 flex flex-col gap-3 list-none p-0">
                  {duplicateChildren.map((evidence) => (
                    <li key={evidence.id}>
                      <EvidenceCard evidence={evidence} locale={locale} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {/* Source-only disclosure */}
            {detail.sourceOnlyCount > 0 ? (
              <details className="group border border-[#e4e3de] bg-[#fafaf6] p-3.5 rounded text-xs mt-3">
                <summary className="font-medium text-[#56606a] cursor-pointer min-h-[44px] inline-flex items-center gap-1.5">
                  <ChevronDown size={14} className="transition-transform group-open:rotate-180 text-[#56606a] flex-shrink-0" aria-hidden="true" />
                  <span>{strings.sourceOnlyRecords.replace('{count}', String(detail.sourceOnlyCount))}</span>
                </summary>
                <p className="mt-2 text-xs text-[#56606a]">
                  {strings.sourceOnlyDesc}
                </p>
              </details>
            ) : null}
          </section>
        ) : null}

        {/* 6 — Store details */}
        <section id="identifiers" aria-labelledby="store-details-heading" className="report-section">
          <h2>
            <Fingerprint size={21} aria-hidden="true" />
            <span id="store-details-heading">{strings.registeredStoreData}</span>
          </h2>
          <p className="section-note">
            {strings.storeDataDisclaimer}
          </p>

          <div className="space-y-4 mt-4">
            {officialWebsites.length > 0 ? (
              <div className="text-xs space-y-1.5 p-3.5 bg-[#fdfcf9] border border-[#e4e3de] rounded">
                <h3 className="font-semibold text-xs text-[#2a3441]">{strings.availableOfficialLinks}</h3>
                <ul className="space-y-1 list-none p-0 m-0">
                  {officialWebsites.map((site) => {
                    const safe = safeHttpUrl(site.normalizedValue || site.value);
                    if (safe) {
                      return (
                        <li key={site.id}>
                          <a
                            href={safe}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-link"
                            dir="ltr"
                          >
                            <span>{site.value}</span>
                            <ExternalLink size={12} aria-hidden="true" />
                          </a>
                        </li>
                      );
                    }
                    return (
                      <li key={site.id} dir="ltr" className="text-[#56606a]">
                        {site.value}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {detail.identifiers.length > 0 ? (
              <div>
                <h3 className="font-semibold text-xs text-[#56606a] uppercase tracking-wider mb-2">
                  {strings.identifiersAndContacts}
                </h3>
                <IdentifierList identifiers={detail.identifiers} locale={locale} />
              </div>
            ) : null}

            {addressIdentifiers.length > 0 || merchant.city ? (
              <div className="text-xs space-y-1 p-3.5 bg-[#fafbf6] border border-[#e4e3de] rounded">
                <h3 className="font-semibold text-xs text-[#2a3441]">{strings.locationAndAddressRecords}</h3>
                <p className="text-[#56606a]">
                  {strings.registeredCity}<span dir="auto" className="font-medium text-[#2a3441]">{merchant.city}</span> (
                  {governorateKey !== null
                    ? GOVERNORATE_LABELS[governorateKey][locale]
                    : merchant.governorate}
                  )
                </p>
                {addressIdentifiers.length > 1 ? (
                  <p className="text-[#56606a]">
                    {strings.multipleRecordedLocationsNotice.replace('{count}', String(addressIdentifiers.length))}
                  </p>
                ) : null}
                <p className="text-[11px] text-[#56606a]">
                  {strings.locationsNoticeCaveat}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        {/* 7 — Possibly related profiles */}
        {detail.related.length > 0 ? (
          <section id="related" aria-labelledby="related-heading" className="report-section">
            <h2>
              <Building2 size={21} aria-hidden="true" />
              <span id="related-heading">{strings.possiblyRelatedProfiles}</span>
            </h2>
            <p className="section-note">
              {strings.relatedProfilesDesc}
            </p>
            <div className="mt-3">
              <RelatedMerchants related={detail.related} locale={locale} />
            </div>
          </section>
        ) : null}

        {/* Brand safety gated ad placement */}
        {adsAllowed ? <AdBottomBanner locale={locale} /> : null}

        {/* 8 — Freshness and method */}
        <footer
          id="sources"
          aria-labelledby="freshness-method-heading"
          className="report-section space-y-3"
        >
          <h2>
            <BookOpen size={21} aria-hidden="true" />
            <span id="freshness-method-heading">{strings.freshnessAndMethod}</span>
          </h2>

          <div className="text-xs text-[#56606a]">
            <p>
              {strings.snapshotGeneratedAt}{' '}
              <time dateTime={snapshot.generatedAt.slice(0, 10)} dir="ltr" className="font-semibold text-[#2a3441]">
                {formatDate(snapshot.generatedAt, locale)}
              </time>
            </p>
          </div>

          <div className="space-y-1.5 mt-3">
            <h3 className="font-semibold text-xs text-[#2a3441]">{strings.sourceLinkVerificationStatus}</h3>
            <ul className="flex flex-wrap gap-2 text-xs list-none p-0 m-0">
              <li className="bg-[#fdfcf9] border border-[#e4e3de] px-2.5 py-1 rounded">
                {checkStatusLabel('reachable', locale)}: <span dir="ltr" className="font-semibold text-[#2a3441]">{checkCounts.reachable}</span>
              </li>
              <li className="bg-[#fdfcf9] border border-[#e4e3de] px-2.5 py-1 rounded">
                {checkStatusLabel('redirected', locale)}: <span dir="ltr" className="font-semibold text-[#2a3441]">{checkCounts.redirected}</span>
              </li>
              <li className="bg-[#fdfcf9] border border-[#e4e3de] px-2.5 py-1 rounded">
                {checkStatusLabel('not_found', locale)}: <span dir="ltr" className="font-semibold text-[#2a3441]">{checkCounts.not_found}</span>
              </li>
              <li className="bg-[#fdfcf9] border border-[#e4e3de] px-2.5 py-1 rounded">
                {checkStatusLabel('access_limited', locale)}: <span dir="ltr" className="font-semibold text-[#2a3441]">{checkCounts.access_limited}</span>
              </li>
              <li className="bg-[#fdfcf9] border border-[#e4e3de] px-2.5 py-1 rounded">
                {checkStatusLabel('server_error', locale)}: <span dir="ltr" className="font-semibold text-[#2a3441]">{checkCounts.server_error}</span>
              </li>
              <li className="bg-[#fdfcf9] border border-[#e4e3de] px-2.5 py-1 rounded">
                {checkStatusLabel('network_error', locale)}: <span dir="ltr" className="font-semibold text-[#2a3441]">{checkCounts.network_error}</span>
              </li>
              <li className="bg-[#fdfcf9] border border-[#e4e3de] px-2.5 py-1 rounded">
                {checkStatusLabel('not_checked', locale)}: <span dir="ltr" className="font-semibold text-[#2a3441]">{checkCounts.not_checked}</span>
              </li>
            </ul>
          </div>

          <p className="text-xs text-[#56606a] pt-2 border-t border-[#e4e3de]">
            {strings.directSourcesNotice}
          </p>
        </footer>
      </div>
    </article>
  );
}
