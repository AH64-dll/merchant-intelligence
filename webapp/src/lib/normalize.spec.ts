import { describe, expect, it } from 'vitest';
import {
  conjunctionVariants,
  detectInputKind,
  foldDigits,
  isExternalReferenceUrl,
  levenshtein,
  nameTokens,
  normalizeNameLoose,
  normalizeNameStrict,
  normalizePhone,
  normalizeQueryUrl,
  trigrams,
} from './normalize';

describe('detectInputKind', () => {
  it.each([
    '01000000000',
    '+201001234567',
    '00201000000000',
    '201000000000',
    '0223456789',
    '+20 100 000 0000',
    '(+20) 100-000-0000',
    // Arabic-Indic digits fold to ASCII before detection
    '٠١٢٨٦٦١٩٩٦٦',
  ])('detects phone for %s', (input) => {
    expect(detectInputKind(input)).toBe('phone');
  });

  it.each([
    'http://facebook.com/B.TECH.Egypt',
    'https://www.instagram.com/someshop/',
    'www.facebook.com/B.TECH.Egypt',
    'facebook.com/B.TECH.Egypt',
    'tiktok.com/@my.shop',
    'https://g.page/r/AbCd123',
    'HTTPS://EXAMPLE.COM/PAGE',
    'maps.app.goo.gl/maps/AbCd123',
    'play.google.com/store/apps/details?id=com.example',
    'apps.apple.com/us/app/example/id1528993866',
    'cpa.gov.eg/ar-eg/complaints',
    'support.apple.com/ar-eg/HT201222',
  ])('detects url for %s', (input) => {
    expect(detectInputKind(input)).toBe('url');
  });

  it.each([
    'ahmed226887@gmail.com',
    'Ahmed226887@Gmail.COM',
    'contactus@elarabygroup.com',
  ])('detects email for %s', (input) => {
    expect(detectInputKind(input)).toBe('email');
  });

  it('treats digit strings shorter than 9 digits as names', () => {
    expect(detectInputKind('12345678')).toBe('name');
  });

  it.each(['B.TECH', 'شركة بي تك', 'محمد أحمد للتوريدات', 'example shop', 'وبي تك', 'ولي'])(
    'detects name for %s',
    (input) => {
      expect(detectInputKind(input)).toBe('name');
    },
  );

  it('returns name for empty input', () => {
    expect(detectInputKind('')).toBe('name');
  });
});

