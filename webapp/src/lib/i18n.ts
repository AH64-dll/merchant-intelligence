/**
 * Locale types, the translation tables and path-based locale helpers.
 *
 * The site is a static export: locale is encoded in the URL (`/ar/…`, `/en/…`),
 * never in cookies. This module is deliberately free of `next/headers` so that
 * client components (error boundaries, the language switcher) can import it.
 */
export type Locale = 'ar' | 'en';

export const LOCALES: readonly Locale[] = ['ar', 'en'];

export const DEFAULT_LOCALE: Locale = 'ar';

export const DIR_FOR: Record<Locale, 'rtl' | 'ltr'> = { ar: 'rtl', en: 'ltr' };

export function isLocale(value: unknown): value is Locale {
  return value === 'ar' || value === 'en';
}

/**
 * Reads the locale out of a path like `/en/merchants` or `/ar`. Works on
 * `location.pathname` in client code (error boundaries, the switcher) and on
 * any string in tests. Returns `DEFAULT_LOCALE` when no locale segment exists.
 */
export function localeFromPathname(pathname: string): Locale {
  const segment = pathname.split('/')[1];
  return isLocale(segment) ? segment : DEFAULT_LOCALE;
}

/**
 * Re-targets a pathname to another locale: `/en/search?q=1` → `/ar/search?q=1`.
 * A path with no locale segment gets one prepended. `search`/`hash` strings are
 * passed through separately by callers that have them.
 */
export function switchLocalePath(pathname: string, locale: Locale): string {
  const segment = pathname.split('/')[1];
  if (isLocale(segment)) {
    return `/${locale}${pathname.slice(segment.length + 1)}` || `/${locale}`;
  }
  return `/${locale}${pathname === '/' ? '' : pathname}`;
}

