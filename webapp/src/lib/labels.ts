import type { IdentifierKind, MatchedOn } from '@/lib/types';
import type { CoverageLevel, IdentityLevel, ReputationKind } from './assessment';
import type { IdentifierRole } from './identifier-policy';
import type { Locale } from './i18n';

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

export const STATE_LABELS_EN: Record<string, string> = {
  VERIFIED_HIGH_CONFIDENCE: 'Automated analysis: identity supported by multiple sources',
  VERIFIED_MODERATE_CONFIDENCE: 'Automated analysis: identity partially supported',
  MIXED_REPUTATION: 'Conflicting evidence',
  OFFICIAL_WARNING: 'Official warning / notice',
  HIGH_RISK_SIGNALS: 'Signals requiring verification',
  REQUIRES_MANUAL_REVIEW: 'Requires manual review',
  IDENTITY_UNCERTAIN: 'Uncertain identity',
  INSUFFICIENT_DATA: 'Insufficient data',
};

export function stateLabel(state: string, locale: Locale = 'ar'): string {
  if (locale === 'en') {
    return STATE_LABELS_EN[state] ?? state.replace(/_/g, ' ').toLowerCase();
  }
  return STATE_LABELS[state] ?? state;
}

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

export const IDENTIFIER_KIND_LABELS_EN: Record<IdentifierKind, string> = {
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  website: 'Website',
  email: 'Email',
  instagram: 'Instagram',
  address: 'Address',
  commercial_register: 'Commercial Register',
  marketplace: 'Marketplace',
  google_maps: 'Google Maps',
  tiktok: 'TikTok',
};

export function identifierKindLabel(kind: IdentifierKind, locale: Locale = 'ar'): string {
  if (locale === 'en') {
    return IDENTIFIER_KIND_LABELS_EN[kind] ?? kind;
  }
  return IDENTIFIER_KIND_LABELS[kind] ?? kind;
}

const MATCHED_ON_EXTRA_LABELS: Record<string, string> = {
  exact_name: 'تطابق اسم تام',
  exact_alias: 'تطابق اسم بديل',
  normalized_variant: 'صيغة قريبة من الاسم',
  partial_name: 'تطابق جزئي في الاسم',
  typo: 'تشابه تقريبي في الاسم',
  'website-host': 'تطابق نطاق الموقع',
  'marketplace-host': 'تطابق نطاق الماركت بلايس',
};

const MATCHED_ON_EXTRA_LABELS_EN: Record<string, string> = {
  exact_name: 'Exact name match',
  exact_alias: 'Exact alias match',
  normalized_variant: 'Normalized name match',
  partial_name: 'Partial name match',
  typo: 'Approximate name match',
  'website-host': 'Website domain match',
  'marketplace-host': 'Marketplace domain match',
};

export const SENTIMENT_LABELS: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'إيجابي',
  negative: 'سلبي',
  neutral: 'محايد',
};

export const SENTIMENT_LABELS_EN: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
};

export function sentimentLabel(sentiment: string, locale: Locale = 'ar'): string {
  const normalized = sentiment.toLowerCase().trim();
  const key: 'positive' | 'negative' | 'neutral' =
    normalized === 'positive' || normalized === 'pos'
      ? 'positive'
      : normalized === 'negative'
        ? 'negative'
        : 'neutral';
  return locale === 'en' ? SENTIMENT_LABELS_EN[key] : SENTIMENT_LABELS[key];
}

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

export const ROLE_LABELS_EN: Record<IdentifierRole, string> = {
  contact: 'Contact method',
  owned_site: 'Merchant-owned site',
  social_profile: 'Social profile',
  marketplace_profile: 'Marketplace store profile',
  directory_profile: 'Business directory listing',
  location: 'Recorded location',
  registration: 'Official registration',
  external_reference: 'External reference',
};

export function roleLabel(role: IdentifierRole, locale: Locale = 'ar'): string {
  if (locale === 'en') {
    return ROLE_LABELS_EN[role] ?? role;
  }
  return ROLE_LABELS[role] ?? role;
}

export function matchedOnLabel(m: MatchedOn, locale: Locale = 'ar'): string {
  if (locale === 'en') {
    if (m in IDENTIFIER_KIND_LABELS_EN) {
      return IDENTIFIER_KIND_LABELS_EN[m as IdentifierKind];
    }
    return MATCHED_ON_EXTRA_LABELS_EN[m] ?? m.replace(/_/g, ' ');
  }
  if (m in IDENTIFIER_KIND_LABELS) return IDENTIFIER_KIND_LABELS[m as IdentifierKind];
  return MATCHED_ON_EXTRA_LABELS[m] ?? m;
}

