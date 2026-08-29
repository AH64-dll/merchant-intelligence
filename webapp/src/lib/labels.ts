import type { IdentifierKind, MatchedOn } from '@/lib/types';
import type { CoverageLevel, IdentityLevel, ReputationKind } from './assessment';
import type { IdentifierRole } from './identifier-policy';

/**
 * Internal pipeline state labels. These are data-lineage captions for the
 * stored analysis state — never user-facing trust judgments (no موثوق/جيد).
 */
export const STATE_LABELS: Record<string, string> = {
  VERIFIED_HIGH_CONFIDENCE: 'تحليل آلي: هوية مدعومة بمصادر متعددة',
  VERIFIED_MODERATE_CONFIDENCE: 'تحليل آلي: هوية مدعومة جزئيًا',
  MIXED_REPUTATION: 'أدلة متضاربة',
  OFFICIAL_WARNING: 'إشارة رسمية',
  HIGH_RISK_SIGNALS: 'إشارات تتطلب تحققًا',
  REQUIRES_MANUAL_REVIEW: 'يحتاج مراجعة يدوية',
  IDENTITY_UNCERTAIN: 'هوية غير مؤكدة',
  INSUFFICIENT_DATA: 'بيانات غير كافية',
};

export const IDENTIFIER_KIND_LABELS: Record<IdentifierKind, string> = {
  phone: 'هاتف',
  whatsapp: 'واتساب',
  facebook: 'فيسبوك',
  website: 'الموقع',
  email: 'بريد',
  instagram: 'إنستغرام',
  address: 'عنوان',
  commercial_register: 'سجل تجاري',
  marketplace: 'ماركت بلايس',
  google_maps: 'خرائط جوجل',
  tiktok: 'تيك توك',
};

const MATCHED_ON_EXTRA_LABELS: Record<string, string> = {
  exact_name: 'تطابق اسم تام',
  exact_alias: 'تطابق اسم بديل',
  normalized_variant: 'صيغة قريبة من الاسم',
  partial_name: 'تطابق جزئي في الاسم',
  typo: 'تشابه تقريبي في الاسم',
  'website-host': 'تطابق نطاق الموقع',
  'marketplace-host': 'تطابق نطاق الماركت بلايس',
};


export const SENTIMENT_LABELS: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'إيجابي',
  negative: 'سلبي',
  neutral: 'محايد',
};

/** Arabic labels for identifier application roles. */
export const ROLE_LABELS: Record<IdentifierRole, string> = {
  contact: 'وسيلة تواصل',
  owned_site: 'موقع تابع للتاجر',
  social_profile: 'حساب اجتماعي',
  marketplace_profile: 'صفحة على منصة بيع',
  directory_profile: 'صفحة في دليل أعمال',
  location: 'موقع',
  registration: 'سجل رسمي',
  external_reference: 'مرجع خارجي',
};

export function matchedOnLabel(m: MatchedOn): string {
  if (m in IDENTIFIER_KIND_LABELS) return IDENTIFIER_KIND_LABELS[m as IdentifierKind];
  return MATCHED_ON_EXTRA_LABELS[m] ?? m;
}

/** Automated evidence-strength estimate, shown only inside provenance details. */
export function reliabilityBandLabel(band: string): string {
  if (band === 'strong') return 'تقدير قوة آلي: قوية';
  if (band === 'very_strong') return 'تقدير قوة آلي: قوية جدًا';
  if (band === 'medium') return 'تقدير قوة آلي: متوسطة';
  if (band === 'weak') return 'تقدير قوة آلي: ضعيفة';
  return band;
}

export const IDENTITY_LEVEL_LABELS: Record<IdentityLevel, string> = {
  established: 'هوية مؤكدة بعلامات متعددة',
  supported: 'هوية مدعومة بمؤشر',
  uncertain: 'هوية غير مؤكدة',
};

export const COVERAGE_LEVEL_LABELS: Record<CoverageLevel, string> = {
  none: 'لا توجد أدلة',
  limited: 'تغطية محدودة',
  moderate: 'تغطية متوسطة',
  broad: 'تغطية واسعة',
};

export const REPUTATION_HEADLINE_FALLBACKS: Record<ReputationKind, string> = {
  OFFICIAL_WARNING: 'إشارة رسمية',
  HIGH_RISK_SIGNALS: 'إشارات تتطلب تحققًا',
  MIXED_REPUTATION: 'أدلة متضاربة',
  REQUIRES_MANUAL_REVIEW: 'يحتاج مراجعة يدوية',
  IDENTITY_UNCERTAIN: 'هوية غير مؤكدة — لا استنتاج سمعة',
  INSUFFICIENT_DATA: 'الأدلة غير كافية',
};