/** Canonical (Arabic) table: its keys ARE the translation key set. */
const AR_UI_STRINGS = {
  siteName: 'دليل التجار',
  tagline: 'بحث عن هوية التجار وأدلتهم',
  brandDescription: 'للبحث في البائعين',
  brandLatin: 'DALEEL EL-TOGAR',
  independent: 'منصة بحث مستقلة',
  menu: 'فتح القائمة',
  close: 'إغلاق',
  skip: 'انتقل إلى المحتوى',
  sidebarTitle: 'الأدلة أولًا، دائمًا.',
  sidebarText: 'لا نجوم، لا درجات ثقة. فقط معلومات تساعدك على تكوين صورة أوضح.',
  workspace: 'مساحة البحث',
  resources: 'عن المنصة',
  footerTagline: 'دليل التجار — للبحث، لا للترويج.',
  footerNote: 'المعلومة في سياقها. والقرار لك.',
  noEndorsement: 'الأدلة ليست توصية.',
  noEndorsementText:
    'وجود معلومات عن بائع لا يعني ضمانه، وغياب الأدلة لا يعني غياب المخاطر. نعرض ما نعرفه، ونوضّح ما لا نعرفه.',
  readPrinciples: 'تعرّف على مبادئنا',
  searchTipsTitle: 'نصائح لبحث أكثر دقة',
  copyLink: 'نسخ رابط التقرير',
  linkCopied: 'تم نسخ الرابط',
  copyFailed: 'تعذّر النسخ؛ يمكنك نسخ الرابط من شريط العنوان.',
  skipToContent: 'تخطَّ إلى المحتوى الرئيسي',
  searchPlaceholder: 'ابحث باسم التاجر أو الهاتف أو الرابط…',
  search: 'بحث',
  directory: 'دليل التجار',
  positiveEvidence: 'أدلة إيجابية',
  home: 'الرئيسية',
  language: 'English',
  switchTo: 'en',
  sourcesSection: 'المصادر',
  evidenceSection: 'الأدلة',
  claimsSection: 'الادّعاءات',
  identitySection: 'الهوية',
  briefSection: 'ملخص التاجر',
  unknownVendor: 'تاجر غير معروف',
  loading: 'جارٍ تحميل بيانات التاجر…',
  notFound: 'لم يتم العثور على التاجر',
  page: 'صفحة',
  results: 'نتائج',
  poweredBy: 'النتائج مبنية على بحث آلي في مصادر عامة وقد تكون قديمة أو غير مكتملة',

  // Navigation & Header
  mainNav: 'التنقل الرئيسي',
  allMerchants: 'جميع البائعين',
  positiveEvidenceNav: 'البائعون ذوو أقوى الأدلة الإيجابية',
  switchLanguage: 'English',
  switchLanguageAria: 'التحويل إلى اللغة الإنجليزية',

  // Footer & Freshness
  footerDisclaimer:
    'النتائج مبنية على بحث آلي في مصادر عامة، وقد تكون قديمة أو غير مكتملة، وهي ليست ضمانًا ولا حكمًا نهائيًا على أي تاجر — راجع المصادر الأصلية بنفسك.',
  snapshotGeneratedAt: 'لقطة البيانات وُلِّدت في:',
  staleSnapshotWarning: ' — لقطة أقدم من أسبوع؛ قد تكون البيانات قديمة، حدِّث اللقطة.',
  privacy: 'سياسة الخصوصية والإعلانات',
  placeholderSummary:
    'لم يُسجَّل ملخص لهذا المصدر — محفوظ للتوثيق ومحتسب كسجل غير مستقل.',

  // Home Page
  homeTitle: 'دليل التجار',
  homeSubtitle:
    'ابحث عن هوية تاجر والأدلة العامة المرتبطة به — بالاسم، أو برقم هاتف مصري، أو برابط صفحته أو حسابه.',
  homeDisclaimer:
    'تلخّص النتائج أدلة من مصادر عامة فقط، وقد تكون قديمة أو ناقصة، وهي ليست ضمانًا ولا حكمًا نهائيًا على أي تاجر.',
  directoriesAria: 'الدلائل',
  allMerchantsDirectoryTitle: 'جميع البائعين',
  allMerchantsDirectoryBody:
    'استعرض كل البائعين الأساسيين مرتَّبين أبجديًا، مع مرشحات التصنيف والمحافظة وتغطية الأدلة.',
  positiveEvidenceDirectoryTitle: 'البائعون ذوو أقوى الأدلة الإيجابية',
  positiveEvidenceDirectoryBody:
    'قائمة مرتَّبة حسب قوة وتنوع الأدلة الإيجابية المنشورة — ليست ضمانًا لجودة البائع أو نتيجة الشراء.',
  exampleVendorName: 'اسم تاجر',
  exampleVendorSample: 'بي تك',
  examplePhone: 'رقم هاتف مصري',
  examplePhoneSample: '+201000000000',
  exampleLink: 'رابط صفحة',
  exampleLinkSample: 'https://facebook.com/PageName',

  // Search Box
  searchLabel: 'ابحث عن تاجر',
  searchHint: 'رقم هاتف مصري، أو اسم تاجر، أو رابط صفحة/حساب.',
  searchButton: 'بحث',

  // Merchants Directories
  allMerchantsPageTitle: 'جميع البائعين — دليل التجار',
  allMerchantsTitle: 'جميع البائعين',
  allMerchantsIntro:
    'قائمة بجميع البائعين الأساسيين في اللقطة الحالية، مرتَّبة أبجديًا باسم البائع الثابت. كل صف يمثل بائعًا واحدًا؛ صفحة البائع تحتفظ بكل المواقع المسجَّلة والأسماء البديلة والأدلة الكاملة.',
  positiveEvidencePageTitle: 'البائعون ذوو أقوى الأدلة الإيجابية — دليل التجار',
  positiveEvidenceTitle: 'البائعون ذوو أقوى الأدلة الإيجابية',
  positiveEvidenceIntro1:
    'ترتيب حسب قوة وتنوع الأدلة الإيجابية المنشورة؛ لا يمثل ضمانًا لجودة البائع أو نتيجة الشراء.',
  positiveEvidenceIntro2:
    'تشمل القائمة فقط البائعين الذين استوفوا كل شروط الأهلية: هوية مؤكدة، ومصدران مستقلان مختلفان على الأقل يؤيدان اتجاهًا إيجابيًا، ولا دليل سلبي مستقل من مؤلف غير التاجر، ولا إشارات تحذير رسمية أو مخاطر موثقة. تُحتسب الأدلة المكررة مرة واحدة وتُستثنى من العدّ المستقل، ولا يُحتسب إعلان التاجر عن نفسه ضمن ملاحظات العملاء.',
  merchantsListLabel: 'قائمة البائعين',
  positiveListLabel: 'قائمة البائعين ذوي الأدلة الإيجابية',
  noMatchingVendors: 'لا يوجد بائعون يطابقون هذه التصفية.',
  relaxFiltersPromptAll:
    'جرّب تخفيف المرشحات — كل التصنيفات وكل المحافظات وكل المستويات — أو استعرض جميع البائعين من دون تصفية.',
  browseAllWithoutFilter: 'جميع البائعين',
  relaxFiltersPromptPositive:
    'قد تكون المرشحات ضيقة على هذه القائمة. جرّب تخفيف المرشحات، أو استعرض القائمة كاملة من دون تصفية.',
  browseFullListWithoutFilter: 'القائمة كاملة',

  // Loading States
  loadingMerchantsList: 'جارٍ تحميل قائمة البائعين…',
  loadingMerchantsSkeletonDesc:
    'تُعرض 20 بائعًا في الصفحة، مع مرشحات التصنيف والمحافظة وتغطية الأدلة، من لقطة البيانات الحالية.',
  loadingPositiveList: 'جارٍ تحميل القائمة…',
  loadingMerchantData: 'جارٍ تحميل بيانات التاجر…',
  loadingMerchantDetailsDesc: 'يتم الآن جمع الأدلة والمعرفات المرتبطة بهذا التاجر.',

  // Not Found & Error
  pageNotFound: 'الصفحة غير موجودة.',
  pageNotFoundDesc: 'قد يكون التاجر المطلوب غير موجود في اللقطة الحالية، أو أن الرابط غير صحيح.',
  backToSearch: 'العودة إلى البحث',
  errorTitle: 'حدث خطأ غير متوقع.',
  errorDesc: 'لم نتمكن من عرض هذه الصفحة. يمكنك إعادة المحاولة أو العودة إلى البحث.',
  retry: 'إعادة المحاولة',

  // Directory Filter Bar & Pagination
  filterListAria: 'تصفية القائمة',
  categoryFilter: 'التصنيف',
  allCategories: 'كل التصنيفات',
  governorateFilter: 'المحافظة',
  allGovernorates: 'كل المحافظات',
  coverageFilter: 'تغطية الأدلة',
  allCoverageLevels: 'كل المستويات',
  applyFilter: 'تطبيق التصفية',
  resetFilter: 'إلغاء التصفية',
  totalMatchingVendors: 'إجمالي البائعين المطابقين:',
  vendorsPerPage: 'بائعًا في الصفحة.',
  pageOutOfRange: 'الصفحة المطلوبة خارج المدى.',
  matchingVendorsDistributed: 'موزعين على',
  pagesWord: 'صفحات.',
  goToLastPage: 'الانتقال إلى الصفحة الأخيرة',
  previous: 'السابق',
  next: 'التالي',
  pageOf: 'من',
  paginationAria: 'تصفح النتائج',

  // Merchant Summary Card & Shared Elements
  categoryLabel: 'التصنيف: ',
  unspecifiedCategory: 'تصنيف غير محدد',
  locationLabel: 'الموقع: ',
  multipleRecordedLocations: 'عدة مواقع مسجَّلة — {count} سجل موقع موثَّق (وليست تعدادًا مؤكدًا للفروع).',
  identityLabel: 'الهوية: ',
  evidenceCoverageLabel: 'تغطية الأدلة: ',
  evidenceSummaryTally: 'الأدلة: {total} إجمالًا، منها {nonDuplicate} غير مكررة من {distinctSources} مصادر مختلفة.',
  fromNonDuplicateEvidence: '(من الأدلة غير المكررة).',
  latestPublished: 'أحدث نشر موثَّق: ',
  latestCapture: 'آخر التقاط للأدلة: ',
  undated: 'غير مؤرَّخ',
  unknownDate: 'غير معروف',

  // Positive Evidence Card
  highlightedPositiveEvidence: 'أبرز دليل إيجابي موثق',
  positiveNotesFromCustomers: 'ملاحظات إيجابية موثَّقة من عملاء في مصادر مستقلة: ',
  independentSourcesCountLabel: 'المصادر المستقلة للأدلة المنشورة: ',
  sourceCategoryLabelPrefix: 'فئة المصدر: ',
  publishedDatePrefix: 'نُشر: ',
  fullEvidenceOnMerchantPage: 'الدليل كاملًا في صفحة البائع',
  openOriginalSource: 'فتح المصدر الأصلي',

  // Evidence Card & Technical Details
  evidenceDirection: 'اتجاه الدليل: ',
  platformLabel: 'المنصة: ',
  evidenceAuthor: 'مصدر الدليل: ',
  capturedDatePrefix: 'التقط: ',
  oldEvidenceWarning: ' (تاريخ قديم — تجاوز سنتين)',
  sourceTextOnly: 'المصدر (نص فقط): ',
  sourceVendorPage: 'صفحة التاجر — المنشور المحدد غير متاح للربط',
  sourceUnreachable: 'المنشور الأصلي لم يعد متاحًا',
  sourceNotePrefix: 'ملاحظة المصدر: ',
  sourceDetailsSummary: 'تفاصيل المصدر والتوثيق',
  rawSourceType: 'نوع المصدر الخام: ',
  includedInVerification: 'دُرِج في جولة تحقق آلية',
  notIncludedInVerification: 'لم يُدرَج في جولة تحقق آلية',
  duplicateRootNotice: 'مكرر — الجذر الأصلي: {root}',
  notDuplicateNotice: 'ليس مكررًا (يُحتسب كدليل مستقل داخل القائمة)',
  crossMerchantDuplicateNotice: 'جذر هذا الدليل المكرر مسجَّل على تاجر آخر — راجع الإسناد قبل الاعتماد عليه.',
  technicalDatesPublished: 'التواريخ التقنية — نشر: ',
  technicalDatesCaptured: ' · التقاط: ',

  // Merchant Detail Page
  vendorNotFound: 'تاجر غير موجود',
  potentialDistricts: 'أحياء محتملة: ',
  categoriesPrefix: 'تصنيفات: ',
  registeredAliases: 'أسماء بديلة مسجلة: ',
  importantObservations: 'ملاحظات مهمة من التعامل',
  importantObservationsDesc:
    'ملاحظات وادعاءات رئيسية مستندة إلى أدلة موثقة في السجل، مرتبة حسب الأهمية وحداثة التجارب.',
  whatIsStillUnknown: 'ما لا يزال غير معلوم',
  allEvidenceAndSources: 'جميع الأدلة والمصادر',
  allEvidenceDesc: 'سجلات الأدلة الأصلية المستقلة المرصودة لهذا المتجر مع مصادرها المباشرة.',
  availableSourceCategories: 'فئات المصادر المتوفرة:',
  duplicateRecordsExcluded: 'سجلات مكررة مستبعدة من الاحتساب المستقل ({count})',
  duplicateRecordsDesc:
    'هذه السجلات تطابق أدلة أصلية مسجلة أعلاه، وتُحفظ للتوثيق المرجعي دون تكرار احتسابها كتجارب منفصلة.',
  sourceOnlyRecords: 'مصادر محفوظة بلا سياق نصي ({count})',
  sourceOnlyDesc:
    'مصادر رُصدت في السجل دون أن تشتمل على ملخص أو اقتباس نصي مباشر، وتُحفظ للتوثيق المرجعي دون احتسابها كحقائق مستقلة.',
  registeredStoreData: 'بيانات المتجر المسجلة',
  storeDataDisclaimer: 'هذه بيانات ومعرفات مسجلة في اللقطة وليست فروعًا مؤكدة أو إقرارًا بملكيتها.',
  availableOfficialLinks: 'الروابط الرسمية المتاحة',
  identifiersAndContacts: 'المعرفات ووسائل التواصل',
  locationAndAddressRecords: 'سجلات المواقع والعناوين',
  registeredCity: 'المدينة المسجلة: ',
  multipleRecordedLocationsNotice: 'توجد عدة مواقع مسجلة: {count} سجلات عناوين مختلفة في اللقطة.',
  locationsNoticeCaveat: 'تنبيه: سجلات العناوين المذكورة هي مواقع وردت في بيانات الرصد وليست فروعًا تجارية محسومة.',
  possiblyRelatedProfiles: 'ملفات قد تكون مرتبطة',
  relatedProfilesDesc:
    'هذه العلاقات مشتقة من تطابقات آلية للمعرفات (قد يكون مرتبطًا) وليست إثباتًا لملكية مشتركة أو إدارة واحدة.',
  freshnessAndMethod: 'الحداثة والمنهجية',
  sourceLinkVerificationStatus: 'حالة التحقق من روابط المصادر:',
  directSourcesNotice: 'تتيح الروابط المنشورة للقارئ الاطلاع المباشر على المادة الأصلية والتحقق منها بنفسه.',
  caveatLimitedCoverage:
    'تغطية الأدلة محدودة: المعلومات المتوفرة تعتمد على عدد قليل من المصادر، ولا تكفي لتكوين صورة شاملة ومؤكدة عن المتجر.',
  caveatStaleData:
    'حداثة البيانات: أحدث دليل منشور يعود إلى تاريخ {date} (أقدم من سنتين)، وقد لا يعكس الوضع الحالي للتعامل مع المتجر.',
  caveatSourceOnly:
    'مصادر محفوظة بلا سياق نصي: يتضمن السجل {count} مصدرًا محفوظًا دون ملخص أو نص مقتبس، وتُحفظ للتوثيق فقط دون احتسابها كحقائق مستقلة.',

  // Claim Cards
  linkedEvidence: 'الأدلة المرتبطة: ',
  evidenceAnchor: 'دليل {n}',
  claimKind: 'النوع',
  claimSentiment: 'التوجه',
  claimSourceCategory: 'فئة المصدر',
  claimLatestDate: 'أحدث تاريخ مسجل',
  claimSummary: 'الملخص',
  nonDuplicateSources: 'مصادر غير مكررة',
  totalObservations: 'إجمالي الملاحظات',

  // Sentiment Bar
  evidenceSentimentHeading: 'اتجاه الأدلة',
  sentimentDuplicateTally: 'تُحتسب الأعداد أعلاه من الأدلة غير المكررة فقط — استُثني {count} دليل مكرر.',
  sentimentZeroDuplicateTally: 'تُحتسب الأعداد أعلاه من الأدلة غير المكررة فقط — ولا توجد أدلة مكررة مستثناة.',

  // Cited Brief
  currentPictureHeading: 'الصورة الحالية',
  identityQuestion: 'ما الذي نعرفه عن هوية المتجر؟',
  reputationQuestion: 'ما الذي تقوله المصادر عن التعامل؟',
  warningPrefix: 'تنبيه: ',
  briefGeneratedAt: 'تاريخ إعداد الملخص: ',

  // Analysis Section
  noAnalysisYet: 'لا يوجد تحليل كافٍ لهذا التاجر بعد.',
  automatedAnalysisNotice:
    'ما يلي مخرجات تحليل آلي لقائمة الأدلة، وليست حكمًا نهائيًا — راجع الأدلة والمصادر بنفسك.',
  signalsRequiringVerification: 'إشارات تتطلب تحققًا',
  positiveSignals: 'إشارات إيجابية',
  contradictions: 'تناقضات',
  missingInformation: 'معلومات ناقصة',
  verifiedClaims: 'ادعاءات موثقة بأدلة',
  unverifiedClaims: 'ادعاءات بحاجة لتحقق',
  evidenceSummaryHeading: 'ملخص الأدلة والتحليل',
  reputationNotesHeading: 'ملاحظات السمعة والانطباع العام',
  briefIdentityHeading: 'الهوية',
  briefReputationHeading: 'السمعة والتعامل',
  briefRiskHeading: 'إشارات تتطلب تدقيقًا',
  fraudRiskNotesHeading: 'ملاحظات مخاطر الاحتيال والنزاهة',
  consumerSatisfactionNotesHeading: 'ملاحظات رضا العملاء وتجربة الشراء',

  // Source Citations
  noWebLinkAvailable: 'لا يتوفر رابط ويب قابل للفتح في السجل',
  lastVerifiedPrefix: '(آخر تحقق: {status})',
  sourceMetadata: 'بيانات المصدر',
  accessKindPrefix: 'نوع الوصول: ',
  notePrefix: 'ملاحظة: ',
  locatorPrefix: 'المحدد: ',

  // Merchant Evidence Overview
  severalRecordedLocations: 'توجد عدة مواقع مسجلة',
  distinctAddressRecords: 'سجلات عناوين مختلفة',
  totalEvidence: 'إجمالي الأدلة',
  nonDuplicateEvidence: 'أدلة غير مكررة',
  distinctNonDuplicateSources: 'مصادر مختلفة غير مكررة',
  latestKnownPublication: 'أحدث نشر معروف',
  latestCaptureLabel: 'آخر التقاط',
  snapshotGeneratedDateLabel: 'تاريخ توليد اللقطة',
} as const;