/** Automated evidence-strength estimate, shown only inside provenance details. */
export function reliabilityBandLabel(band: string, locale: Locale = 'ar'): string {
  if (locale === 'en') {
    if (band === 'strong') return 'Automated strength estimate: strong';
    if (band === 'very_strong') return 'Automated strength estimate: very strong';
    if (band === 'medium' || band === 'moderate') return 'Automated strength estimate: medium';
    if (band === 'weak') return 'Automated strength estimate: weak';
    return band;
  }
  if (band === 'strong') return 'تقدير قوة آلي: قوية';
  if (band === 'very_strong') return 'تقدير قوة آلي: قوية جدًا';
  if (band === 'medium' || band === 'moderate') return 'تقدير قوة آلي: متوسطة';
  if (band === 'weak') return 'تقدير قوة آلي: ضعيفة';
  return band;
}

export const IDENTITY_LEVEL_LABELS: Record<IdentityLevel, string> = {
  established: 'هوية مؤكدة بعلامات متعددة',
  supported: 'هوية مدعومة بمؤشر',
  uncertain: 'هوية غير مؤكدة',
};

export const IDENTITY_LEVEL_LABELS_EN: Record<IdentityLevel, string> = {
  established: 'Identity confirmed by multiple markers',
  supported: 'Identity supported by indicator',
  uncertain: 'Uncertain identity',
};

export function identityLevelLabel(level: IdentityLevel, locale: Locale = 'ar'): string {
  return locale === 'en' ? IDENTITY_LEVEL_LABELS_EN[level] : IDENTITY_LEVEL_LABELS[level];
}

export const COVERAGE_LEVEL_LABELS: Record<CoverageLevel, string> = {
  none: 'لا توجد أدلة',
  limited: 'تغطية محدودة',
  moderate: 'تغطية متوسطة',
  broad: 'تغطية واسعة',
};

export const COVERAGE_LEVEL_LABELS_EN: Record<CoverageLevel, string> = {
  none: 'No evidence',
  limited: 'Limited coverage',
  moderate: 'Moderate coverage',
  broad: 'Broad coverage',
};

export function coverageLevelLabel(level: CoverageLevel, locale: Locale = 'ar'): string {
  return locale === 'en' ? COVERAGE_LEVEL_LABELS_EN[level] : COVERAGE_LEVEL_LABELS[level];
}

export const REPUTATION_HEADLINE_FALLBACKS: Record<ReputationKind, string> = {
  OFFICIAL_WARNING: 'إشارة رسمية',
  HIGH_RISK_SIGNALS: 'إشارات تتطلب تحققًا',
  MIXED_REPUTATION: 'أدلة متضاربة',
  REQUIRES_MANUAL_REVIEW: 'يحتاج مراجعة يدوية',
  IDENTITY_UNCERTAIN: 'هوية غير مؤكدة — لا استنتاج سمعة',
  INSUFFICIENT_DATA: 'الأدلة غير كافية',
};

export const REPUTATION_HEADLINE_FALLBACKS_EN: Record<ReputationKind, string> = {
  OFFICIAL_WARNING: 'Official warning',
  HIGH_RISK_SIGNALS: 'Signals requiring verification',
  MIXED_REPUTATION: 'Conflicting evidence',
  REQUIRES_MANUAL_REVIEW: 'Requires manual review',
  IDENTITY_UNCERTAIN: 'Uncertain identity — no reputation inference',
  INSUFFICIENT_DATA: 'Insufficient evidence',
};

export function reputationHeadlineFallback(kind: ReputationKind, locale: Locale = 'ar'): string {
  return locale === 'en'
    ? REPUTATION_HEADLINE_FALLBACKS_EN[kind]
    : REPUTATION_HEADLINE_FALLBACKS[kind];
}

