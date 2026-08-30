import { describe, expect, it } from 'vitest';
import type { Governorate, SourceCategory } from './taxonomy';
import {
  AUTHOR_TYPE_LABELS,
  CATEGORY_TAG_PRIORITY,
  CATEGORY_TAG_LABELS,
  CLAIM_TYPE_LABELS,
  GOVERNORATE_KEYS,
  GOVERNORATE_LABELS,
  RELATION_LABELS,
  SOURCE_CATEGORY_LABELS,
  authorTypeLabel,
  categoryTags,
  claimTypeLabel,
  deriveSourceCategory,
  normalizeGovernorate,
  primaryCategoryTag,
  relationLabel,
  splitCityDisplay,
} from './taxonomy';

// ---------------------------------------------------------------------------
// Fixtures pinned against the live master DB (2026-08-29 read-only audit).
// Every distinct merchants.category string observed at that time.
// ---------------------------------------------------------------------------

const OBSERVED_CATEGORIES: readonly string[] = [
  'Air Conditioning & Refrigeration Manufacturer & Service Provider',
  'Apple Authorized Reseller & Premium Electronics Retailer',
  'Apple Device Repair & Hardware Service Center',
  'Apple Devices Sales, Trade-in & Repair',
  'Apple Products, MacBooks & Authorized Care',
  'Appliance Repair & Maintenance',
  'Authorized Mobile & Electronics Warranty Service Center',
  'Automated Gates, Security & Access Control Systems Provider',
  'Automotive & Authorized After-Sales Service',
  'Automotive & Certified Maintenance Centers',
  'Automotive Assembly & Authorized Service Network',
  'Automotive Dealership & Authorized Service Centers',
  'Automotive Services, Tires & Maintenance',
  'Cameras, Photography Gear, Drones & Studio Electronics',
  'Computer & Laptop Maintenance and Assembly Services',
  'Computer & Laptop Sales and Maintenance',
  'Computer Hardware & Custom PC Builder',
  'Computer Hardware & Desktop Builds',
  'Computer Hardware & Gaming PC Retailer',
  'Computer Hardware & Gaming PCs',
  'Computer Hardware & Gaming Peripherals Retailer',
  'Computer Hardware & Gaming Systems Retailer',
  'Computer Hardware & IT Retailer',
  'Computer Hardware & IT Systems',
  'Computer Hardware & Laptop Retailer',
  'Computer Hardware & Networking',
  'Computer Hardware & PC Components Retailer',
  'Computer Hardware & PC Gaming Retailer',
  'Computer Hardware & PC Systems',
  'Computer Hardware & Retail',
  'Computer Hardware & Spare Parts Retailer',
  'Computer Hardware, Custom PC Assembly & Gaming Tech',
  'Computer Hardware, Custom PC Builds & Components',
  'Computer Hardware, Gaming PC & Laptop Maintenance Store',
  'Computer Hardware, Gaming Peripherals & Retro Handhelds',
  'Computer Hardware, Imported PCs & Networking',
  'Computer Hardware, Laptops & Components',
  'Computer Hardware, Laptops & Maintenance',
  'Computer Hardware, Laptops & Security Systems',
  'Computer Hardware, Networking & Systems',
  'Computer, Electronics & IT Distributor',
  'Computer, Laptop & Hardware Maintenance',
  'Computer, Laptop & Hardware Maintenance Retailer',
  'Computer, Laptop & Workstation Retailer',
  'Computers, Gaming PCs, Laptops & IT Hardware',
  'Computers, Hardware & Electronics',
  'Computers, Laptops & Accessories',
  'Computers, Laptops & Consumer Electronics Retail',
  'Computers, Laptops & Gaming Hardware',
  'Computers, Laptops & Hardware',
  'Computers, Laptops & Hardware Maintenance',
  'Computers, Laptops & Hardware Repair',
  'Computers, Laptops & Interactive Displays',
  'Computers, Laptops & Maintenance',
  'Computers, Laptops & PC Hardware',
  'Computers, Laptops & Security Systems',
  'Computers, Laptops & Security Systems Retailer',
  'Computers, Laptops & Smart Electronics Retailer',
  'Computers, Laptops & Workstations',
  'Computers, Laptops, Mobile Phones & Printer Services',
  'Computers, Laptops, Printers & Networking Hardware',
  'Console Sales & Maintenance',
  'Console Sales & Service',
  'Console Sales & Service Center',
  'Console Sales, Digital Gaming & Maintenance',
  'Console Sales, Games Loading & Service',
  'Console Sales, Modification & Repairs',
  'Console sales, accounts & repair',
  'Consumer Electrical Appliances Refurbishing & Distribution Facility',
  'Consumer Electronics & Appliances Installment',
  'Consumer Electronics & Home Appliances',
  'Consumer Electronics & Home Appliances Distributor / Retailer (Panasonic Authorized Agent & Showroom)',
  'Consumer Electronics & Home Appliances Manufacturer',
  'Consumer Electronics & Home Appliances Retailer',
  'Consumer Electronics & Household Appliances',
  'Consumer Electronics & Household Appliances Retailer',
  'Consumer Electronics & IT Retailer',
  'Consumer Electronics & Mobile Devices Retailer',
  'Consumer Electronics & Mobile Phones Manufacturer & Service Provider',
  'Consumer Electronics & Mobile Retail',
  'Consumer Electronics & Telecommunications Authorized Distributor & Service Center',
  'Consumer Electronics / Home Appliances / Mobile Retail',
  'Consumer Electronics Distributor & Service Provider',
  'Consumer Electronics, Audio & Home Appliances',
  'Consumer Electronics, Home Appliances & Electronics Retail',
  'Consumer Electronics, Laptops, Home Appliances & Gadgets',
  'Consumer Electronics, Mobiles & Home Appliances Retailer',
  'Consumer Technology & Mobile Manufacturer / Authorized Service',
  'Custom Gaming PCs & Graphics Cards',
  'Custom PC Builds & Gaming Hardware Retailer',
  'Desktop Computers, Laptops & Components',
  'Digital Healthtech & Pharmacy Platform',
  'Digital Pharmacy Platform & E-Commerce',
  'Discount Grocery Chain',
  'Discount Retail Chain & Consumer Electronics / Small Appliances',
  'E-commerce Marketplace & Consumer Electronics',
  'Electrical & Home Appliances',
  'Electrical Appliances & Consumer Electronics',
  'Electrical Appliances & Home Electronics Retail',
  'Electrical Appliances & Home Essentials',
  'Electrical Supplies & Appliances',
  'Electronic Components & Engineering Supplies Retailer',
  'Electronic Components, ICs, Programmers & Repair Tools Retailer',
  'Electronics & Installment Retail',
  'Electronics & Laptop Motherboard Maintenance Specialist',
  'Electronics Repair Equipment & Component Supply',
  'Electronics, Gaming & Entertainment Retail',
  'Electronics, Laptops & Mobile Retail',
  'Furniture, Home Electronics & Lighting Retail',
  'Gaming & Console Retailer',
  'Gaming PC & Hardware Retailer',
  'Gaming PC Builds, GPU & Computer Hardware Retailer',
  'Gaming PC, Hardware & Computer Components',
  'Gaming PCs, Custom Builds & Open-Box Laptops',
  'Gaming PCs, Custom Hardware & Laptops',
  'Gaming console retail & maintenance',
  'Gaming retail & console store',
  'Gaming retail & hardware store',
  'General E-commerce & Electronics Marketplace',
  'Healthtech, Telehealth & Pharmacy Delivery',
  'Home & Electrical Appliances Retail',
  'Home & Kitchen Appliances Brand Showroom',
  'Home Appliance Maintenance & Natural Gas Services',
  'Home Appliance Repair & Electronics Maintenance',
  'Home Appliances',
  'Home Appliances & Air Conditioners Retail',
  'Home Appliances & Air Conditioning Manufacturer',
  'Home Appliances & Bridal Packages',
  'Home Appliances & Consumer Electronics Manufacturer & Service Provider',
  'Home Appliances & Consumer Electronics Retail',
  'Home Appliances & Consumer Electronics Retail Chain',
  'Home Appliances & Consumer Electronics Retailer',
  'Home Appliances & Consumer Electronics Showroom',
  'Home Appliances & Electronics',
  'Home Appliances & Electronics E-Commerce',
  'Home Appliances & Electronics Maintenance',
  'Home Appliances & Electronics Manufacturer/Retailer',
  'Home Appliances & Electronics Retail',
  'Home Appliances & Electronics Retail Mall',
  'Home Appliances & Electronics Retailer',
  'Home Appliances & Electronics Showroom',
  'Home Appliances & Refrigeration',
  'Home Appliances (Refrigerators, Washers, Cookers)',
  'Home Appliances Manufacturer & Service Provider',
  'Home Appliances Retail',
  'Home Appliances, Air Conditioning, Refrigeration & Freezers',
  'Home Appliances, Electronics & Bride Equipment',
  'Home Appliances, Electronics & Bride Essentials',
  'Home Appliances, Electronics & Household Goods Retail Chain',
  'Home Appliances, Electronics & IT Retailer',
  'Home Appliances, Electronics & Installment Sales',
  'Home Appliances, Electronics, Air Conditioners & Installment Services',
  'Home Electrical Appliances Retailer',
  'Home Furniture & Consumer Lighting Retailer',
  'Home Furniture, Mattresses & Electrical Appliances Retail',
  'Home Maintenance, Electrical & Appliance Repair Services Platform',
  'Home Tech, Appliances & Electronics Maintenance Platform',
  'Hypermarket & Consumer Electronics Retailer',
  'Hypermarket & Supermarket Retail',
  'Hypermarket & Wholesale Supermarket',
  'Hypermarket / Department Store / Electronics & Grocery Retail',
  'Hypermarket / Gourmet Supermarket / Department Store',
  'IT Hardware & Laptop Retailer',
  'IT Solutions, Computer Systems & Software',
  'Import Laptop & Business PC Retailer',
  'Import Laptop Retailer',
  'Import Laptops, Workstations & Gaming PCs',
  'Imported Laptop & Mobile Workstation Retail',
  'Imported Laptops & Business Computers Retail',
  'Imported Laptops, PCs & Hardware',
  'Imported Laptops, Workstations, Graphic PCs & Accessories',
  'Independent Pharmacy & Health Retail',
  'Laptop & Tech Retailer',
  'Laptop & Workstation Computer Retail & Maintenance',
  'Laptop Maintenance, Repair & Spare Parts Store',
  'Laptops & Computer Hardware',
  'Laptops & Computer Hardware Retail',
  'Laptops & Computer Systems',
  'Laptops & Hardware Maintenance',
  'Laptops & Security Systems Retail',
  'Laptops, Accessories & Repair',
  'Laptops, Computers & Tech Accessories',
  'Laptops, Desktop PCs, Monitors & Computer Maintenance',
  'Laptops, Enterprise Hardware, Networking & Surveillance',
  'Laptops, Workstations & Computer Import',
  'Laptops, Workstations & Gaming Accessories',
  'Laptops, Workstations & Mobile Accessories',
  'Laptops, Workstations, Desktop Computers, Computer Maintenance & Electronics',
  'Major Home Appliances & Consumer Electronics Manufacturer / Authorized Service',
  'Mobile & Tablet Repair Service',
  'Mobile Phone & Consumer Electronics Distributor / Service Center',
  'Mobile Phones & Authorized Electronics Distribution',
  'Mobile Phones & Consumer Electronics Distributor',
  'Mobile Phones & Consumer Electronics Retailer',
  'Mobile Phones & Electronics Retail',
  'Mobile Phones, Electronics & Appliances Retailer',
  'Mobile Phones, Tablets & Telecom Retailer',
  'Mobile Phones, iPhones & Mobile Repair',
  'Mobile Sales & Specialized iPhone Hardware Repair',
  'National Telecom Operator & Device Retail Network',
  'Online & retail gaming store',
  'Online Classifieds & Electronics Marketplace',
  'Online Home Appliances, Furniture & Electronics Marketplace',
  'Open Source Electronics & Robotics Supplies Retailer',
  'PC & Laptop Accessories and Hardware',
  'PC Components, Custom Builds & Laptops',
  'PC Gaming & Computer Hardware Retailer',
  'PC Hardware & Budget Gaming Builds',
  'PC Hardware, Custom Builds & Laptops',
  'PC Hardware, Gaming Builds & Components',
  'PC Hardware, Memory & Storage Upgrades',
  'PC Systems, Trade-In, Maintenance & Security Systems',
  'Pharmacy & Healthcare Retail',
  'Pharmacy & Healthcare Retail Chain',
  'Pharmacy Chain',
  'Pharmacy Chain & Local Healthcare Retailer',
  'Pharmacy Chain & Retail',
  'Pharmacy Chain Management',
  'Pharmacy, Health & Cosmetics',
  'PlayStation Store & Maintenance',
  'Point of Sale Hardware, Barcode Scales & Receipt Printers',
  'Premium Supermarket / Gourmet Delicatessen Retail',
  'Refrigeration, Freezers & Home Appliances Manufacturer',
  'Regulatory & Tax Authority Compliance Framework',
  'Small Domestic Electrical Appliances Assembly & Distribution Facility',
  'Smart Home & Automation Systems',
  'Smart Home Automation, Energy Management & Audio-Visual Systems',
  'Smart Home Automation, Smart Locks & Security Systems',
  'Smartphones & Mobile Electronics Retailer',
  'Smartphones, Smart Devices & Accessories',
  'Smartphones, Smartwatches & Mobile Accessories',
  'Supermarket & Grocery Chain',
  'Supermarket & Grocery Retail',
  'Supermarket & Hypermarket Chain',
  'Supermarket / Discount Grocery Retail Chain',
  'Supermarket / Grocery Retail Chain',
  'Supermarket / Hypermarket / Wholesale & Retail',
  'Supermarket Chain',
  'Technology Distribution & Systems Solutions',
  'Telecom Operator & Consumer Tech / Devices Retailer',
  'Telecom Operator & Mobile Devices / Consumer Electronics Retailer',
  'Telecom Operator & Mobile Devices / Smart Hardware Retailer',
  'Teleshopping & Mobile Phones',
  'Unauthorized Appliance Maintenance & Electronics Repair',
  'Used & Imported Laptops, PC Hardware',
  'Video Game & Console Repair / Retail',
  'Video Game & Console Store / Maintenance',
  'Video Game Consoles & Gaming Hardware',
  'Video Game Consoles & Gaming Retail',
  'Video Game Store & Console Maintenance',
  'Video Game Store & Console Retailer',
  'Video Game Store & PlayStation Maintenance',
  'air_conditioning_appliances_maintenance',
  'automotive_dealer_and_service',
  'computer_gaming_workstation',
  'computer_hardware_maintenance',
  'computer_hardware_retail',
  'computer_laptop_retail',
  'computers_and_laptops',
  'computers_and_repair',
  'consumer_electronics_retail',
  'electronic_components_and_replacement_parts',
  'electronic_components_and_robotics',
  'electronics_and_home_appliances_retail',
  'electronics_repair',
  'electronics_retail',
  'gaming_hardware_gpu_retail',
  'gaming_laptops_apple_workstations',
  'home_appliances',
  'home_appliances_air_conditioning',
  'home_appliances_authorized_dealer',
  'home_appliances_maintenance',
  'home_appliances_repair_maintenance',
  'home_appliances_water_filtration',
  'laptop_computer_retail',
  'laptop_computer_workstations',
  'laptop_spare_parts_maintenance',
  'laptops_mobile_maintenance_retail',
  'laptops_openbox_gaming_hardware',
  'mobile_laptop',
  'mobile_phones_accessories_services',
  'mobile_phones_electronics',
  'mobile_phones_electronics_retail',
  'pc_hardware',
  'printers_copiers_hardware_maintenance',
  'smartphones_electronics_retail',
  'software_licensing_digital_products',
  'supermarket',
  'supermarket_and_hypermarket',
];

