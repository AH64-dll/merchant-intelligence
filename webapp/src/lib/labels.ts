import type { IdentifierKind, MatchedOn, MerchantState } from '@/lib/types';

export const STATE_LABELS: Record<MerchantState, string> = {
  VERIFIED_HIGH_CONFIDENCE: 'موثوق — ثقة عالية',
  VERIFIED_MODERATE_CONFIDENCE: 'جيد — ثقة متوسطة',
  MIXED_REPUTATION: 'سمعة متضاربة',
  OFFICIAL_WARNING: 'تحذير رسمي',
  HIGH_RISK_SIGNALS: 'إشارات خطورة عالية',
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
  name_exact: 'تطابق اسم تام',
  alias_exact: 'تطابق اسم بديل',
  name_fuzzy: 'تشابه في الاسم',
  'website-host': 'تطابق نطاق الموقع',
  'marketplace-host': 'تطابق نطاق الماركت بلايس',
};

export function reliabilityBandLabel(band: string): string {
  if (band === 'strong') return 'قوية';
  if (band === 'very_strong') return 'قوية جدًا';
  return band;
}

export function matchedOnLabel(m: MatchedOn): string {
  if (m in IDENTIFIER_KIND_LABELS) return IDENTIFIER_KIND_LABELS[m as IdentifierKind];
  return MATCHED_ON_EXTRA_LABELS[m] ?? m;
}
