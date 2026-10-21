import type { EvidenceItem, Identifier, MerchantState } from './types';
import type { IdentifierRole } from './identifier-policy';
import type { Locale } from './i18n';

export type IdentityLevel = 'established' | 'supported' | 'uncertain';

export interface IdentityAssessment {
  level: IdentityLevel;
  /** Human-readable reasons; never a confidence percentage. */
  reasons: string[];
}

export type CoverageLevel = 'none' | 'limited' | 'moderate' | 'broad';

export interface EvidenceCoverage {
  level: CoverageLevel;
  total: number;
  nonDuplicate: number;
  duplicateCount: number;
  distinctSources: number;
  reviewedCount: number;
  undatedCount: number;
  latestPublishedAt: string | null;
  lastCapturedAt: string | null;
}

export type ReputationKind =
  | 'OFFICIAL_WARNING'
  | 'HIGH_RISK_SIGNALS'
  | 'MIXED_REPUTATION'
  | 'REQUIRES_MANUAL_REVIEW'
  | 'IDENTITY_UNCERTAIN'
  | 'INSUFFICIENT_DATA';

export interface ReputationAssessment {
  kind: ReputationKind;
  headline: string;
  explanation: string;
  /** Evidence ids backing this assessment — full traceability to source rows. */
  evidenceIds: string[];
  caveat: string | null;
}

/** Roles strong enough to establish identity on their own (two distinct) or support it (one). */
const HIGH_SIGNAL_ROLES: ReadonlySet<IdentifierRole> = new Set([
  'contact',
  'owned_site',
  'social_profile',
  'registration',
]);

/** Supporting roles: two distinct supporting roles equal one high-signal role. */
const SUPPORTING_ROLES: ReadonlySet<IdentifierRole> = new Set([
  'marketplace_profile',
  'location',
]);

const OFFICIAL_WARNING_CLAIM_TYPES: ReadonlySet<string> = new Set(['official_warning']);

/** Claim types whose only safe reading is "signals requiring verification". */
const RISK_CLAIM_TYPES: ReadonlySet<string> = new Set([
  'identity_mismatch',
  'counterfeit_product_allegation',
  'account_page_disappearance',
]);

const NEGATIVE_CLAIM_TYPES: ReadonlySet<string> = new Set([
  'refund_issue',
  'delayed_delivery',
  'complaint_unresolved',
  'communication_issue',
  'pricing_issue',
  'product_quality',
  'warranty_issue',
  'identity_mismatch',
  'counterfeit_product_allegation',
  'account_page_disappearance',
]);

const POSITIVE_CLAIM_TYPES: ReadonlySet<string> = new Set([
  'successful_purchase',
  'refund_issued',
  'complaint_resolved',
  'warranty_honored',
  'long_business_history',
  'verified_business_information',
  'repeated_recommendation',
  'physical_presence',
  'merchant_response',
  'after_sales_support',
]);

const STALE_WARNING_DAYS = 730;

function distinctDisplayableRoles(identifiers: Identifier[]): IdentifierRole[] {
  const roles: IdentifierRole[] = [];
  for (const identifier of identifiers) {
    if (!identifier.searchable && !identifier.displayable) continue;
    if (identifier.role === 'external_reference') continue;
    if (!roles.includes(identifier.role)) roles.push(identifier.role);
  }
  return roles;
}

