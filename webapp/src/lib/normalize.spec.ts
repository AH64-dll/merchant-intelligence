import { describe, expect, it } from 'vitest';
import {
  detectInputKind,
  levenshtein,
  nameTokens,
  normalizeName,
  normalizePhone,
  normalizeQueryUrl,
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
  ])('detects url for %s', (input) => {
    expect(detectInputKind(input)).toBe('url');
  });

  it('treats digit strings shorter than 9 digits as names', () => {
    expect(detectInputKind('12345678')).toBe('name');
  });

  it.each(['B.TECH', 'شركة بي تك', 'محمد أحمد للتوريدات', 'example shop'])(
    'detects name for %s',
    (input) => {
      expect(detectInputKind(input)).toBe('name');
    },
  );

  it('returns name for empty input', () => {
    expect(detectInputKind('')).toBe('name');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['01000000000', '+201000000000'],
    ['+20 100 000 0000', '+201000000000'],
    ['00201000000000', '+201000000000'],
    ['201000000000', '+201000000000'],
    ['(+20) 100-000-0000', '+201000000000'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('normalizes landline local form', () => {
    expect(normalizePhone('0223456789')).toBe('+20223456789');
  });

  it('rejects non-Egyptian prefixes', () => {
    expect(normalizePhone('+14155551234')).toBeNull();
    expect(normalizePhone('971501234567')).toBeNull();
    expect(normalizePhone('447911123456')).toBeNull();
  });

  it('rejects too-short digit strings', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('01000')).toBeNull();
    expect(normalizePhone('20')).toBeNull();
  });

  it('rejects input without digits', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('--')).toBeNull();
  });
  it('rejects invalid Egyptian number shapes', () => {
    expect(normalizePhone('0100000000')).toBeNull();
    expect(normalizePhone('010000000000')).toBeNull();
    expect(normalizePhone('01300000000')).toBeNull();
    expect(normalizePhone('0999')).toBeNull();
  });
});

