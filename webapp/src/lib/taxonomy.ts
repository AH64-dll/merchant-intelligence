/**
 * Controlled application taxonomy derived from raw pipeline values.
 *
 * Self-contained by contract: no imports from db/types/search. Every raw
 * label stored in SQLite is preserved by the caller; these functions only
 * project raw strings onto stable application tags/keys and Arabic labels.
 * Raw values are never rewritten and are never identity keys.
 */

// ---------------------------------------------------------------------------
// Category tags
// ---------------------------------------------------------------------------

/**
 * Ordered primary priority. `categoryTags()` returns tags in this order, so
 * `tags[0]` is always the primary tag.
 */
export const CATEGORY_TAG_PRIORITY = [
  'pharmacy_health',
  'automotive',
  'grocery_retail',
  'gaming',
  'mobile_telecom',
  'computers_it',
  'home_appliances',
  'repair_services',
  'security_smart_home',
  'consumer_electronics',
  'marketplace_online',
  'other',
] as const;

export type CategoryTag = (typeof CATEGORY_TAG_PRIORITY)[number];

export const CATEGORY_TAG_LABELS: Record<CategoryTag, { ar: string; en: string }> = {
  pharmacy_health: { ar: 'صيدليات وصحة', en: 'Pharmacy & Health' },
  automotive: { ar: 'سيارات', en: 'Automotive' },
  grocery_retail: { ar: 'بقالة وتجزئة', en: 'Grocery & Retail' },
  gaming: { ar: 'ألعاب', en: 'Gaming' },
  mobile_telecom: { ar: 'موبايل واتصالات', en: 'Mobile & Telecom' },
  computers_it: { ar: 'كمبيوتر وتقنية', en: 'Computers & IT' },
  home_appliances: { ar: 'أجهزة منزلية', en: 'Home Appliances' },
  repair_services: { ar: 'صيانة وخدمات', en: 'Repair & Services' },
  security_smart_home: { ar: 'أمن ومنازل ذكية', en: 'Security & Smart Home' },
  consumer_electronics: { ar: 'إلكترونيات استهلاكية', en: 'Consumer Electronics' },
  marketplace_online: { ar: 'تسوق إلكتروني', en: 'Marketplace & Online' },
  other: { ar: 'أخرى', en: 'Other' },
};

/**
 * Keyword sets per tag. Singular keywords pluralize automatically
 * (`appliance` matches `appliances`); multi-word keywords match contiguous
 * token runs; separators `_ - + , /` are token boundaries, so snake_case and
 * prose forms behave identically.
 */
const CATEGORY_KEYWORDS: Record<CategoryTag, readonly string[]> = {
  pharmacy_health: [
    'pharmacy', 'pharmacist', 'drugstore', 'health', 'healthcare', 'healthtech',
    'telehealth', 'medical', 'صيدلية', 'صيدليات', 'صحة',
  ],
  automotive: [
    'automotive', 'dealership', 'tire', 'car', 'سيارات',
  ],
  grocery_retail: [
    'grocery', 'supermarket', 'hypermarket', 'wholesale', 'delicatessen',
    'gourmet', 'department store', 'سوبر ماركت', 'هايبر', 'بقالة',
  ],
  gaming: [
    'gaming', 'game', 'console', 'playstation', 'xbox', 'esport', 'gpu',
    'graphics card', 'ألعاب',
  ],
  mobile_telecom: [
    'mobile', 'phone', 'smartphone', 'tablet', 'telecom', 'telecommunication',
    'iphone', 'ipad', 'teleshopping', 'موبايل', 'هاتف', 'هواتف', 'اتصالات',
  ],
  computers_it: [
    'computer', 'laptop', 'macbook', 'apple', 'pc', 'workstation', 'hardware',
    'software', 'printer', 'copier', 'monitor', 'networking', 'component',
    'tech', 'technology', 'robotics', 'it', 'كمبيوتر', 'لابتوب',
  ],
  home_appliances: [
    'appliance', 'refrigerator', 'refrigeration', 'freezer', 'washer', 'cooker',
    'air conditioning', 'air conditioner', 'kitchen', 'electrical appliance',
    'lighting', 'heating', 'أجهزة منزلية', 'أجهزة كهربائية',
  ],
  repair_services: [
    'repair', 'maintenance', 'servicing', 'refurbish', 'refurbishing',
    'service center', 'service provider', 'service network', 'installation',
    'صيانة', 'إصلاح',
  ],
  security_smart_home: [
    'security', 'surveillance', 'smart home', 'smart lock', 'automation',
    'access control', 'cctv', 'gate', 'أمن', 'أنظمة أمنية', 'كاميرات مراقبة',
  ],
  consumer_electronics: [
    'electronics', 'electronic', 'camera', 'photography', 'drone', 'gadget',
    'audio', 'إلكترونيات', 'كاميرات',
  ],
  marketplace_online: [
    'marketplace', 'ecommerce', 'e commerce', 'online', 'classifieds',
    'digital products', 'متجر إلكتروني', 'منصة إلكترونية',
  ],
  other: [],
};