export type UiKey = keyof typeof AR_UI_STRINGS;

export type UiStrings = Record<UiKey, string>;

/** English table covering every key in the canonical table. */
const EN_UI_STRINGS: UiStrings = {
  siteName: 'Daleel El-Togar',
  tagline: 'Vendor identity and evidence lookup',
  brandDescription: 'Vendor research',
  brandLatin: 'دليل التجار',
  independent: 'Independent research platform',
  menu: 'Open menu',
  close: 'Close',
  skip: 'Skip to content',
  sidebarTitle: 'Evidence first. Always.',
  sidebarText: 'No stars. No trust scores. Just information for a clearer picture.',
  workspace: 'RESEARCH',
  resources: 'THE PLATFORM',
  footerTagline: 'Daleel El-Togar — research, not promotion.',
  footerNote: 'Information in context. The decision is yours.',
  noEndorsement: 'Evidence is not an endorsement.',
  noEndorsementText:
    'Information about a vendor is not a guarantee. An absence of evidence is not an absence of risk. We show what is known — and what isn’t.',
  readPrinciples: 'Read our principles',
  searchTipsTitle: 'Tips for a more precise search',
  copyLink: 'Copy report link',
  linkCopied: 'Report link copied',
  copyFailed: 'Copy failed; you can copy the link from the address bar.',
  skipToContent: 'Skip to main content',
  searchPlaceholder: 'Search by vendor name, phone, or link…',
  search: 'Search',
  directory: 'Vendor Directory',
  positiveEvidence: 'Positive Evidence',
  home: 'Home',
  language: 'العربية',
  switchTo: 'ar',
  sourcesSection: 'Sources',
  evidenceSection: 'Evidence',
  claimsSection: 'Claims',
  identitySection: 'Identity',
  briefSection: 'Vendor Brief',
  unknownVendor: 'Unknown Vendor',
  loading: 'Loading vendor data…',
  notFound: 'Vendor not found',
  page: 'Page',
  results: 'results',
  poweredBy: 'Results are generated from automated public-source research and may be outdated or incomplete',

  // Navigation & Header
  mainNav: 'Main navigation',
  allMerchants: 'All Vendors',
  positiveEvidenceNav: 'Vendors with Strongest Positive Evidence',
  switchLanguage: 'العربية',
  switchLanguageAria: 'Switch to Arabic',

  // Footer & Freshness
  footerDisclaimer:
    'Results are based on automated research across public sources and may be outdated or incomplete. They are neither a guarantee nor a final verdict on any vendor — verify original sources yourself.',
  snapshotGeneratedAt: 'Data snapshot generated on:',
  staleSnapshotWarning: ' — snapshot older than a week; data may be outdated, please refresh the snapshot.',
  privacy: 'Privacy & Ads Policy',

  placeholderSummary:
    'No summary was recorded for this source — kept for provenance and counted as a non-independent record.',
  // Home Page
  homeTitle: 'Daleel El-Togar',
  homeSubtitle:
    'Search for vendor identity and associated public evidence — by name, Egyptian phone number, or page/account link.',
  homeDisclaimer:
    'Results summarize evidence from public sources only and may be outdated or incomplete. They are neither a guarantee nor a final verdict on any vendor.',
  directoriesAria: 'Directories',
  allMerchantsDirectoryTitle: 'All Vendors',
  allMerchantsDirectoryBody:
    'Browse all primary vendors alphabetically, with filters for category, governorate, and evidence coverage.',
  positiveEvidenceDirectoryTitle: 'Vendors with Strongest Positive Evidence',
  positiveEvidenceDirectoryBody:
    'A list ranked by the strength and diversity of published positive evidence — not a guarantee of vendor quality or purchase outcome.',
  exampleVendorName: 'Vendor name',
  exampleVendorSample: 'B.TECH',
  examplePhone: 'Egyptian phone',
  examplePhoneSample: '+201000000000',
  exampleLink: 'Page link',
  exampleLinkSample: 'https://facebook.com/PageName',

  // Search Box
  searchLabel: 'Search for a vendor',
  searchHint: 'Egyptian phone number, vendor name, or page/account link.',
  searchButton: 'Search',

  // Merchants Directories
  allMerchantsPageTitle: 'All Vendors — Daleel El-Togar',
  allMerchantsTitle: 'All Vendors',
  allMerchantsIntro:
    'List of all primary vendors in the current snapshot, sorted alphabetically by canonical name. Each card represents one vendor; the vendor page preserves all recorded locations, aliases, and full evidence.',
  positiveEvidencePageTitle: 'Vendors with Strongest Positive Evidence — Daleel El-Togar',
  positiveEvidenceTitle: 'Vendors with Strongest Positive Evidence',
  positiveEvidenceIntro1:
    'Ranked by the strength and diversity of published positive evidence; does not represent a guarantee of vendor quality or purchase outcome.',
  positiveEvidenceIntro2:
    'Includes only vendors meeting all eligibility criteria: established identity, at least two distinct independent sources supporting positive sentiment, no independent negative evidence from non-merchant authors, and no official warnings or documented risk signals. Duplicate evidence is counted once and excluded from independent tally; self-promotional merchant posts are not counted as customer feedback.',
  merchantsListLabel: 'Vendor list',
  positiveListLabel: 'List of vendors with positive evidence',
  noMatchingVendors: 'No vendors match this filter.',
  relaxFiltersPromptAll:
    'Try relaxing filters — all categories, governorates, and levels — or browse all vendors without filtering.',
  browseAllWithoutFilter: 'all vendors',
  relaxFiltersPromptPositive:
    'Filters may be too restrictive for this list. Try relaxing filters, or browse the full list without filtering.',
  browseFullListWithoutFilter: 'the full list',

  // Loading States
  loadingMerchantsList: 'Loading vendor list…',
  loadingMerchantsSkeletonDesc:
    'Displays 20 vendors per page, with category, governorate, and evidence coverage filters, from the current data snapshot.',
  loadingPositiveList: 'Loading list…',
  loadingMerchantData: 'Loading vendor data…',
  loadingMerchantDetailsDesc: 'Gathering evidence and identifiers associated with this vendor.',

  // Not Found & Error
  pageNotFound: 'Page not found.',
  pageNotFoundDesc: 'The requested vendor might not be in the current snapshot, or the link may be incorrect.',
  backToSearch: 'Back to search',
  errorTitle: 'An unexpected error occurred.',
  errorDesc: 'We could not display this page. You can try again or return to search.',
  retry: 'Try again',

  // Directory Filter Bar & Pagination
  filterListAria: 'Filter list',
  categoryFilter: 'Category',
  allCategories: 'All categories',
  governorateFilter: 'Governorate',
  allGovernorates: 'All governorates',
  coverageFilter: 'Evidence coverage',
  allCoverageLevels: 'All levels',
  applyFilter: 'Apply filter',
  resetFilter: 'Reset filter',
  totalMatchingVendors: 'Total matching vendors:',
  vendorsPerPage: 'vendors per page.',
  pageOutOfRange: 'Requested page is out of range.',
  matchingVendorsDistributed: 'distributed across',
  pagesWord: 'pages.',
  goToLastPage: 'Go to last page',
  previous: 'Previous',
  next: 'Next',
  pageOf: 'of',
  paginationAria: 'Browse results',

  // Merchant Summary Card & Shared Elements
  categoryLabel: 'Category: ',
  unspecifiedCategory: 'Unspecified category',
  locationLabel: 'Location: ',
  multipleRecordedLocations: 'Multiple recorded locations — {count} documented location records (not a confirmed branch count).',
  identityLabel: 'Identity: ',
  evidenceCoverageLabel: 'Evidence coverage: ',
  evidenceSummaryTally: 'Evidence: {total} total, {nonDuplicate} non-duplicate across {distinctSources} distinct sources.',
  fromNonDuplicateEvidence: '(from non-duplicate evidence).',
  latestPublished: 'Latest documented publication: ',
  latestCapture: 'Latest evidence capture: ',
  undated: 'Undated',
  unknownDate: 'Unknown',

  // Positive Evidence Card
  highlightedPositiveEvidence: 'Highlighted documented positive evidence',
  positiveNotesFromCustomers: 'Documented positive customer feedback from independent sources: ',
  independentSourcesCountLabel: 'Independent sources for published evidence: ',
  sourceCategoryLabelPrefix: 'Source category: ',
  publishedDatePrefix: 'Published: ',
  fullEvidenceOnMerchantPage: 'Full evidence on vendor page',
  openOriginalSource: 'Open original source',

  // Evidence Card & Technical Details
  evidenceDirection: 'Evidence sentiment: ',
  platformLabel: 'Platform: ',
  evidenceAuthor: 'Evidence author: ',
  capturedDatePrefix: 'Captured: ',
  oldEvidenceWarning: ' (old date — over 2 years ago)',
  sourceTextOnly: 'Source (text only): ',
  sourceVendorPage: 'Vendor page — the specific post is not publicly linkable',
  sourceUnreachable: 'Original post no longer reachable',
  sourceNotePrefix: 'Source note: ',
  sourceDetailsSummary: 'Source and documentation details',
  rawSourceType: 'Raw source type: ',
  includedInVerification: 'Included in automated verification round',
  notIncludedInVerification: 'Not included in automated verification round',
  duplicateRootNotice: 'Duplicate — original root: {root}',
  notDuplicateNotice: 'Not a duplicate (counted as an independent record)',
  crossMerchantDuplicateNotice: 'Root of this duplicate is registered under another vendor — review attribution before relying on it.',
  technicalDatesPublished: 'Technical dates — published: ',
  technicalDatesCaptured: ' · captured: ',

  // Merchant Detail Page
  vendorNotFound: 'Vendor not found',
  potentialDistricts: 'Potential districts: ',
  categoriesPrefix: 'Categories: ',
  registeredAliases: 'Registered aliases: ',
  importantObservations: 'Important interaction observations',
  importantObservationsDesc:
    'Key observations and claims based on documented evidence in the registry, ordered by priority and recency.',
  whatIsStillUnknown: 'What is still unknown',
  allEvidenceAndSources: 'All evidence and sources',
  allEvidenceDesc: 'Original independent evidence records observed for this vendor with their direct sources.',
  availableSourceCategories: 'Available source categories:',
  duplicateRecordsExcluded: 'Duplicate records excluded from independent count ({count})',
  duplicateRecordsDesc:
    'These records match original evidence listed above and are kept for reference documentation without counting them as separate experiences.',
  sourceOnlyRecords: 'Archived sources without text excerpts ({count})',
  sourceOnlyDesc:
    'Sources observed in the registry without an excerpt or direct quote; preserved for reference without being counted as independent facts.',
  registeredStoreData: 'Registered vendor details',
  storeDataDisclaimer: 'These are data and identifiers recorded in the snapshot, not confirmed branch locations or an endorsement of ownership.',
  availableOfficialLinks: 'Available official links',
  identifiersAndContacts: 'Identifiers & contacts',
  locationAndAddressRecords: 'Location & address records',
  registeredCity: 'Registered city: ',
  multipleRecordedLocationsNotice: 'Multiple locations recorded: {count} distinct address records in snapshot.',
  locationsNoticeCaveat: 'Notice: The recorded addresses are locations mentioned in monitoring data, not confirmed commercial branches.',
  possiblyRelatedProfiles: 'Possibly related profiles',
  relatedProfilesDesc:
    'These relationships are derived from automated identifier matching (may be related) and are not proof of shared ownership or joint management.',
  freshnessAndMethod: 'Freshness & methodology',
  sourceLinkVerificationStatus: 'Source link verification status:',
  directSourcesNotice: 'Published links allow readers to directly inspect the original source material and verify it themselves.',
  caveatLimitedCoverage:
    'Limited evidence coverage: Available information relies on few sources and is insufficient to form a comprehensive, confirmed picture of the vendor.',
  caveatStaleData:
    'Data freshness: The latest published evidence dates back to {date} (more than 2 years old) and may not reflect the current customer experience with the vendor.',
  caveatSourceOnly:
    'Archived sources without text excerpts: The record includes {count} preserved source(s) without a summary or quoted excerpt, kept for reference without counting as independent facts.',

  // Claim Cards
  linkedEvidence: 'Linked evidence: ',
  evidenceAnchor: 'Evidence {n}',
  claimKind: 'Type',
  claimSentiment: 'Sentiment',
  claimSourceCategory: 'Source category',
  claimLatestDate: 'Latest recorded date',
  claimSummary: 'Summary',
  nonDuplicateSources: 'Non-duplicate sources',
  totalObservations: 'Total observations',

  // Sentiment Bar
  evidenceSentimentHeading: 'Evidence sentiment',
  sentimentDuplicateTally: 'The counts above are calculated from non-duplicate evidence only — {count} duplicate evidence record(s) excluded.',
  sentimentZeroDuplicateTally: 'The counts above are calculated from non-duplicate evidence only — no duplicate evidence excluded.',

  // Cited Brief
  currentPictureHeading: 'Current picture',
  identityQuestion: 'What do we know about vendor identity?',
  reputationQuestion: 'What do sources say about dealing with the vendor?',
  warningPrefix: 'Notice: ',
  briefGeneratedAt: 'Brief prepared on: ',

  // Analysis Section
  noAnalysisYet: 'No sufficient analysis for this vendor yet.',
  automatedAnalysisNotice:
    'The following is automated analysis output from the evidence list, not a final verdict — review evidence and sources yourself.',
  signalsRequiringVerification: 'Signals requiring verification',
  positiveSignals: 'Positive signals',
  contradictions: 'Contradictions',
  missingInformation: 'Missing information',
  verifiedClaims: 'Verified claims with evidence',
  unverifiedClaims: 'Claims requiring verification',
  evidenceSummaryHeading: 'Evidence summary and analysis',
  reputationNotesHeading: 'Reputation and general perception notes',
  briefIdentityHeading: 'Identity',
  briefReputationHeading: 'Reputation & dealing',
  briefRiskHeading: 'Signals requiring scrutiny',
  fraudRiskNotesHeading: 'Fraud risk and integrity notes',
  consumerSatisfactionNotesHeading: 'Customer satisfaction and buying experience notes',

  // Source Citations
  noWebLinkAvailable: 'No openable web link available in record',
  lastVerifiedPrefix: '(last checked: {status})',
  sourceMetadata: 'Source details',
  accessKindPrefix: 'Access kind: ',
  notePrefix: 'Note: ',
  locatorPrefix: 'Locator: ',

  // Merchant Evidence Overview
  severalRecordedLocations: 'Multiple recorded locations',
  distinctAddressRecords: 'distinct address records',
  totalEvidence: 'Total evidence',
  nonDuplicateEvidence: 'Non-duplicate evidence',
  distinctNonDuplicateSources: 'Distinct non-duplicate sources',
  latestKnownPublication: 'Latest known publication',
  latestCaptureLabel: 'Latest capture',
  snapshotGeneratedDateLabel: 'Snapshot generation date',
};

const UI_STRINGS: Record<Locale, UiStrings> = {
  ar: Object.freeze({ ...AR_UI_STRINGS }),
  en: Object.freeze({ ...AR_UI_STRINGS, ...EN_UI_STRINGS }),
};

export function t(locale: Locale): UiStrings {
  return UI_STRINGS[locale] ?? UI_STRINGS.ar;
}