/** Comprehensive claim types observed across database and pipeline schemas. */
export const CLAIM_TYPE_LABELS: Readonly<Record<string, { ar: string; en: string }>> = {
  account_page_disappearance: { ar: 'اختفاء صفحة الحساب', en: 'Account / page disappearance' },
  after_sales_support: { ar: 'دعم ما بعد البيع', en: 'After-sales support' },
  communication_issue: { ar: 'مشكلة في التواصل', en: 'Communication issue' },
  company_profile: { ar: 'ملف الشركة والنشاط', en: 'Company profile' },
  complaint_resolved: { ar: 'شكوى تم حلها', en: 'Complaint resolved' },
  complaint_unresolved: { ar: 'شكوى لم تُحل', en: 'Complaint unresolved' },
  contact_information: { ar: 'بيانات الاتصال والتواصل', en: 'Contact information' },
  counterfeit_product_allegation: { ar: 'ادعاء منتج مقلد', en: 'Counterfeit product allegation' },
  customer_service: { ar: 'خدمة العملاء', en: 'Customer service' },
  customer_service_quality: { ar: 'مستوى خدمة العملاء', en: 'Customer service quality' },
  delayed_delivery: { ar: 'تأخر في التسليم', en: 'Delayed delivery' },
  identity_mismatch: { ar: 'عدم تطابق الهوية', en: 'Identity mismatch' },
  long_business_history: { ar: 'تاريخ تجاري طويل', en: 'Established business history' },
  merchant_response: { ar: 'رد التاجر', en: 'Merchant response' },
  official_warning: { ar: 'تحذير رسمي', en: 'Official warning' },
  other: { ar: 'أخرى', en: 'Other' },
  payment_methods: { ar: 'طرق الدفع والسداد', en: 'Payment methods' },
  physical_presence: { ar: 'حضور فعلي', en: 'Physical store / presence' },
  pricing_issue: { ar: 'مشكلة في الأسعار', en: 'Pricing dispute / issue' },
  pricing_transparency: { ar: 'وضوح وشفافية الأسعار', en: 'Pricing transparency' },
  product_availability: { ar: 'توفر المنتجات', en: 'Product availability' },
  product_quality: { ar: 'جودة المنتج', en: 'Product quality' },
  refund_issue: { ar: 'مشكلة استرداد', en: 'Refund issue' },
  refund_issued: { ar: 'تم الاسترداد', en: 'Refund issued' },
  repeated_recommendation: { ar: 'توصيات متكررة', en: 'Repeated recommendations' },
  returns_refunds: { ar: 'سياسة الإرجاع والاسترداد', en: 'Returns & refunds' },
  shipping_delivery: { ar: 'الشحن والتوصيل', en: 'Shipping & delivery' },
  store_identity: { ar: 'هوية المتجر ونشاطه', en: 'Store identity' },
  store_reputation: { ar: 'سمعة المتجر العامة', en: 'Store reputation' },
  successful_purchase: { ar: 'شراء ناجح', en: 'Successful purchase' },
  verified_business_information: { ar: 'معلومات تجارية موثقة', en: 'Verified business info' },
  warranty_coverage: { ar: 'تغطية الضمان', en: 'Warranty coverage' },
  warranty_honored: { ar: 'التزام بالضمان', en: 'Warranty honored' },
  warranty_issue: { ar: 'مشكلة في الضمان', en: 'Warranty issue' },
};

export function claimTypeLabel(raw: string, locale: Locale = 'ar'): string {
  const item = CLAIM_TYPE_LABELS[raw];
  if (item) {
    return locale === 'en' ? item.en : item.ar;
  }
  return raw.replace(/_/g, ' ');
}

export const AUTHOR_TYPE_LABELS: Readonly<Record<string, { ar: string; en: string }>> = {
  customer: { ar: 'عميل', en: 'Customer' },
  journalist: { ar: 'صحفي', en: 'Journalist' },
  merchant: { ar: 'التاجر', en: 'Merchant' },
  registry: { ar: 'سجل رسمي', en: 'Official registry' },
  regulator: { ar: 'جهة تنظيمية', en: 'Regulator' },
  unknown: { ar: 'غير معروف', en: 'Unknown' },
  reviewer: { ar: 'مُراجع مستقل', en: 'Independent reviewer' },
  directory: { ar: 'دليل أعمال', en: 'Business directory' },
  expert: { ar: 'خبير متخصص', en: 'Industry expert' },
};

export function authorTypeLabel(raw: string, locale: Locale = 'ar'): string {
  const item = AUTHOR_TYPE_LABELS[raw];
  if (item) {
    return locale === 'en' ? item.en : item.ar;
  }
  return raw.replace(/_/g, ' ');
}

export const RELATION_LABELS: Readonly<Record<string, { ar: string; en: string }>> = {
  identifier_collision: { ar: 'تطابق في المعرفات', en: 'Identifier match' },
  name_identifier_conflict: { ar: 'تعارض بين الاسم والمعرف', en: 'Name-identifier conflict' },
};

export function relationLabel(raw: string, locale: Locale = 'ar'): string {
  const item = RELATION_LABELS[raw];
  if (item) {
    return locale === 'en' ? item.en : item.ar;
  }
  return raw.replace(/_/g, ' ');
}

export const LINK_CHECK_STATUS_LABELS: Readonly<Record<string, { ar: string; en: string }>> = {
  reachable: { ar: 'يمكن الوصول', en: 'Reachable' },
  redirected: { ar: 'تم التوجيه', en: 'Redirected' },
  not_found: { ar: 'غير موجود', en: 'Not found' },
  access_limited: { ar: 'وصول محدود', en: 'Access limited' },
  server_error: { ar: 'خطأ في الخادم', en: 'Server error' },
  network_error: { ar: 'تعذر الاتصال بالشبكة', en: 'Network error' },
  not_checked: { ar: 'لم يتم التحقق بعد', en: 'Not checked yet' },
};