describe('normalizeQueryUrl', () => {
  it('normalizes facebook http url with trailing slash, preserving handle case', () => {
    expect(normalizeQueryUrl('http://facebook.com/B.TECH.Egypt/')).toEqual({
      kind: 'facebook',
      normalized: 'http://facebook.com/B.TECH.Egypt',
      hostKey: 'facebook.com',
    });
  });

  it('strips www and query from https facebook urls', () => {
    expect(normalizeQueryUrl('https://www.facebook.com/B.TECH.Egypt?x=1')).toEqual({
      kind: 'facebook',
      normalized: 'http://facebook.com/B.TECH.Egypt',
      hostKey: 'facebook.com',
    });
  });

  it('parses bare facebook host+handle input', () => {
    expect(normalizeQueryUrl('facebook.com/B.TECH.Egypt')).toEqual({
      kind: 'facebook',
      normalized: 'http://facebook.com/B.TECH.Egypt',
      hostKey: 'facebook.com',
    });
  });

  it('lowercases instagram handles on https', () => {
    expect(normalizeQueryUrl('https://Instagram.com/SomeShop')).toEqual({
      kind: 'instagram',
      normalized: 'https://instagram.com/someshop',
      hostKey: 'instagram.com',
    });
  });

  it('preserves tiktok @handle', () => {
    expect(normalizeQueryUrl('https://www.tiktok.com/@my.shop')).toEqual({
      kind: 'tiktok',
      normalized: 'https://tiktok.com/@my.shop',
      hostKey: 'tiktok.com',
    });
  });

  it('prepends @ to bare tiktok handles', () => {
    expect(normalizeQueryUrl('tiktok.com/myshop')).toEqual({
      kind: 'tiktok',
      normalized: 'https://tiktok.com/@myshop',
      hostKey: 'tiktok.com',
    });
  });

  it('maps g.page to google_maps with full path handle', () => {
    expect(normalizeQueryUrl('https://g.page/r/AbCd123/review')).toEqual({
      kind: 'google_maps',
      normalized: 'https://g.page/r/AbCd123/review',
      hostKey: 'g.page',
    });
  });

  it('treats bare domains as website with host-only key', () => {
    expect(normalizeQueryUrl('example.com')).toEqual({
      kind: 'website',
      normalized: 'http://example.com',
      hostKey: 'example.com',
    });
  });

  it('drops path and query from arbitrary websites, keeping scheme and stripping www', () => {
    expect(normalizeQueryUrl('https://www.castle.eg/products/x?id=1')).toEqual({
      kind: 'website',
      normalized: 'https://castle.eg',
      hostKey: 'castle.eg',
    });
    expect(normalizeQueryUrl('http://ahw.store/')).toEqual({
      kind: 'website',
      normalized: 'http://ahw.store',
      hostKey: 'ahw.store',
    });
  });
  it('falls back to website when a known host has no path segment', () => {
    expect(normalizeQueryUrl('https://www.facebook.com')).toEqual({
      kind: 'website',
      normalized: 'https://facebook.com',
      hostKey: 'facebook.com',
    });
  });

  it('returns null for unparseable input', () => {
    expect(normalizeQueryUrl('not a url')).toBeNull();
    expect(normalizeQueryUrl('')).toBeNull();
    expect(normalizeQueryUrl('localhost')).toBeNull();
  });

  it('normalizes real goo.gl maps shortlinks to google_maps verbatim', () => {
    expect(normalizeQueryUrl('https://goo.gl/maps/BbZuAKqi75232WJZ8')).toEqual({
      kind: 'google_maps',
      normalized: 'https://goo.gl/maps/BbZuAKqi75232WJZ8',
      hostKey: 'goo.gl',
    });
  });

  it('normalizes maps.app.goo.gl shortlinks, stripping query and trailing slash', () => {
    expect(normalizeQueryUrl('https://maps.app.goo.gl/maps/AbCd123/?g_st=ic')).toEqual({
      kind: 'google_maps',
      normalized: 'https://maps.app.goo.gl/maps/AbCd123',
      hostKey: 'goo.gl',
    });
  });

  it('detects bare goo.gl shortlink input as url', () => {
    expect(detectInputKind('goo.gl/maps/BbZuAKqi75232WJZ8')).toBe('url');
  });
});

describe('normalizeName', () => {
  it('maps punctuation to spaces and lowercases', () => {
    expect(normalizeName('B.TECH')).toBe('b tech');
    expect(normalizeName('B-TECH_Trading, Co (EG) | Store')).toBe('b tech trading co eg store');
  });

  it('converts taa marbuta to haa', () => {
    expect(normalizeName('شركة بي تك')).toBe('شركه بي تك');
  });

  it('normalizes the full Arabic company example', () => {
    expect(normalizeName('شركة بي تك للتجارة والتوزيع')).toBe('شركه بي تك للتجاره والتوزيع');
  });

  it('strips Arabic diacritics U+064B-U+0652 and U+0670', () => {
    expect(normalizeName('مَحَمَّد أَحْمَد')).toBe('محمد احمد');
    expect(normalizeName('هدىٰ')).toBe('هدي');
  });

  it('unifies alef variants to bare alef', () => {
    expect(normalizeName('أحمد إبراهيم آدم')).toBe('احمد ابراهيم ادم');
  });

  it('unifies alef maqsura to yaa', () => {
    expect(normalizeName('على')).toBe('علي');
  });

  it('removes leading definite article per token', () => {
    expect(normalizeName('الاهلي')).toBe('اهلي');
    expect(normalizeName('شركة الأهلي للإسمنت')).toBe('شركه اهلي للاسمنت');
  });

  it('collapses whitespace', () => {
    expect(normalizeName('   B.TECH   Trading   ')).toBe('b tech trading');
    expect(normalizeName('\tشركة\t\tبي تك\n')).toBe('شركه بي تك');
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
    'http://example.com',
    'https://example.com/x',
    'www.example.com',
    'facebook.com/some.page',
    'FACEBOOK.COM/some.page',
    'instagram.com/someshop',
    'tiktok.com/@someshop',
    'g.page/r/ABC123',
    'goo.gl/maps/BbZuAKqi75232WJZ8',
  ])('detects url for %s', (input) => {
    expect(detectInputKind(input)).toBe('url');
  });

  it.each([
    ['12345678'],
    [''],
    ['   '],
    ['!!!'],
    ['😀😀😀'],
    ['شركة بي تك 123'],
    ['محمد 0100'],
  ])('treats %s as a name', (input) => {
    expect(detectInputKind(input)).toBe('name');
  });

  it('treats an 8-digit string as a name and a 9-digit string as phone', () => {
    expect(detectInputKind('12345678')).toBe('name');
    expect(detectInputKind('123456789')).toBe('phone');
  });
});