describe('foldDigits', () => {
  it('folds Arabic-Indic and Persian digits to ASCII', () => {
    expect(foldDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(foldDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(foldDigits('01٠2٣')).toBe('01023');
  });

  it('leaves ASCII and non-digit text untouched', () => {
    expect(foldDigits('abc123')).toBe('abc123');
    expect(foldDigits('شركة بي تك')).toBe('شركة بي تك');
  });
});

describe('normalizePhone', () => {
  it('folds Arabic digits before normalization', () => {
    expect(normalizePhone('٠١٢٨٦٦١٩٩٦٦')).toBe('+201286619966');
    expect(normalizePhone('٠٠٢٠١٠٠٠٠٠٠٠٠٠')).toBe('+201000000000');
  });

  it.each([
    ['01000000000', '+201000000000'],
    ['+20 100 000 0000', '+201000000000'],
    ['00201000000000', '+201000000000'],
    ['201000000000', '+201000000000'],
    ['(+20) 100-000-0000', '+201000000000'],
    ['0223456789', '+20223456789'],
    ['0951234567', '+20951234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    '+14155551234',
    '971501234567',
    '447911123456',
    '972501234567',
  ])('rejects non-Egyptian number %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it.each([
    '',
    '   ',
    'abc',
    '--',
    '12345',
    '01000',
    '20',
    '0100000000',
    '010000000000',
    '01300000000',
    '0999',
    '010000000001',
    '00201000000000000',
  ])('returns null for %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('strips surrounding letters and punctuation before validating digits', () => {
    expect(normalizePhone('اتصل: 01000000000')).toBe('+201000000000');
    expect(normalizePhone('tel:+201000000000')).toBe('+201000000000');
  });
});

describe('normalizeQueryUrl', () => {
  it('normalizes facebook urls to an https canonical account key', () => {
    expect(normalizeQueryUrl('http://facebook.com/B.TECH.Egypt/')).toMatchObject({
      kind: 'facebook',
      hostKey: 'facebook.com',
      originKey: null,
      externalReference: false,
    });
    const result = normalizeQueryUrl('http://facebook.com/B.TECH.Egypt/');
    expect(result?.normalized).toBe('https://facebook.com/B.TECH.Egypt');
    expect(result?.pathKeys).toContain('facebook.com/b.tech.egypt');
  });

  it('keys facebook profile.php pages on their numeric id', () => {
    const result = normalizeQueryUrl('https://www.facebook.com/profile.php?id=100061858249234&sk=about');
    expect(result?.kind).toBe('facebook');
    expect(result?.pathKeys).toContain('facebook.com/profile.php?id=100061858249234');
  });

  it('lowercases instagram handles and keeps subpath keys', () => {
    const result = normalizeQueryUrl('https://Instagram.com/SomeShop/reels/');
    expect(result?.kind).toBe('instagram');
    expect(result?.normalized).toBe('https://instagram.com/someshop');
    expect(result?.pathKeys).toContain('instagram.com/someshop');
    expect(result?.pathKeys).toContain('instagram.com/someshop/reels');
  });

  it('preserves tiktok @handle and adds subpath keys', () => {
    const result = normalizeQueryUrl('tiktok.com/myshop?lang=ar');
    expect(result?.kind).toBe('tiktok');
    expect(result?.normalized).toBe('https://tiktok.com/@myshop');
    expect(result?.pathKeys).toContain('tiktok.com/@myshop');
  });

  it('maps g.page to google_maps with full path key', () => {
    const result = normalizeQueryUrl('https://g.page/r/AbCd123/review');
    expect(result?.kind).toBe('google_maps');
    expect(result?.pathKeys).toContain('g.page/r/abcd123/review');
  });

  it('maps google.com/maps and maps.google.com place paths to google_maps', () => {
    for (const input of [
      'https://www.google.com/maps/place/Some+Place/@x,y',
      'https://maps.google.com/maps?q=cairo',
    ]) {
      const result = normalizeQueryUrl(input);
      expect(result?.kind).toBe('google_maps');
      expect(result?.originKey).toBeNull();
    }
  });

  it('keys play store urls on their item path', () => {
    const result = normalizeQueryUrl('https://play.google.com/store/apps/details?id=com.shop.app&hl=ar');
    expect(result?.kind).toBe('marketplace');
    expect(result?.pathKeys).toContain('play.google.com/store/apps/details?id=com.shop.app');
  });

  it('keys apple app store urls on their numeric app id', () => {
    const result = normalizeQueryUrl('https://apps.apple.com/us/app/elezaby/id1528993866');
    expect(result?.kind).toBe('marketplace');
    expect(result?.pathKeys).toContain('apps.apple.com/us/app/elezaby/id1528993866');
  });
  it('keys generic directory urls on host+path with tracking stripped, never bare-host fallback', () => {
    const result = normalizeQueryUrl('https://yellowpages.com.eg/en/shop/profile?utm_source=x&fbclid=abc');
    expect(result?.kind).toBe('website');
    expect(result?.pathKeys).toContain('yellowpages.com.eg/en/shop/profile');
    expect(result?.pathKeys[0]).not.toContain('utm_');
    // Directory hosts keep their origin key for search-layer policy enforcement.
    expect(result?.originKey).toBe('yellowpages.com.eg');
  });

  it('indexes first-party websites on scheme-free origin keys with https default', () => {
    const result = normalizeQueryUrl('example.com');
    expect(result).toEqual({
      kind: 'website',
      normalized: 'https://example.com',
      schemeless: 'example.com',
      hostKey: 'example.com',
      pathKeys: ['example.com'],
      originKey: 'example.com',
      externalReference: false,
    });
  });
  it('preserves host+path for first-party websites and keeps the origin fallback key', () => {
    const result = normalizeQueryUrl('https://www.castle.eg/products/x?id=1');
    expect(result?.kind).toBe('website');
    expect(result?.normalized).toBe('https://castle.eg/products/x?id=1');
    expect(result?.pathKeys).toContain('castle.eg/products/x?id=1');
    expect(result?.originKey).toBe('castle.eg');
  });

  it('falls back to website for a bare known host with no path', () => {
    const result = normalizeQueryUrl('https://www.facebook.com');
    expect(result?.kind).toBe('website');
    expect(result?.originKey).toBe('facebook.com');
  });

  it('flags quarantined external-reference hosts', () => {
    expect(normalizeQueryUrl('http://cpa.gov.eg')?.externalReference).toBe(true);
    expect(normalizeQueryUrl('https://support.apple.com/ar-eg')?.externalReference).toBe(true);
    expect(normalizeQueryUrl('shakwa.cpa-mobile.com/complaint/123')?.externalReference).toBe(true);
    expect(normalizeQueryUrl('https://btech.com')?.externalReference).toBe(false);
  });

  it('returns null for unparseable input', () => {
    expect(normalizeQueryUrl('not a url')).toBeNull();
    expect(normalizeQueryUrl('')).toBeNull();
    expect(normalizeQueryUrl('localhost')).toBeNull();
  });

  it('normalizes real goo.gl maps shortlinks verbatim', () => {
    const result = normalizeQueryUrl('https://goo.gl/maps/BbZuAKqi75232WJZ8');
    expect(result?.kind).toBe('google_maps');
    expect(result?.normalized).toBe('https://goo.gl/maps/BbZuAKqi75232WJZ8');
  });

  it('normalizes maps.app.goo.gl shortlinks stripping query and trailing slash', () => {
    const result = normalizeQueryUrl('https://maps.app.goo.gl/maps/AbCd123/?g_st=ic');
    expect(result?.kind).toBe('google_maps');
    expect(result?.normalized).toBe('https://maps.app.goo.gl/maps/AbCd123');
  });

  it('detects bare goo.gl shortlink input as url', () => {
    expect(detectInputKind('goo.gl/maps/BbZuAKqi75232WJZ8')).toBe('url');
  });
});

describe('isExternalReferenceUrl', () => {
  it('accepts quarantined hosts in any form', () => {
    expect(isExternalReferenceUrl('cpa.gov.eg')).toBe(true);
    expect(isExternalReferenceUrl('https://www.cpa.gov.eg/ar')).toBe(true);
    expect(isExternalReferenceUrl('support.apple.com/x')).toBe(true);
  });

  it('rejects ordinary hosts and non-urls', () => {
    expect(isExternalReferenceUrl('btech.com')).toBe(false);
    expect(isExternalReferenceUrl('b tech')).toBe(false);
  });
});

describe('normalizeNameStrict', () => {
  it('maps punctuation to spaces and lowercases', () => {
    expect(normalizeNameStrict('B.TECH')).toBe('b tech');
    expect(normalizeNameStrict('B-TECH_Trading, Co (EG) | Store')).toBe('b tech trading co eg store');
  });

  it('PRESERVES taa marbuta (ة) and the definite article (ال)', () => {
    expect(normalizeNameStrict('شركة بي تك')).toBe('شركة بي تك');
    expect(normalizeNameStrict('الاهلي')).toBe('الاهلي');
    expect(normalizeNameStrict('شركة الأهلي للإسمنت')).toBe('شركة الاهلي للاسمنت');
  });

  it('folds tatweel U+0640', () => {
    expect(normalizeNameStrict('شــركة')).toBe('شركة');
  });

  it('strips Arabic diacritics U+064B-U+0652 and U+0670', () => {
    expect(normalizeNameStrict('مَحَمَّد أَحْمَد')).toBe('محمد احمد');
    expect(normalizeNameStrict('هدىٰ')).toBe('هدي');
  });

  it('unifies alef variants and alef maqsura', () => {
    expect(normalizeNameStrict('أحمد إبراهيم آدم على شركة')).toBe('احمد ابراهيم ادم علي شركة');
  });

  it('collapses whitespace', () => {
    expect(normalizeNameStrict('   B.TECH   Trading   ')).toBe('b tech trading');
    expect(normalizeNameStrict('\tشركة\t\tبي تك\n')).toBe('شركة بي تك');
  });

  it('handles mixed Arabic/Latin input', () => {
    expect(normalizeNameStrict('B.TECH بي تك')).toBe('b tech بي تك');
  });

  it('returns empty string for empty, blank, punctuation-only or article-only input', () => {
    expect(normalizeNameStrict('')).toBe('');
    expect(normalizeNameStrict('   ')).toBe('');
    expect(normalizeNameStrict('.,-')).toBe('');
  });

  it('keeps النور تك and نور تك DISTINCT (no loose collision on exact maps)', () => {
    expect(normalizeNameStrict('النور تك')).not.toBe(normalizeNameStrict('نور تك'));
  });
});

describe('normalizeNameLoose', () => {
  it('starts from strict output then folds ة→ه and strips leading ال per token', () => {
    expect(normalizeNameLoose('شركة بي تك')).toBe('شركه بي تك');
    expect(normalizeNameLoose('الاهلي النادي')).toBe('اهلي نادي');
    expect(normalizeNameLoose('شركة الأهلي للإسمنت')).toBe('شركه اهلي للاسمنت');
  });

  it('drops a token that is only ال entirely', () => {
    expect(normalizeNameLoose('ال ال')).toBe('');
  });

  it('makes النور تك and نور تك collide (recall-only)', () => {
    expect(normalizeNameLoose('النور تك')).toBe('نور تك');
  });

  it('preserves لل-prefixed tokens', () => {
    expect(normalizeNameLoose('للاسمنت')).toBe('للاسمنت');
  });
});

describe('conjunctionVariants', () => {
  it('strips leading و when the remainder has >= 3 characters', () => {
    expect(conjunctionVariants('وبي تك')).toEqual(['بي تك']);
  });

  it('strips leading و when the remainder exists in the candidate token index', () => {
    const tokenExists = (token: string): boolean => token === 'لي' || token === 'بي';
    expect(conjunctionVariants('ولي', tokenExists)).toEqual(['لي']);
    expect(conjunctionVariants('وبي تك', tokenExists)).toEqual(['بي تك']);
  });
  it('strips leading و when another informative token exists', () => {
    expect(conjunctionVariants('والنور')).toEqual(['النور']);
  });

  it('strips leading و when the remainder exists in the candidate token index', () => {
    const tokenExists = (token: string): boolean => token === 'لي' || token === 'بي';
    expect(conjunctionVariants('ولي', tokenExists)).toEqual(['لي']);
    expect(conjunctionVariants('وبي تك', tokenExists)).toEqual(['بي تك']);
  });

  it('never strips و from a single short token with no other support', () => {
    expect(conjunctionVariants('ولي')).toEqual([]);
    expect(conjunctionVariants('وك')).toEqual([]);
  });

  it('returns empty for queries without و tokens', () => {
    expect(conjunctionVariants('بي تك')).toEqual([]);
  });
});

describe('nameTokens', () => {
  it('splits on whitespace', () => {
    expect(nameTokens('b tech')).toEqual(['b', 'tech']);
  });

  it('drops empty tokens from irregular spacing', () => {
    expect(nameTokens('  a   b  ')).toEqual(['a', 'b']);
  });

  it('returns empty array for empty or blank strings', () => {
    expect(nameTokens('')).toEqual([]);
    expect(nameTokens('   ')).toEqual([]);
  });
});

describe('trigrams', () => {
  it('produces padded character trigrams', () => {
    expect(trigrams('abc')).toEqual(new Set(['  a', ' ab', 'abc', 'bc ']));
  });

  it('short tokens share a trigram with near neighbors', () => {
    expect(trigrams('conect').size).toBeGreaterThan(0);
  });
});

describe('levenshtein', () => {
  it('computes classic kitten/sitting distance of 3', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('returns 0 for equal strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('', '')).toBe(0);
  });

  it('handles empty vs non-empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('is symmetric', () => {
    expect(levenshtein('flaw', 'lawn')).toBe(2);
    expect(levenshtein('lawn', 'flaw')).toBe(2);
  });
});

describe('detectInputKind — boundaries', () => {
  it.each([
    '123456789',
    '+123456789',
    '0012345678',
    '0123456789',
    '+20 100 000 0000',
  ])('detects phone for %s', (input) => {
    expect(detectInputKind(input)).toBe('phone');
  });

  it.each([
    '12345678',
    '',
    '   ',
    '!!!',
    '😀😀😀',
    'شركة بي تك 123',
    'محمد 0100',
  ])('treats %s as a name', (input) => {
    expect(detectInputKind(input)).toBe('name');
  });

  it('treats an 8-digit string as a name and a 9-digit string as phone', () => {
    expect(detectInputKind('12345678')).toBe('name');
    expect(detectInputKind('123456789')).toBe('phone');
  });
});