// Every distinct merchants.governorate string observed in the master DB.
const OBSERVED_GOVERNORATES: readonly string[] = [
  'Alexandria', 'Assiut', 'Beheira', 'Beni Suef', 'Cairo', 'Dakahlia',
  'Damietta', 'Gharbia', 'Giza', 'Ismailia', 'Minya', 'Port Said',
  'Qalyubia', 'Qena', 'Sharqia', 'Sohag', 'Suez',
  'الدقهلية (Dakahlia)', 'القاهرة (Cairo)',
];

// Every distinct evidence.claim_type observed in the master DB (22 values).
const OBSERVED_CLAIM_TYPES: readonly string[] = [
  'account_page_disappearance', 'after_sales_support', 'communication_issue',
  'complaint_resolved', 'complaint_unresolved', 'counterfeit_product_allegation',
  'delayed_delivery', 'identity_mismatch', 'long_business_history',
  'merchant_response', 'official_warning', 'other', 'physical_presence',
  'pricing_issue', 'product_quality', 'refund_issue', 'refund_issued',
  'repeated_recommendation', 'successful_purchase',
  'verified_business_information', 'warranty_honored', 'warranty_issue',
];

// Every distinct evidence.author_type observed in the master DB.
const OBSERVED_AUTHOR_TYPES: readonly string[] = [
  'customer', 'journalist', 'merchant', 'registry', 'regulator', 'unknown',
];