describe('normalizePhone — exhaustive matrix', () => {
  it.each([
    // mobile prefixes in local 01 form
    ['01000000000', '+201000000000'],
    ['01100000000', '+201100000000'],
    ['01200000000', '+201200000000'],
    ['01500000000', '+201500000000'],
    // international forms
    ['+201000000000', '+201000000000'],
    ['00201000000000', '+201000000000'],
    ['201000000000', '+201000000000'],
    // spaced / dashed / parenthesized formatting
    ['+20 100 000 0000', '+201000000000'],
    ['(+20) 100-000-0000', '+201000000000'],
    ['0100-000-0000', '+201000000000'],
    ['(0100) 000 0000', '+201000000000'],
    // landline: Cairo 02
    ['0223456789', '+20223456789'],
    ['+20223456789', '+20223456789'],
    ['20223456789', '+20223456789'],
    // landline: Upper Egypt 09x area codes
    ['0951234567', '+20951234567'],
    ['0961234567', '+20961234567'],
    ['0971234567', '+20971234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['+14155551234'],
    ['971501234567'],
    ['447911123456'],
    ['972501234567'],
  ])('rejects non-Egyptian number %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['--'],
    ['12345'],
    ['01000'],
    ['20'],
    ['0100000000'],
    ['010000000000'],
    ['01300000000'],
    ['0999'],
    ['010000000001'],
    ['00201000000000000'],
  ])('returns null for %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('strips surrounding letters and punctuation before validating digits', () => {
    expect(normalizePhone('اتصل: 01000000000')).toBe('+201000000000');
    expect(normalizePhone('tel:+201000000000')).toBe('+201000000000');
  });

  it('rejects when extra digits sneak in around letters', () => {
    expect(normalizePhone('01000000000a1')).toBeNull();
  });
});

