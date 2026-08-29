import type { EvidenceItem, Identifier, MerchantState } from './types';
import type { IdentifierRole } from './identifier-policy';

export type IdentityLevel = 'established' | 'supported' | 'uncertain';

export interface IdentityAssessment {
  level: IdentityLevel;
  /** Human-readable Arabic reasons; never a confidence percentage. */
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
): IdentityAssessment {
  const reasons: string[] = [];
  const nameConflict = relatedRelations.includes('name_identifier_conflict');
  if (nameConflict || state === 'IDENTITY_UNCERTAIN') {
    if (nameConflict) {
      reasons.push('هناك تعارض بين الاسم وأحد المعرفات، لذا لا يمكن الجزم بالهوية.');
    }
    if (state === 'IDENTITY_UNCERTAIN') {
      reasons.push('حالة الهوية الداخلية للتحليل: غير مؤكدة.');
    }
    return { level: 'uncertain', reasons };
  }

  const roles = distinctDisplayableRoles(identifiers);
  const highSignal = roles.filter((role) => HIGH_SIGNAL_ROLES.has(role));
  const supporting = roles.filter((role) => SUPPORTING_ROLES.has(role));

  if (highSignal.length >= 2) {
    reasons.push('تتطابق علامات تعريف مستقلة (مثل هاتف وموقع رسمي) مع هذا التاجر.');
    return { level: 'established', reasons };
  }
  if (highSignal.length >= 1 || supporting.length >= 2) {
    if (highSignal.length >= 1) {
      reasons.push('يتوفر مؤشر تعريف مباشر واحد على الأقل لهذا التاجر.');
    } else {
      reasons.push('توجد مؤشرات تعريف غير مباشرة متعددة، لكنها ليست حاسمة.');
    }
    return { level: 'supported', reasons };
  }
  reasons.push('المعرفات المتاحة لا تكفي لتأكيد الهوية.');
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

function isWarningEvidence(item: EvidenceItem): boolean {
  if (item.authorType === 'merchant') return false;
  if (OFFICIAL_WARNING_CLAIM_TYPES.has(item.claimType)) return true;
  return item.authorType === 'regulator' && NEGATIVE_CLAIM_TYPES.has(item.claimType);
}

function isRiskEvidence(item: EvidenceItem): boolean {
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
  now: Date = new Date(),
): ReputationAssessment {
  const nonDuplicate = evidence.filter((item) => item.duplicateOf === null);
  const notable = nonDuplicate.filter((item) => item.verified || item.transactionEvidence);

  if (state === 'IDENTITY_UNCERTAIN') {
    return {
      kind: 'IDENTITY_UNCERTAIN',
      headline: 'لا يمكن إسناد استنتاج سمعة',
      explanation:
        'بما أن الهوية غير مؤكدة، لا يمكن ربط الأدلة المتاحة بهذا التاجر بشكل قاطع، ولا يُستخلص أي حكم على السمعة.',
      evidenceIds: notable.map((item) => item.id),
      caveat: 'قارن المعرفات والموقع قبل الاعتماد على أي من هذه الأدلة.',
    };
  }

  if (nonDuplicate.length === 0) {
    return {
      kind: 'INSUFFICIENT_DATA',
      headline: 'الأدلة غير كافية',
      explanation: 'لا توجد أدلة غير مكررة كافية لتكوين صورة عن التعامل مع هذا التاجر.',
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
    const oldest = datedWarnings.reduce<number | null>(
      (acc, entry) => (acc === null || entry.ageDays < acc ? entry.ageDays : acc),
      null,
    );
    const warningIds = warningEvidence.map((item) => item.id);
    if (staleWarnings.length > 0) {
      return {
        kind: 'OFFICIAL_WARNING',
        headline: 'إشارة رسمية سابقة (قديمة)',
        explanation:
          `رصدت جهة عامة تحذيرًا يتعلق بهذا التاجر، وأقدم تحذير مؤرخ بتاريخ ${staleWarnings[0].item.publishedAt?.slice(0, 10) ?? 'غير معروف'} — راجع المصدر الأصلي قبل اتخاذ أي قرار.`,
        evidenceIds: warningIds,
        caveat: 'هذا تحذير رسمي مؤرخ وليس إدانة؛ تحقق من المصدر وما إذا كان التحذير ما زال ساريًا.',
      };
    }
    return {
      kind: 'OFFICIAL_WARNING',
      headline: 'إشارة رسمية مرتبطة بأدلة',
      explanation:
        'توجد أدلة من جهة عامة أو تنظيمية مرتبطة بهذا التاجر، مذكورة أدناه مع تواريخها ومصادرها.',
      evidenceIds: warningIds,
      caveat:
        'هذه إشارة رسمية مؤرخة وليست إدانة. افتح المصدر الأصلي واقرأ التفاصيل بنفسك.' +
        (oldest !== null ? ` أقدم إشارة قبل ${oldest} يومًا.` : ''),
    };
  }
  if (state === 'OFFICIAL_WARNING') {
    return {
      kind: 'REQUIRES_MANUAL_REVIEW',
      headline: 'يحتاج مراجعة يدوية',
      explanation:
        'حالة التاجر تشير إلى تحذير رسمي، لكن لا توجد أدلة مرتبطة تدعم ذلك ضمن البيانات الحالية.',
      evidenceIds: [],
      caveat: 'لا يوجد دليل منشور يدعم هذا التصنيف — لا تعتمد عليه دون مراجعة يدوية.',
    };
  }

  // Risk claims always produce a "signals requiring verification" assessment,
  // regardless of the stored state.
  if (riskEvidence.length > 0) {
    return {
      kind: 'HIGH_RISK_SIGNALS',
      headline: 'إشارات تتطلب تحققًا',
      explanation:
        'توجد تقارير أو ادعاءات خطيرة في الأدلة أدناه. هذه إشارات تتطلب تحققًا من المصدر وليست إثباتًا قاطعًا.',
      evidenceIds: riskEvidence.map((item) => item.id),
      caveat: 'اقرأ المصدر الأصلي لكل إشارة؛ قد تكون الادعاءات غير مؤكدة أو متقادمة.',
    };
  }
  if (negative > 0 && positive > 0) {
    return {
      kind: 'MIXED_REPUTATION',
      headline: 'أدلة متضاربة',
      explanation:
        `تحتوي الأدلة غير المكررة على ${positive} إشارة إيجابية و${negative} إشارة سلبية؛ اقرأ المصادر لفهم السياق.`,
      evidenceIds: notable.map((item) => item.id),
      caveat: 'التضارب يعني غالبًا تجارب مختلفة أو فترات زمنية مختلفة — راجع التواريخ.',
    };
  }
  if (negative > 0) {
    return {
      kind: 'MIXED_REPUTATION',
      headline: 'تقارير سلبية — راجع المصادر',
      explanation:
        `توجد ${negative} إشارة سلبية في الأدلة غير المكررة. راجع المصدر وتاريخ كل تقرير قبل الاعتماد عليها.`,
      evidenceIds: nonDuplicate
        .filter((item) => NEGATIVE_CLAIM_TYPES.has(item.claimType) || item.sentiment === 'negative')
        .map((item) => item.id),
      caveat: 'الشكاوى تعكس تجارب أفراد؛ قد لا تمثل الوضع الحالي للتاجر.',
    };
  }
  if (positive > 0) {
    return {
      kind: 'MIXED_REPUTATION',
      headline: 'إشارات إيجابية، ليست ضمانة',
      explanation:
        `توجد ${positive} إشارة إيجابية في الأدلة غير المكررة. الإشارات الإيجابية ليست ضمانًا لجودة التعامل مستقبلًا.`,
      evidenceIds: nonDuplicate
        .filter((item) => POSITIVE_CLAIM_TYPES.has(item.claimType) || item.sentiment === 'positive')
        .map((item) => item.id),
      caveat: null,
    };
  }

  return {
    kind: 'INSUFFICIENT_DATA',
    headline: 'الأدلة غير كافية',
    explanation:
      'الأدلة المتاحة محايدة أو غير حاسمة، ولا تكفي لتكوين صورة عن التعامل مع هذا التاجر.',
    evidenceIds: notable.map((item) => item.id),
    caveat: notable.length > 0 ? 'هناك أدلة إضافية مذكورة أدناه؛ راجعها بنفسك.' : null,
  };
}