// Every distinct merchant_links.relation observed in the master DB.
const OBSERVED_RELATIONS: readonly string[] = [
  'identifier_collision', 'name_identifier_conflict',
];

// ---------------------------------------------------------------------------
// Category tagger
// ---------------------------------------------------------------------------

describe('categoryTags — observed master categories', () => {
  it('maps every observed category to at least one tag', () => {
    for (const raw of OBSERVED_CATEGORIES) {
      const tags = categoryTags(raw);
      expect(tags.length, `no tags for: ${raw}`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(CATEGORY_TAG_PRIORITY).toContain(tag);
      }
    }
  });
  it('maps the one legitimately unclassifiable observed category to other', () => {
    // Plan: "unmapped values become other plus an audit warning". The
    // regulatory-compliance category is a taxonomy concern, not a merchant
    // retail category, so other is the correct controlled projection.
    expect(categoryTags('Regulatory & Tax Authority Compliance Framework')).toEqual(['other']);
    const onlyOther = OBSERVED_CATEGORIES.filter(
      (raw) => categoryTags(raw).length === 1 && categoryTags(raw)[0] === 'other',
    );
    expect(onlyOther).toEqual(['Regulatory & Tax Authority Compliance Framework']);
  });

  it('returns tags in the ordered primary priority', () => {
    const tags = categoryTags('Computers, Laptops, Mobile Phones & Printer Services');
    expect(tags).toEqual([...tags].sort(
      (a, b) => CATEGORY_TAG_PRIORITY.indexOf(a) - CATEGORY_TAG_PRIORITY.indexOf(b),
    ));
  });

  it('assigns the ordered primary tag as first element', () => {
    expect(primaryCategoryTag('Pharmacy Chain & Retail')).toBe('pharmacy_health');
    expect(primaryCategoryTag('Automotive Dealership & Authorized Service Centers')).toBe('automotive');
    expect(primaryCategoryTag('Supermarket & Grocery Chain')).toBe('grocery_retail');
    expect(primaryCategoryTag('Video Game Consoles & Gaming Hardware')).toBe('gaming');
    expect(primaryCategoryTag('Mobile Phones, Tablets & Telecom Retailer')).toBe('mobile_telecom');
    expect(primaryCategoryTag('Computer Hardware & IT Retailer')).toBe('computers_it');
    expect(primaryCategoryTag('Home Appliances Retail')).toBe('home_appliances');
    expect(primaryCategoryTag('Smart Home & Automation Systems')).toBe('security_smart_home');
    // Plan priority: home appliances ranks above consumer electronics.
    expect(primaryCategoryTag('Consumer Electronics & Household Appliances')).toBe('home_appliances');
    expect(primaryCategoryTag('Cameras, Photography Gear, Drones & Studio Electronics')).toBe('consumer_electronics');
    // Plan priority: consumer electronics ranks above marketplace/online.
    // only marketplace-keyword categories without an electronics hit land lower.
    expect(primaryCategoryTag('E-commerce Marketplace & Consumer Electronics')).toBe('consumer_electronics');
    expect(primaryCategoryTag('Online Classifieds & Electronics Marketplace')).toBe('consumer_electronics');
    expect(primaryCategoryTag('General E-commerce & Electronics Marketplace')).toBe('consumer_electronics');
    expect(primaryCategoryTag('Digital Pharmacy Platform & E-Commerce')).toBe('pharmacy_health');
    expect(primaryCategoryTag('Console Sales & Maintenance')).toBe('gaming');
  });

  it('handles snake_case keys identically to prose forms', () => {
    expect(categoryTags('home_appliances')).toContain('home_appliances');
    expect(categoryTags('Home Appliances')).toContain('home_appliances');
    expect(categoryTags('mobile_phones_electronics_retail')).toContain('mobile_telecom');
    expect(categoryTags('computer_hardware_retail')).toContain('computers_it');
    expect(categoryTags('supermarket_and_hypermarket')).toContain('grocery_retail');
  });

  it('produces multi-valued tags for mixed categories', () => {
    const tags = categoryTags('Computer Hardware, Laptops & Security Systems');
    expect(tags).toContain('computers_it');
    expect(tags).toContain('security_smart_home');
    expect(categoryTags('Pharmacy, Health & Cosmetics')).toEqual(['pharmacy_health']);
    expect(categoryTags('Home Appliances & Electronics E-Commerce')).toEqual([
      'home_appliances', 'consumer_electronics', 'marketplace_online',
    ]);
  });

  it('maps Arabic prose categories', () => {
    expect(categoryTags('صيدلية وأدوية')).toEqual(['pharmacy_health']);
    expect(categoryTags('متجر إلكتروني للأجهزة المنزلية')).toEqual(['marketplace_online']);
  });

  it('maps unmapped values to other', () => {
    expect(categoryTags('Quantum Submarine Consulting')).toEqual(['other']);
    expect(categoryTags('')).toEqual(['other']);
  });
});