export function checkStatusLabel(status: string | null | undefined, locale: Locale = 'ar'): string {
  if (!status || status === 'not_checked') {
    return locale === 'en' ? 'Not checked yet' : 'لم يتم التحقق بعد';
  }
  const item = LINK_CHECK_STATUS_LABELS[status];
  if (item) {
    return locale === 'en' ? item.en : item.ar;
  }
  return status;
}

export const SOURCE_TYPE_LABELS: Readonly<Record<string, { ar: string; en: string }>> = {
  customer_review_aggregator: { ar: 'مجمّع تقييمات العملاء', en: 'Customer review aggregator' },
  official_store_website: { ar: 'موقع المتجر الرسمي', en: 'Official store website' },
  technology_publication: { ar: 'منشور تقني', en: 'Technology publication' },
  online_community_forum: { ar: 'منتدى مجتمعي', en: 'Online community forum' },
  business_directory: { ar: 'دليل أعمال', en: 'Business directory' },
  corporate_profile: { ar: 'ملف مؤسسي', en: 'Corporate profile' },
  official_registry: { ar: 'سجل رسمي', en: 'Official registry' },
  merchant_official_page: { ar: 'صفحة التاجر الرسمية', en: 'Official merchant page' },
  merchant_official_website: { ar: 'موقع التاجر الرسمي', en: 'Official merchant website' },
  community_discussion: { ar: 'نقاش مجتمعي', en: 'Community discussion' },
  forum_thread: { ar: 'موضوع منتدى', en: 'Forum thread' },
  official_page: { ar: 'صفحة رسمية', en: 'Official page' },
  contact_page: { ar: 'صفحة تواصل', en: 'Contact page' },
  official_post: { ar: 'منشور رسمي', en: 'Official post' },
  product_page: { ar: 'صفحة منتج', en: 'Product page' },
  social_page: { ar: 'صفحة اجتماعية', en: 'Social page' },
  social_post: { ar: 'منشور على شبكة اجتماعية', en: 'Social post' },
  store_locator: { ar: 'دليل الفروع', en: 'Store locator' },
  official_service_page: { ar: 'صفحة خدمات رسمية', en: 'Official service page' },
  terms_and_payment_policy: { ar: 'شروط وسياسة الدفع', en: 'Terms & payment policy' },
  product_catalog: { ar: 'كتالوج المنتجات', en: 'Product catalog' },
  social_media_video: { ar: 'فيديو شبكات اجتماعية', en: 'Social media video' },
  social_media_post: { ar: 'منشور شبكات اجتماعية', en: 'Social media post' },
  official_store_page: { ar: 'صفحة المتجر الرسمية', en: 'Official store page' },
  service_catalog: { ar: 'كتالوج الخدمات', en: 'Service catalog' },
  directory_listing: { ar: 'قائمة في دليل أعمال', en: 'Directory listing' },
  official_website: { ar: 'الموقع الرسمي', en: 'Official website' },
  official_store_locator: { ar: 'محدد الفروع الرسمي', en: 'Official store locator' },
  merchant_page: { ar: 'صفحة التاجر', en: 'Merchant page' },
  social_post_comments: { ar: 'تعليقات منشور اجتماعي', en: 'Social post comments' },
  forum: { ar: 'منتدى', en: 'Forum' },
  social_group: { ar: 'مجموعة اجتماعية', en: 'Social group' },
  corporate_registry: { ar: 'سجل شركات', en: 'Corporate registry' },
  news_article: { ar: 'مقال إخباري', en: 'News article' },
  official_portal: { ar: 'بوابة رسمية', en: 'Official portal' },
  press_release: { ar: 'بيان صحفي', en: 'Press release' },
  facebook_group_post: { ar: 'منشور مجموعة فيسبوك', en: 'Facebook group post' },
  facebook_post: { ar: 'منشور فيسبوك', en: 'Facebook post' },
  facebook_video: { ar: 'فيديو فيسبوك', en: 'Facebook video' },
  merchant_website: { ar: 'موقع التاجر', en: 'Merchant website' },
  merchant_post: { ar: 'منشور من التاجر', en: 'Merchant post' },
  app_reviews: { ar: 'مراجعات التطبيق', en: 'App reviews' },
  merchant_blog: { ar: 'مدونة التاجر', en: 'Merchant blog' },
  reddit_thread: { ar: 'موضوع ريديت', en: 'Reddit thread' },
};

export function sourceTypeLabel(raw: string, locale: Locale = 'ar'): string {
  const item = SOURCE_TYPE_LABELS[raw];
  if (item) {
    return locale === 'en' ? item.en : item.ar;
  }
  return raw.replace(/_/g, ' ');
}