// ---------------------------------------------------------------------------
// Shared tokenization / matching
// ---------------------------------------------------------------------------

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[_\-+,/]+/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.replace(/^ل?ال(?=[^\p{L}]|$)|^لل/u, ''))
    .filter((t) => t.length > 0);
}

function tokenEquals(token: string, keyword: string): boolean {
  return token === keyword || token === `${keyword}s` || token === `${keyword}es`;
}

function tokensMatch(tokens: string[], keywordTokens: string[]): boolean {
  if (keywordTokens.length === 0 || keywordTokens.length > tokens.length) return false;
  outer: for (let i = 0; i <= tokens.length - keywordTokens.length; i += 1) {
    for (let j = 0; j < keywordTokens.length; j += 1) {
      if (!tokenEquals(tokens[i + j], keywordTokens[j])) continue outer;
    }
    return true;
  }
  return false;
}

function matchKeywords(tokens: string[], keywords: readonly string[]): boolean {
  return keywords.some((kw) => tokensMatch(tokens, kw.split(' ')));
}

// ---------------------------------------------------------------------------
// Category tagger
// ---------------------------------------------------------------------------

/**
 * Maps a raw merchant category string onto ordered tags. Returns at least one
 * tag; unmapped values become `['other']`. Raw value is preserved by the
 * caller — this never rewrites the stored category.
 */
export function categoryTags(raw: string): CategoryTag[] {
  const tokens = tokenize(raw);
  if (tokens.length === 0) return ['other'];
  const tags = CATEGORY_TAG_PRIORITY.filter((tag) =>
    matchKeywords(tokens, CATEGORY_KEYWORDS[tag]),
  );
  return tags.length > 0 ? tags : ['other'];
}

/** Primary tag is the first tag under the ordered priority. */
export function primaryCategoryTag(raw: string): CategoryTag {
  return categoryTags(raw)[0];
}

// ---------------------------------------------------------------------------
// Governorates
// ---------------------------------------------------------------------------

export const GOVERNORATE_KEYS = [
  'cairo', 'giza', 'alexandria', 'qalyubia', 'sharqia', 'dakahlia', 'gharbia',
  'beheira', 'minya', 'sohag', 'assiut', 'qena', 'beni_suef', 'ismailia',
  'port_said', 'suez', 'damietta',
] as const;

export type Governorate = (typeof GOVERNORATE_KEYS)[number];

export const GOVERNORATE_LABELS: Record<Governorate, { ar: string; en: string }> = {
  cairo: { ar: 'القاهرة', en: 'Cairo' },
  giza: { ar: 'الجيزة', en: 'Giza' },
  alexandria: { ar: 'الإسكندرية', en: 'Alexandria' },
  qalyubia: { ar: 'القليوبية', en: 'Qalyubia' },
  sharqia: { ar: 'الشرقية', en: 'Sharqia' },
  dakahlia: { ar: 'الدقهلية', en: 'Dakahlia' },
  gharbia: { ar: 'الغربية', en: 'Gharbia' },
  beheira: { ar: 'البحيرة', en: 'Beheira' },
  minya: { ar: 'المنيا', en: 'Minya' },
  sohag: { ar: 'سوهاج', en: 'Sohag' },
  assiut: { ar: 'أسيوط', en: 'Assiut' },
  qena: { ar: 'قنا', en: 'Qena' },
  beni_suef: { ar: 'بني سويف', en: 'Beni Suef' },
  ismailia: { ar: 'الإسماعيلية', en: 'Ismailia' },
  port_said: { ar: 'بورسعيد', en: 'Port Said' },
  suez: { ar: 'السويس', en: 'Suez' },
  damietta: { ar: 'دمياط', en: 'Damietta' },
};

const GOVERNORATE_ALIASES: Readonly<Record<string, Governorate>> = {
  cairo: 'cairo',
  giza: 'giza',
  alexandria: 'alexandria',
  qalyubia: 'qalyubia',
  sharqia: 'sharqia',
  dakahlia: 'dakahlia',
  gharbia: 'gharbia',
  beheira: 'beheira',
  minya: 'minya',
  sohag: 'sohag',
  assiut: 'assiut',
  qena: 'qena',
  'beni suef': 'beni_suef',
  ismailia: 'ismailia',
  'port said': 'port_said',
  suez: 'suez',
  damietta: 'damietta',
  'الدقهلية (dakahlia)': 'dakahlia',
  'القاهرة (cairo)': 'cairo',
};