// ---------------------------------------------------------------------------
// Governorates
// ---------------------------------------------------------------------------

describe('normalizeGovernorate — observed strings collapse to 17 keys', () => {
  it('has exactly 17 stable keys with Arabic and English labels', () => {
    expect(GOVERNORATE_KEYS.length).toBe(17);
    expect(new Set(GOVERNORATE_KEYS).size).toBe(17);
    for (const key of GOVERNORATE_KEYS) {
      expect(typeof GOVERNORATE_LABELS[key as Governorate].ar).toBe('string');
      expect(GOVERNORATE_LABELS[key as Governorate].ar.length).toBeGreaterThan(0);
      expect(GOVERNORATE_LABELS[key as Governorate].en.length).toBeGreaterThan(0);
    }
  });

  it('maps every observed governorate string to a stable key', () => {
    for (const raw of OBSERVED_GOVERNORATES) {
      expect(normalizeGovernorate(raw), `unmapped governorate: ${raw}`).not.toBeNull();
    }
  });

  it('collapses the 19 observed strings onto exactly the 17 keys', () => {
    const keys = new Set(
      OBSERVED_GOVERNORATES.map((raw) => normalizeGovernorate(raw) as Governorate),
    );
    expect(keys.size).toBe(17);
    expect([...keys].sort()).toEqual([...GOVERNORATE_KEYS].sort());
  });

  it('maps Cairo and Dakahlia variants to the same keys', () => {
    expect(normalizeGovernorate('Cairo')).toBe('cairo');
    expect(normalizeGovernorate('القاهرة (Cairo)')).toBe('cairo');
    expect(normalizeGovernorate('Dakahlia')).toBe('dakahlia');
    expect(normalizeGovernorate('الدقهلية (Dakahlia)')).toBe('dakahlia');
  });

  it('returns null for unknown governorates without inventing one', () => {
    expect(normalizeGovernorate('Atlantis')).toBeNull();
    expect(normalizeGovernorate('')).toBeNull();
  });
});