describe('normalizeQueryUrl — exhaustive matrix', () => {
  it.each([
    // facebook happy path + case variants + stripping
    ['http://facebook.com/B.TECH.Egypt/', 'facebook', 'http://facebook.com/B.TECH.Egypt', 'facebook.com'],
    ['HTTPS://WWW.FACEBOOK.COM/HANDLE', 'facebook', 'http://facebook.com/HANDLE', 'facebook.com'],
    ['m.facebook.com/Page.Name?q=1#top', 'facebook', 'http://facebook.com/Page.Name', 'facebook.com'],
    ['facebook.com/Shop#fragment', 'facebook', 'http://facebook.com/Shop', 'facebook.com'],
    // instagram lowercasing
    ['https://Instagram.com/SomeShop', 'instagram', 'https://instagram.com/someshop', 'instagram.com'],
    ['instagram.com/UPPERcase#frag', 'instagram', 'https://instagram.com/uppercase', 'instagram.com'],
    // tiktok @ insertion
    ['tiktok.com/myshop', 'tiktok', 'https://tiktok.com/@myshop', 'tiktok.com'],
    ['https://www.tiktok.com/@my.shop?lang=ar', 'tiktok', 'https://tiktok.com/@my.shop', 'tiktok.com'],
    // g.page
    ['https://g.page/r/AbCd123/review', 'google_maps', 'https://g.page/r/AbCd123/review', 'g.page'],
    ['g.page/ikelvinatorr', 'google_maps', 'https://g.page/ikelvinatorr', 'g.page'],
    // shortlinks
    ['https://goo.gl/maps/BbZuAKqi75232WJZ8', 'google_maps', 'https://goo.gl/maps/BbZuAKqi75232WJZ8', 'goo.gl'],
    ['https://maps.app.goo.gl/maps/AbCd123/?g_st=ic', 'google_maps', 'https://maps.app.goo.gl/maps/AbCd123', 'goo.gl'],
    // unknown-host website branch incl. path dropping, ports, scheme preservation
    ['example.com', 'website', 'http://example.com', 'example.com'],
    ['https://www.castle.eg/products/x?id=1#reviews', 'website', 'https://castle.eg', 'castle.eg'],
    ['http://ahw.store/', 'website', 'http://ahw.store', 'ahw.store'],
    ['http://Example.COM:8080/path', 'website', 'http://example.com', 'example.com'],
  ])('normalizes %j', (input, kind, normalized, hostKey) => {
    expect(normalizeQueryUrl(input)).toEqual({ kind, normalized, hostKey });
  });

  it.each([
    ['not a url'],
    [''],
    ['   '],
    ['localhost'],
    ['http://'],
  ])('returns null for unparseable input %j', (input) => {
    expect(normalizeQueryUrl(input)).toBeNull();
  });

  it('falls back to website for known hosts with no path segment', () => {
    expect(normalizeQueryUrl('https://www.facebook.com')).toEqual({
      kind: 'website',
      normalized: 'https://facebook.com',
      hostKey: 'facebook.com',
    });
    expect(normalizeQueryUrl('g.page')).toEqual({
      kind: 'website',
      normalized: 'http://g.page',
      hostKey: 'g.page',
    });
  });

  it('falls back to website for shortlink hosts outside /maps/ paths', () => {
    expect(normalizeQueryUrl('https://goo.gl/someOtherThing')).toEqual({
      kind: 'website',
      normalized: 'https://goo.gl',
      hostKey: 'goo.gl',
    });
  });
});

describe('normalizeName — full Arabic matrix', () => {
  it('maps every punctuation-class character to a space', () => {
    expect(normalizeName('a.b_c-d/e,f(g)h|i')).toBe('a b c d e f g h i');
  });

  it('strips diacritics across the whole U+064B-U+0652 range plus U+0670', () => {
    expect(normalizeName('مُنْتَجَات ٱلْمَصْنَع')).not.toMatch(/[\u064B-\u0652\u0670]/);
    expect(normalizeName('هدىٰ')).toBe('هدي');
  });

  it('unifies alef variants, alef maqsura and taa marbuta', () => {
    expect(normalizeName('أحمد إبراهيم آدم على شركة')).toBe('احمد ابراهيم ادم علي شركه');
  });

  it('removes leading ال per token; لل-prefixed tokens keep their article', () => {
    expect(normalizeName('الاهلي النادي')).toBe('اهلي نادي');
    expect(normalizeName('شركة الأهلي للإسمنت')).toBe('شركه اهلي للاسمنت');
  });

  it('drops a token that is only ال entirely', () => {
    expect(normalizeName('ال')).toBe('');
    expect(normalizeName('الأهلي ال')).toBe('اهلي');
  });

  it('preserves tatweel U+0640 (not a diacritic)', () => {
    expect(normalizeName('شــركة')).toBe('شــركه');
  });

  it('handles mixed Arabic/Latin input', () => {
    expect(normalizeName('B.TECH بي تك')).toBe('b tech بي تك');
  });

  it('returns empty string for empty, blank, punctuation-only or article-only input', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('.,-')).toBe('');
    expect(normalizeName('ال ال')).toBe('');
  });
});

describe('levenshtein — classic matrix', () => {
  it.each([
    ['kitten', 'sitting', 3],
    ['flaw', 'lawn', 2],
    ['abc', 'abc', 0],
    ['', '', 0],
    ['', 'abc', 3],
    ['abc', '', 3],
    ['abcdef', 'azced', 3],
    ['saturday', 'sunday', 3],
    ['a', 'b', 1],
    ['conect', 'connect', 1],
  ])('distance(%j, %j) = %j and is symmetric', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
    expect(levenshtein(b, a)).toBe(expected);
  });
});