/**
 * Normalizes an observed governorate string to a stable key. Returns `null`
 * for unknown values — callers keep the raw text; nothing is invented.
 */
export function normalizeGovernorate(raw: string): Governorate | null {
  const key = raw.trim().toLowerCase();
  if (key.length === 0) return null;
  const aliased = GOVERNORATE_ALIASES[key];
  if (aliased) return aliased;
  for (const g of GOVERNORATE_KEYS) {
    const { ar, en } = GOVERNORATE_LABELS[g];
    if (key.includes(en.toLowerCase()) || key.includes(ar)) return g;
  }
  return null;
}

export interface CityDisplay {
  /** Verbatim city/address text — never modified, never an identity key. */
  city: string;
  /** Display-only district hints parsed from parenthetical/slash segments. */
  districtHints: string[];
}

/**
 * Splits display-only district hints out of a raw city string.
 * `Giza (Faisal / Haram)` → city `Giza (Faisal / Haram)` verbatim, hints
 * `['Faisal', 'Haram']`. Hints are for display/filtering only and must never
 * be used as a merchant merge/identity key.
 */
export function splitCityDisplay(raw: string): CityDisplay {
  const districtHints: string[] = [];
  const parenthetical = /\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  let withoutParens = raw;
  while ((match = parenthetical.exec(raw)) !== null) {
    withoutParens = withoutParens.replace(match[0], ' ');
    for (const part of match[1].split('/')) {
      const hint = part.trim();
      if (hint.length > 0) districtHints.push(hint);
    }
  }
  if (districtHints.length === 0 && raw.includes('/')) {
    for (const part of raw.split('/')) {
      const hint = part.trim();
      if (hint.length > 0) districtHints.push(hint);
    }
  }
  return { city: raw, districtHints };
}

// ---------------------------------------------------------------------------
// Source category
// ---------------------------------------------------------------------------

export type SourceCategory =
  | 'technical_registry'
  | 'public_authority'
  | 'merchant_owned'
  | 'customer_report'
  | 'news'
  | 'government_registry'
  | 'merchant_site'
  | 'marketplace'
  | 'directory'
  | 'forum_community'
  | 'social'
  | 'other';

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, { ar: string; en: string }> = {
  technical_registry: { ar: 'سجل تقني (whois)', en: 'Technical registry' },
  public_authority: { ar: 'جهة حكومية أو تنظيمية', en: 'Public authority' },
  merchant_owned: { ar: 'محتوى منشور من التاجر', en: 'Merchant-owned' },
  customer_report: { ar: 'تقرير عميل', en: 'Customer report' },
  news: { ar: 'إعلام', en: 'News' },
  government_registry: { ar: 'جهة حكومية أو سجل رسمي', en: 'Government / registry' },
  merchant_site: { ar: 'موقع أو صفحة التاجر', en: 'Merchant site / page' },
  marketplace: { ar: 'ماركت بلايس أو متجر تطبيقات', en: 'Marketplace / app store' },
  directory: { ar: 'دليل أعمال', en: 'Directory' },
  forum_community: { ar: 'منتدى أو مجتمع', en: 'Forum / community' },
  social: { ar: 'شبكات اجتماعية', en: 'Social media' },
  other: { ar: 'أخرى', en: 'Other' },
};

/**
 * Keyword fallback applied to raw `source_type` after author-based rules.
 * Order matters: government/registry, merchant site/page, marketplace,
 * directory, forum/community, social, news — else `other`.
 */
const SOURCE_TYPE_KEYWORDS: ReadonlyArray<readonly [SourceCategory, readonly string[]]> = [
  ['government_registry', [
    'government', 'gov', 'registry', 'regulatory', 'regulator', 'gafi',
    'ministry', 'tax authority',
  ]],
  ['merchant_site', [
    'merchant', 'official website', 'official site', 'official page',
    'official store', 'official portal', 'official profile', 'official post',
    'official blog', 'official channel', 'official locator',
    'official locations', 'official brand', 'official corporate',
    'official api', 'official service', 'official program',
    'official announcement', 'official terms', 'official policy',
    'official contact', 'official business', 'corporate', 'own domain',
    'product page', 'about page', 'contact page', 'business page',
    'company portal', 'company profile', 'store locator', 'storefront',
    'catalog',
  ]],
  ['marketplace', [
    'marketplace', 'ecommerce', 'e commerce', 'app store', 'app listing',
    'app reviews', 'play store',
  ]],
  ['directory', ['directory']],
  ['forum_community', ['forum', 'reddit', 'community', 'thread']],
  ['social', ['social', 'facebook', 'instagram', 'tiktok', 'youtube', 'twitter', 'video']],
  ['news', ['news', 'press', 'journalistic', 'journalism', 'journal', 'investigative', 'publication', 'outlet', 'article']],
];