export function assessIdentity(
  state: MerchantState,
  identifiers: Identifier[],
  relatedRelations: readonly string[],
  locale: Locale,
): IdentityAssessment {
  const activeLocale = locale === 'en' ? 'en' : 'ar';
  const reasons: string[] = [];
  const nameConflict = relatedRelations.includes('name_identifier_conflict');

  if (nameConflict || state === 'IDENTITY_UNCERTAIN') {
    if (nameConflict) {
      reasons.push(
        activeLocale === 'en'
          ? 'There is a conflict between the name and an identifier; identity cannot be confirmed.'
          : 'هناك تعارض بين الاسم وأحد المعرفات، لذا لا يمكن الجزم بالهوية.',
      );
    }
    if (state === 'IDENTITY_UNCERTAIN') {
      reasons.push(
        activeLocale === 'en'
          ? 'Identity data is uncertain and requires further verification.'
          : 'بيانات الهوية غير مؤكدة وتحتاج لمزيد من التدقيق.',
      );
    }
    return { level: 'uncertain', reasons };
  }

  const roles = distinctDisplayableRoles(identifiers);
  const highSignal = roles.filter((role) => HIGH_SIGNAL_ROLES.has(role));
  const supporting = roles.filter((role) => SUPPORTING_ROLES.has(role));

  if (highSignal.length >= 2) {
    reasons.push(
      activeLocale === 'en'
        ? 'Independent identifying markers (such as phone and official website) match this vendor.'
        : 'تتطابق علامات تعريف مستقلة (مثل هاتف وموقع رسمي) مع هذا التاجر.',
    );
    return { level: 'established', reasons };
  }
  if (highSignal.length >= 1 || supporting.length >= 2) {
    if (highSignal.length >= 1) {
      reasons.push(
        activeLocale === 'en'
          ? 'At least one direct identifying indicator is available for this vendor.'
          : 'يتوفر مؤشر تعريف مباشر واحد على الأقل لهذا التاجر.',
      );
    } else {
      reasons.push(
        activeLocale === 'en'
          ? 'Multiple indirect identifying indicators exist, but they are not conclusive.'
          : 'توجد مؤشرات تعريف غير مباشرة متعددة، لكنها ليست حاسمة.',
      );
    }
    return { level: 'supported', reasons };
  }
  reasons.push(
    activeLocale === 'en'
      ? 'Available identifiers are insufficient to confirm identity.'
      : 'المعرفات المتاحة لا تكفي لتأكيد الهوية.',
  );
  return { level: 'uncertain', reasons };
}

/**
 * Coverage bands over evidence rows. Duplicate children stay visible but are
 * never counted as a second independent observation; only the level uses
 * distinct non-duplicate sources.
 */
export function assessEvidenceCoverage(evidence: EvidenceItem[]): EvidenceCoverage {
  const nonDuplicate = evidence.filter((item) => item.duplicateOf === null);
  const distinctSources = new Set<string>();
  for (const item of nonDuplicate) {
    distinctSources.add(item.url.length > 0 ? item.url : `platform:${item.platform}`);
  }
  let undatedCount = 0;
  let latestPublishedAt: string | null = null;
  let lastCapturedAt: string | null = null;
  for (const item of evidence) {
    if (item.publishedAt === null) {
      undatedCount += 1;
    } else if (latestPublishedAt === null || item.publishedAt > latestPublishedAt) {
      latestPublishedAt = item.publishedAt;
    }
    if (lastCapturedAt === null || item.capturedAt > lastCapturedAt) {
      lastCapturedAt = item.capturedAt;
    }
  }
  const distinctCount = distinctSources.size;
  const level: CoverageLevel =
    distinctCount === 0
      ? 'none'
      : distinctCount <= 2
        ? 'limited'
        : distinctCount <= 5
          ? 'moderate'
          : 'broad';
  return {
    level,
    total: evidence.length,
    nonDuplicate: nonDuplicate.length,
    duplicateCount: evidence.length - nonDuplicate.length,
    distinctSources: distinctCount,
    reviewedCount: evidence.filter((item) => item.verified).length,
    undatedCount,
    latestPublishedAt,
    lastCapturedAt,
  };
}

export function isWarningEvidence(item: EvidenceItem): boolean {
  if (item.authorType === 'merchant') return false;
  if (OFFICIAL_WARNING_CLAIM_TYPES.has(item.claimType)) return true;
  return item.authorType === 'regulator' && NEGATIVE_CLAIM_TYPES.has(item.claimType);
}