describe('splitCityDisplay — display-only district hints', () => {
  it('keeps city text verbatim and extracts parenthetical hints', () => {
    const result = splitCityDisplay('Giza (Faisal / Haram)');
    expect(result.city).toBe('Giza (Faisal / Haram)');
    expect(result.districtHints).toEqual(['Faisal', 'Haram']);
  });

  it('extracts slash-separated hints when no parentheses exist', () => {
    const result = splitCityDisplay('El Maragha / Sohag');
    expect(result.city).toBe('El Maragha / Sohag');
    expect(result.districtHints).toEqual(['El Maragha', 'Sohag']);
  });

  it('returns no hints for plain cities', () => {
    expect(splitCityDisplay('Mansoura').districtHints).toEqual([]);
    expect(splitCityDisplay('Mansoura').city).toBe('Mansoura');
  });

  it('handles multi-branch parentheticals', () => {
    expect(splitCityDisplay('Giza (Dokki / Mohandessin / Haram / Faisal)').districtHints).toEqual([
      'Dokki', 'Mohandessin', 'Haram', 'Faisal',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Source category precedence
// ---------------------------------------------------------------------------

describe('deriveSourceCategory — exact precedence', () => {
  const base = { url: 'https://example.com/x', sourceType: 'unknown', authorType: 'unknown' };

  it('whois:// URL wins over everything, including merchant author', () => {
    expect(deriveSourceCategory({ ...base, url: 'whois://example.com', authorType: 'merchant' })).toBe('technical_registry');
    expect(deriveSourceCategory({ ...base, url: 'WHOIS://EXAMPLE.COM', authorType: 'regulator' })).toBe('technical_registry');
  });

  it('regulator/registry author beats merchant author and merchant source_type', () => {
    expect(deriveSourceCategory({ ...base, authorType: 'regulator', sourceType: 'merchant_website' })).toBe('public_authority');
    expect(deriveSourceCategory({ ...base, authorType: 'registry', sourceType: 'official_website' })).toBe('public_authority');
  });

  it('merchant author wins over customer/journalist-style source_type', () => {
    expect(deriveSourceCategory({ ...base, authorType: 'merchant', sourceType: 'customer_review' })).toBe('merchant_owned');
  });

  it('customer author beats journalist source_type', () => {
    expect(deriveSourceCategory({ ...base, authorType: 'customer', sourceType: 'news_report' })).toBe('customer_report');
  });

  it('journalist author maps to news', () => {
    expect(deriveSourceCategory({ ...base, authorType: 'journalist', sourceType: 'social_post' })).toBe('news');
  });

  it('falls back to source_type keywords in exact order', () => {
    const src = (sourceType: string, url = base.url): SourceCategory =>
      deriveSourceCategory({ ...base, sourceType, url });
    expect(src('government_portal')).toBe('government_registry');
    expect(src('corporate_registry')).toBe('government_registry');
    expect(src('merchant_official_page')).toBe('merchant_site');
    expect(src('official_website')).toBe('merchant_site');
    expect(src('ecommerce_platform')).toBe('marketplace');
    expect(src('app_store')).toBe('marketplace');
    expect(src('business_directory')).toBe('directory');
    expect(src('reddit_thread')).toBe('forum_community');
    expect(src('forum_post')).toBe('forum_community');
    expect(src('social_media_post')).toBe('social');
    expect(src('facebook_group_post')).toBe('forum_community');
    expect(src('facebook_group')).toBe('forum_community');
    expect(src('group_discussion')).toBe('forum_community');
    expect(src('news_article')).toBe('news');
    expect(src('technology_publication')).toBe('news');
    expect(src('completely_unknown_value')).toBe('other');
    expect(src('unknown')).toBe('other');
  });

  it('government/registry keyword outranks merchant keywords on mixed source_type', () => {
    expect(
      deriveSourceCategory({ ...base, sourceType: 'official_registry_and_contact' }),
    ).toBe('government_registry');
  });
});

describe('source category labels', () => {
  it('labels every SourceCategory in Arabic and English', () => {
    for (const key of Object.keys(SOURCE_CATEGORY_LABELS)) {
      expect(SOURCE_CATEGORY_LABELS[key as SourceCategory].ar.length).toBeGreaterThan(0);
      expect(SOURCE_CATEGORY_LABELS[key as SourceCategory].en.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Author types
// ---------------------------------------------------------------------------

describe('AUTHOR_TYPE_LABELS — observed author types', () => {
  it('covers every observed author type with an Arabic label', () => {
    expect(Object.keys(AUTHOR_TYPE_LABELS).sort()).toEqual([...OBSERVED_AUTHOR_TYPES].sort());
    for (const key of OBSERVED_AUTHOR_TYPES) {
      expect(AUTHOR_TYPE_LABELS[key as keyof typeof AUTHOR_TYPE_LABELS]).toBeTruthy();
    }
  });

  it('falls back to the raw key for unknown author types', () => {
    expect(authorTypeLabel('unusual_author')).toBe('unusual_author');
    expect(authorTypeLabel('customer')).toBe('عميل');
  });
});

// ---------------------------------------------------------------------------
// Claim types
// ---------------------------------------------------------------------------

describe('CLAIM_TYPE_LABELS — all 22 observed claim types', () => {
  it('covers every observed claim type', () => {
    for (const key of OBSERVED_CLAIM_TYPES) {
      expect(CLAIM_TYPE_LABELS[key], `missing label for claim type: ${key}`).toBeTruthy();
    }
  });

  it('has exactly the 22 observed keys', () => {
    expect(Object.keys(CLAIM_TYPE_LABELS).sort()).toEqual([...OBSERVED_CLAIM_TYPES].sort());
  });

  it('labels other as أخرى', () => {
    expect(CLAIM_TYPE_LABELS.other).toBe('أخرى');
    expect(claimTypeLabel('other')).toBe('أخرى');
  });

  it('falls back to the raw key for unknown claim types', () => {
    expect(claimTypeLabel('brand_new_claim_kind')).toBe('brand_new_claim_kind');
    expect(claimTypeLabel('official_warning')).toBe('تحذير رسمي');
  });
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

describe('RELATION_LABELS — observed relations', () => {
  it('covers exactly the observed relation values with Arabic labels', () => {
    expect(Object.keys(RELATION_LABELS).sort()).toEqual([...OBSERVED_RELATIONS].sort());
    for (const key of OBSERVED_RELATIONS) {
      expect(RELATION_LABELS[key as keyof typeof RELATION_LABELS]).toBeTruthy();
    }
  });

  it('falls back to the raw key for unknown relations', () => {
    expect(relationLabel('shared_warehouse')).toBe('shared_warehouse');
    expect(relationLabel('identifier_collision')).toBe('تطابق في المعرفات');
  });
});

// ---------------------------------------------------------------------------
// Raw preservation contract
// ---------------------------------------------------------------------------

describe('raw value preservation contract', () => {
  it('never rewrites raw inputs — functions are pure projections', () => {
    const raw = 'Computer Hardware, Laptops & Security Systems';
    const snapshot = raw;
    categoryTags(raw);
    primaryCategoryTag(raw);
    expect(raw).toBe(snapshot);

    const gov = 'الدقهلية (Dakahlia)';
    normalizeGovernorate(gov);
    splitCityDisplay(gov);
    expect(gov).toBe('الدقهلية (Dakahlia)');
  });
});

// ---------------------------------------------------------------------------
// Category tag labels
// ---------------------------------------------------------------------------

describe('category tag labels', () => {
  it('labels every priority tag in Arabic and English', () => {
    for (const tag of CATEGORY_TAG_PRIORITY) {
      expect(CATEGORY_TAG_LABELS[tag].ar.length).toBeGreaterThan(0);
      expect(CATEGORY_TAG_LABELS[tag].en.length).toBeGreaterThan(0);
    }
  });
});