function sourceTypeCategory(sourceType: string): SourceCategory {
  const tokens = tokenize(sourceType);
  for (const [category, keywords] of SOURCE_TYPE_KEYWORDS) {
    if (matchKeywords(tokens, keywords)) return category;
  }
  return 'other';
}

export interface SourceCategoryInput {
  url: string;
  sourceType: string;
  authorType: string;
}

/**
 * Derives the application source category with the exact precedence:
 * `whois://` URL → technical registry; author regulator/registry → public
 * authority; merchant → merchant-owned; customer → customer report;
 * journalist → news; then raw `source_type` keywords in the ordered list
 * above; otherwise `other`. The raw `source_type` is always preserved by the
 * caller — this derivation never replaces it.
 */
export function deriveSourceCategory(input: SourceCategoryInput): SourceCategory {
  if (input.url.trim().toLowerCase().startsWith('whois://')) return 'technical_registry';
  switch (input.authorType) {
    case 'regulator':
    case 'registry':
      return 'public_authority';
    case 'merchant':
      return 'merchant_owned';
    case 'customer':
      return 'customer_report';
    case 'journalist':
      return 'news';
    default:
      break;
  }
  return sourceTypeCategory(input.sourceType);
}

// ---------------------------------------------------------------------------
// Author types, claim types, relations
// ---------------------------------------------------------------------------

export type AuthorType = 'customer' | 'journalist' | 'merchant' | 'registry' | 'regulator' | 'unknown';

export const AUTHOR_TYPE_LABELS: Record<AuthorType, string> = {
  customer: 'عميل',
  journalist: 'صحفي',
  merchant: 'التاجر',
  registry: 'سجل رسمي',
  regulator: 'جهة تنظيمية',
  unknown: 'غير معروف',
};

/** Arabic labels for all 22 claim types observed in the master DB. Unknown raw keys fall back to the raw key via `CLAIM_TYPE_LABELS[raw] ?? raw`. */
export const CLAIM_TYPE_LABELS: Readonly<Record<string, string>> = {
  account_page_disappearance: 'اختفاء صفحة الحساب',
  after_sales_support: 'دعم ما بعد البيع',
  communication_issue: 'مشكلة في التواصل',
  complaint_resolved: 'شكوى تم حلها',
  complaint_unresolved: 'شكوى لم تُحل',
  counterfeit_product_allegation: 'ادعاء منتج مقلد',
  delayed_delivery: 'تأخر في التسليم',
  identity_mismatch: 'عدم تطابق الهوية',
  long_business_history: 'تاريخ تجاري طويل',
  merchant_response: 'رد التاجر',
  official_warning: 'تحذير رسمي',
  other: 'أخرى',
  physical_presence: 'حضور فعلي',
  pricing_issue: 'مشكلة في الأسعار',
  product_quality: 'جودة المنتج',
  refund_issue: 'مشكلة استرداد',
  refund_issued: 'تم الاسترداد',
  repeated_recommendation: 'توصيات متكررة',
  successful_purchase: 'شراء ناجح',
  verified_business_information: 'معلومات تجارية موثقة',
  warranty_honored: 'التزام بالضمان',
  warranty_issue: 'مشكلة في الضمان',
};

/** Fallback label for unknown author types: `AUTHOR_TYPE_LABELS[raw] ?? raw`. */
export function authorTypeLabel(raw: string): string {
  return (AUTHOR_TYPE_LABELS as Readonly<Record<string, string>>)[raw] ?? raw;
}

export type MerchantRelation = 'identifier_collision' | 'name_identifier_conflict';

export const RELATION_LABELS: Record<MerchantRelation, string> = {
  identifier_collision: 'تطابق في المعرفات',
  name_identifier_conflict: 'تعارض بين الاسم والمعرف',
};

/** Fallback label for unknown claim types: `CLAIM_TYPE_LABELS[raw] ?? raw`. */
export function claimTypeLabel(raw: string): string {
  return CLAIM_TYPE_LABELS[raw] ?? raw;
}

/** Fallback label for unknown relation values: `RELATION_LABELS[raw] ?? raw`. */
export function relationLabel(raw: string): string {
  return (RELATION_LABELS as Readonly<Record<string, string>>)[raw] ?? raw;
}