export function isRiskEvidence(item: EvidenceItem): boolean {
  return item.authorType !== 'merchant' && RISK_CLAIM_TYPES.has(item.claimType);
}

function directionCounts(evidence: EvidenceItem[]): { negative: number; positive: number } {
  let negative = 0;
  let positive = 0;
  for (const item of evidence) {
    if (NEGATIVE_CLAIM_TYPES.has(item.claimType) || item.sentiment === 'negative') {
      negative += 1;
    } else if (POSITIVE_CLAIM_TYPES.has(item.claimType) || item.sentiment === 'positive') {
      positive += 1;
    }
  }
  return { negative, positive };
}

function warningAgeDays(item: EvidenceItem, now: Date): number | null {
  if (item.publishedAt === null) return null;
  const published = new Date(item.publishedAt);
  if (Number.isNaN(published.getTime())) return null;
  return Math.max(0, Math.round((now.getTime() - published.getTime()) / 86_400_000));
}

/**
 * Reputation assessment over non-duplicate evidence. Never merges identity
 * into the conclusion: VERIFIED_* states affect identity only. Merchant-authored
 * "official warning" advice (e.g. warnings about impersonators) is never treated
 * as a warning against the merchant itself.
 */
export function assessReputation(
  state: MerchantState,
  evidence: EvidenceItem[],
  locale: Locale,
  now: Date = new Date(),
): ReputationAssessment {
  const activeLocale = locale === 'en' ? 'en' : 'ar';
  const nonDuplicate = evidence.filter((item) => item.duplicateOf === null);
  const notable = nonDuplicate.filter((item) => item.verified || item.transactionEvidence);

  if (state === 'IDENTITY_UNCERTAIN') {
    return {
      kind: 'IDENTITY_UNCERTAIN',
      headline:
        activeLocale === 'en' ? 'No reputation inference can be attributed' : 'لا يمكن إسناد استنتاج سمعة',
      explanation:
        activeLocale === 'en'
          ? 'Because identity is uncertain, available evidence cannot be conclusively linked to this vendor, and no reputation judgment is drawn.'
          : 'بما أن الهوية غير مؤكدة، لا يمكن ربط الأدلة المتاحة بهذا التاجر بشكل قاطع، ولا يُستخلص أي حكم على السمعة.',
      evidenceIds: notable.map((item) => item.id),
      caveat:
        activeLocale === 'en'
          ? 'Compare identifiers and location before relying on any of this evidence.'
          : 'قارن المعرفات والموقع قبل الاعتماد على أي من هذه الأدلة.',
    };
  }

  if (nonDuplicate.length === 0) {
    return {
      kind: 'INSUFFICIENT_DATA',
      headline: activeLocale === 'en' ? 'Insufficient evidence' : 'الأدلة غير كافية',
      explanation:
        activeLocale === 'en'
          ? 'There is not enough non-duplicate evidence to form a picture of dealings with this vendor.'
          : 'لا توجد أدلة غير مكررة كافية لتكوين صورة عن التعامل مع هذا التاجر.',
      evidenceIds: [],
      caveat: null,
    };
  }

  const warningEvidence = nonDuplicate.filter(isWarningEvidence);
  const datedWarnings = warningEvidence
    .map((item) => ({ item, ageDays: warningAgeDays(item, now) }))
    .filter((entry): entry is { item: EvidenceItem; ageDays: number } => entry.ageDays !== null);
  const staleWarnings = datedWarnings.filter((entry) => entry.ageDays > STALE_WARNING_DAYS);

  const riskEvidence = nonDuplicate.filter(isRiskEvidence);
  const { negative, positive } = directionCounts(nonDuplicate);

  // OFFICIAL_WARNING requires linked warning evidence; the stored state alone
  // never justifies the label.
  if (warningEvidence.length > 0) {
    const oldestWarning = datedWarnings.reduce<{ item: EvidenceItem; ageDays: number } | null>(
      (acc, entry) => (acc === null || entry.ageDays > acc.ageDays ? entry : acc),
      null,
    );
    const warningIds = warningEvidence.map((item) => item.id);
    const oldestDate = oldestWarning?.item.publishedAt?.slice(0, 10) ?? (activeLocale === 'en' ? 'unknown' : 'غير معروف');

    if (staleWarnings.length > 0) {
      return {
        kind: 'OFFICIAL_WARNING',
        headline: activeLocale === 'en' ? 'Prior official notice (dated)' : 'إشارة رسمية سابقة (قديمة)',
        explanation:
          activeLocale === 'en'
            ? `A public authority noted a warning regarding this vendor, with the oldest warning dated ${oldestDate} — review the original source before making any decision.`
            : `رصدت جهة عامة تحذيرًا يتعلق بهذا التاجر، وأقدم تحذير مؤرخ بتاريخ ${oldestDate} — راجع المصدر الأصلي قبل اتخاذ أي قرار.`,
        evidenceIds: warningIds,
        caveat:
          activeLocale === 'en'
            ? 'This is a dated official warning, not a conviction; verify the source and whether the warning remains active.'
            : 'هذا تحذير رسمي مؤرخ وليس إدانة؛ تحقق من المصدر وما إذا كان التحذير ما زال ساريًا.',
      };
    }
    return {
      kind: 'OFFICIAL_WARNING',
      headline:
        activeLocale === 'en' ? 'Official notice backed by evidence' : 'إشارة رسمية مرتبطة بأدلة',
      explanation:
        activeLocale === 'en'
          ? 'Evidence from a public or regulatory authority is linked to this vendor, listed below with dates and sources.'
          : 'توجد أدلة من جهة عامة أو تنظيمية مرتبطة بهذا التاجر، مذكورة أدناه مع تواريخها ومصادرها.',
      evidenceIds: warningIds,
      caveat:
        activeLocale === 'en'
          ? 'This is a dated official notice, not a conviction. Open the original source and read details yourself.' +
            (oldestWarning !== null ? ` Oldest notice was ${oldestWarning.ageDays} days ago.` : '')
          : 'هذه إشارة رسمية مؤرخة وليست إدانة. افتح المصدر الأصلي واقرأ التفاصيل بنفسك.' +
            (oldestWarning !== null ? ` أقدم إشارة قبل ${oldestWarning.ageDays} يومًا.` : ''),
    };
  }
  if (state === 'OFFICIAL_WARNING') {
    return {
      kind: 'REQUIRES_MANUAL_REVIEW',
      headline: activeLocale === 'en' ? 'Requires manual review' : 'يحتاج مراجعة يدوية',
      explanation:
        activeLocale === 'en'
          ? 'Vendor status indicates an official warning, but no linked evidence supports this in the current data.'
          : 'حالة التاجر تشير إلى تحذير رسمي، لكن لا توجد أدلة مرتبطة تدعم ذلك ضمن البيانات الحالية.',
      evidenceIds: [],
      caveat:
        activeLocale === 'en'
          ? 'No published evidence supports this classification — do not rely on it without manual review.'
          : 'لا يوجد دليل منشور يدعم هذا التصنيف — لا تعتمد عليه دون مراجعة يدوية.',
    };
  }

  // Risk claims always produce a "signals requiring verification" assessment,
  // regardless of the stored state.
  if (riskEvidence.length > 0) {
    return {
      kind: 'HIGH_RISK_SIGNALS',
      headline: activeLocale === 'en' ? 'Signals requiring verification' : 'إشارات تتطلب تحققًا',
      explanation:
        activeLocale === 'en'
          ? 'Serious reports or allegations appear in the evidence below. These are signals requiring source verification, not conclusive proof.'
          : 'توجد تقارير أو ادعاءات خطيرة في الأدلة أدناه. هذه إشارات تتطلب تحققًا من المصدر وليست إثباتًا قاطعًا.',
      evidenceIds: riskEvidence.map((item) => item.id),
      caveat:
        activeLocale === 'en'
          ? 'Read the original source for each signal; claims may be unconfirmed or outdated.'
          : 'اقرأ المصدر الأصلي لكل إشارة؛ قد تكون الادعاءات غير مؤكدة أو متقادمة.',
    };
  }
  if (negative > 0 && positive > 0) {
    return {
      kind: 'MIXED_REPUTATION',
      headline: activeLocale === 'en' ? 'Conflicting evidence' : 'أدلة متضاربة',
      explanation:
        activeLocale === 'en'
          ? `Non-duplicate evidence contains ${positive} positive and ${negative} negative signal(s); read sources to understand context.`
          : `تحتوي الأدلة غير المكررة على ${positive} إشارة إيجابية و${negative} إشارة سلبية؛ اقرأ المصادر لفهم السياق.`,
      evidenceIds: notable.map((item) => item.id),
      caveat:
        activeLocale === 'en'
          ? 'Conflicting signals often reflect differing experiences or time periods — check the dates.'
          : 'التضارب يعني غالبًا تجارب مختلفة أو فترات زمنية مختلفة — راجع التواريخ.',
    };
  }
  if (negative > 0) {
    return {
      kind: 'MIXED_REPUTATION',
      headline: activeLocale === 'en' ? 'Negative reports — review sources' : 'تقارير سلبية — راجع المصادر',
      explanation:
        activeLocale === 'en'
          ? `There are ${negative} negative signal(s) in non-duplicate evidence. Review the source and date of each report before relying on it.`
          : `توجد ${negative} إشارة سلبية في الأدلة غير المكررة. راجع المصدر وتاريخ كل تقرير قبل الاعتماد عليها.`,
      evidenceIds: nonDuplicate
        .filter((item) => NEGATIVE_CLAIM_TYPES.has(item.claimType) || item.sentiment === 'negative')
        .map((item) => item.id),
      caveat:
        activeLocale === 'en'
          ? 'Customer complaints reflect individual experiences; they may not represent the vendor’s current status.'
          : 'الشكاوى تعكس تجارب أفراد؛ قد لا تمثل الوضع الحالي للتاجر.',
    };
  }
  if (positive > 0) {
    return {
      kind: 'MIXED_REPUTATION',
      headline: activeLocale === 'en' ? 'Positive signals, not a guarantee' : 'إشارات إيجابية، ليست ضمانة',
      explanation:
        activeLocale === 'en'
          ? `There are ${positive} positive signal(s) in non-duplicate evidence. Positive signals are not a guarantee of future purchase quality.`
          : `توجد ${positive} إشارة إيجابية في الأدلة غير المكررة. الإشارات الإيجابية ليست ضمانًا لجودة التعامل مستقبلًا.`,
      evidenceIds: nonDuplicate
        .filter((item) => POSITIVE_CLAIM_TYPES.has(item.claimType) || item.sentiment === 'positive')
        .map((item) => item.id),
      caveat: null,
    };
  }

  return {
    kind: 'INSUFFICIENT_DATA',
    headline: activeLocale === 'en' ? 'Insufficient evidence' : 'الأدلة غير كافية',
    explanation:
      activeLocale === 'en'
        ? 'Available evidence is neutral or inconclusive, and insufficient to form a picture of dealings with this vendor.'
        : 'الأدلة المتاحة محايدة أو غير حاسمة، ولا تكفي لتكوين صورة عن التعامل مع هذا التاجر.',
    evidenceIds: notable.map((item) => item.id),
    caveat:
      notable.length > 0
        ? activeLocale === 'en'
          ? 'Additional evidence is listed below; review it yourself.'
          : 'هناك أدلة إضافية مذكورة أدناه؛ راجعها بنفسك.'
        : null,
  };
}
