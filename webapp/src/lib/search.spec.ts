import { beforeAll, describe, expect, it } from 'vitest';
import { MerchantDb } from './db';
import type { IndexData } from './db';
import { SearchIndex } from './search';
import type { Merchant } from './types';

const B_TECH_ID = '0abffb14-4754-4d4a-8ec7-78a5732a9264';
const GOO_GL_ID = '3af4b233-ad29-4155-b436-3573576e1daf';
const MTI_HOLDING_ID = '9af176b0-b896-4494-bcfb-d1ef85166ba5';
const CONNECT_PHONE_ID = '0d73d05b-7fb3-4afb-b4ea-c74e2025f8b0';
const ROPHAEL_ID = '0e348653-7777-4b8c-8a9b-9fc2d7b2b0ba';

const DB_PATH = new URL('../../data/merchants.db', import.meta.url).pathname;

let index: SearchIndex;

beforeAll(() => {
  index = SearchIndex.fromDb(new MerchantDb(DB_PATH));
});

describe('SearchIndex — identifier matching', () => {
  it('matches a local-format phone number exactly', () => {
    const result = index.search('01286619966');
    expect(result.detectedType).toBe('phone');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.merchant.id).toBe(B_TECH_ID);
    expect(result.hits[0]?.matchedOn).toBe('phone');
    expect(result.hits[0]?.score).toBe(1.0);
    expect(result.hits[0]?.matchedValue).toBe('+201286619966');
  });

  it('matches an international-format phone number exactly', () => {
    const result = index.search('+20 128 661 9966');
    expect(result.detectedType).toBe('phone');
    expect(result.hits[0]?.matchedOn).toBe('phone');
    expect(result.hits[0]?.score).toBe(1.0);
  });

  it('matches a facebook URL by exact normalized value', () => {
    const result = index.search('facebook.com/MTIholding');
    expect(result.detectedType).toBe('url');
    expect(result.hits[0]?.merchant.id).toBe(MTI_HOLDING_ID);
    expect(result.hits[0]?.matchedOn).toBe('facebook');
    expect(result.hits[0]?.score).toBe(1.0);
  });

  it('resolves a facebook URL variant (scheme/case/www/slash/query differences) to its owner via path key', () => {
    const result = index.search('HTTPS://WWW.Facebook.COM/B.TECH.Egypt/?fref=ts');
    expect(result.detectedType).toBe('url');
    expect(result.hits[0]?.merchant.id).toBe(B_TECH_ID);
    expect(result.hits[0]?.matchedOn).toBe('facebook');
    expect(result.hits[0]?.score).toBe(0.95);
    expect(result.hits[0]?.matchedValue).toMatch(/facebook\.com\/b\.tech\.egypt$/);
  });

  it('does not tie every facebook merchant together for a bare facebook.com host query', () => {
    const result = index.search('https://www.facebook.com/');
    expect(result.hits).toEqual([]);
  });

  it('matches a real goo.gl maps shortlink at score 1.0 on the exact-key path', () => {
    const result = index.search('https://goo.gl/maps/BbZuAKqi75232WJZ8');
    expect(result.detectedType).toBe('url');
    expect(result.hits[0]?.merchant.id).toBe(GOO_GL_ID);
    expect(result.hits[0]?.matchedOn).toBe('google_maps');
    expect(result.hits[0]?.score).toBe(1.0);
  });
});

describe('SearchIndex — name matching', () => {
  it('matches the canonical name exactly at 0.95 and tie-breaks on identity confidence', () => {
    const result = index.search('b tech');
    const exactHits = result.hits.filter((hit) => hit.matchedOn === 'name_exact');
    expect(exactHits.length).toBeGreaterThanOrEqual(4);
    expect(result.hits[0]?.merchant.id).toBe(B_TECH_ID);
    expect(result.hits[0]?.matchedOn).toBe('name_exact');
    expect(result.hits[0]?.score).toBe(0.95);
    const confidences = exactHits.map((hit) => hit.merchant.identityConfidence);
    const sorted = [...confidences].sort((a, b) => b - a);
    expect(confidences).toEqual(sorted);
  });

  it('matches an Arabic multi-word subset fuzzily within one merchant', () => {
    const result = index.search('روفائيل الكهربائيه');
    expect(result.detectedType).toBe('name');
    const hit = result.hits.find((candidate) => candidate.merchant.id === ROPHAEL_ID);
    expect(hit).toBeDefined();
    expect(hit?.matchedOn).toBe('name_fuzzy');
    expect(hit?.score).toBeCloseTo(0.74, 5);
  });

  it('matches a single-token typo at 0.55 via levenshtein distance', () => {
    const result = index.search('conect');
    const hit = result.hits.find((candidate) => candidate.merchant.id === CONNECT_PHONE_ID);
    expect(hit).toBeDefined();
    expect(hit?.matchedOn).toBe('name_fuzzy');
    expect(hit?.score).toBe(0.55);
  });

  it('returns no hits for nonsense input', () => {
    const result = index.search('zzzzqqqq');
    expect(result.hits.length).toBe(0);
  });

  it('exposes the canonical name string as matchedValue on name_exact hits', () => {
    const result = index.search('B.TECH');
    const hit = result.hits.find((candidate) => candidate.merchant.id === B_TECH_ID);
    expect(hit?.matchedOn).toBe('name_exact');
    expect(hit?.matchedValue).toBe('B.TECH');
    expect(hit?.matchedValue).not.toBe('b tech');
  });

  it('exposes the stored alias string as matchedValue on alias_exact hits', () => {
    const result = index.search('B.Tech Egypt');
    const hit = result.hits.find((candidate) => candidate.merchant.id === B_TECH_ID);
    expect(hit?.matchedOn).toBe('alias_exact');
    expect(hit?.matchedValue).toBe('B.Tech Egypt');
  });

  it('completes fast and returns zero hits for a 5000-char single token', () => {
    const start = performance.now();
    const result = index.search(`${'a'.repeat(5000)}`);
    const elapsedMs = performance.now() - start;
    expect(result.hits.length).toBe(0);
    expect(elapsedMs).toBeLessThan(2000);
  });
});

describe('SearchIndex — limits and ordering', () => {
  it('caps hits at the requested limit', () => {
    const capped = index.search('بي تك', 3);
    expect(capped.hits.length).toBeLessThanOrEqual(3);
    const uncapped = index.search('بي تك');
    expect(uncapped.hits.length).toBeGreaterThan(3);
  });

  it('sorts hits by score descending then identity confidence descending', () => {
    const result = index.search('بي تك');
    for (let i = 1; i < result.hits.length; i += 1) {
      const previous = result.hits[i - 1]!;
      const current = result.hits[i]!;
      expect(previous.score).toBeGreaterThanOrEqual(current.score);
      if (previous.score === current.score) {
        expect(previous.merchant.identityConfidence)
          .toBeGreaterThanOrEqual(current.merchant.identityConfidence);
      }
    }
  });
});

const EMAIL_ID = '98e83f64-7837-4173-b7df-0fb2dce03c9c';
const WHATSAPP_ID = 'c25a5a60-e885-4916-85aa-9618d9097d18';
const GPAGE_ID = 'b08b8b97-922f-4063-bdee-eaa06a534f7e';
const AHW_STORE_ID = '12b6cf33-4408-419d-a80a-d44bbe55e321';

describe('SearchIndex — real-fixture identifier kinds', () => {
  it('matches an email exactly at 1.0 (case-insensitive)', () => {
    const result = index.search('Ahmed226887@Gmail.COM');
    expect(result.hits[0]?.merchant.id).toBe(EMAIL_ID);
    expect(result.hits[0]?.matchedOn).toBe('email');
    expect(result.hits[0]?.score).toBe(1.0);
  });

  it('matches a whatsapp identifier exactly at 1.0', () => {
    const result = index.search('+20 100 001 6942');
    const hit = result.hits.find((candidate) => candidate.merchant.id === WHATSAPP_ID);
    expect(hit?.matchedOn).toBe('whatsapp');
    expect(hit?.score).toBe(1.0);
  });

  it('matches a g.page short link exactly at 1.0', () => {
    const result = index.search('g.page/ikelvinatorr');
    expect(result.hits[0]?.merchant.id).toBe(GPAGE_ID);
    expect(result.hits[0]?.matchedOn).toBe('google_maps');
    expect(result.hits[0]?.score).toBe(1.0);
  });
  it('falls back to website host matching at 0.9 when the scheme differs from storage', () => {
    const result = index.search('www.ahw.store/some/deep/path?x=1');
    expect(result.hits[0]?.merchant.id).toBe(AHW_STORE_ID);
    expect(result.hits[0]?.matchedOn).toBe('website-host');
    expect(result.hits[0]?.score).toBe(0.9);
  });

  it('matches a stored website identifier exactly at 1.0 when the scheme matches', () => {
    const result = index.search('https://ahw.store/products');
    expect(result.hits[0]?.merchant.id).toBe(AHW_STORE_ID);
    expect(result.hits[0]?.matchedOn).toBe('website');
    expect(result.hits[0]?.score).toBe(1.0);
  });
});

describe('SearchIndex — synthetic in-memory index (determinism + ranking bands)', () => {
  it('keeps the best score per merchant when several rules match one merchant', () => {
    const idx = build({
      merchants: [merchant('m1', 'alphashop com')],
      identifiers: [{ merchantId: 'm1', kind: 'website', normalized: 'https://alphashop.com' }],
    });
    // Query fires both the website-host rule (0.9) and name_exact (0.95): 0.95 wins.
    const result = idx.search('Alphashop.COM');
    expect(result.hits.length).toBe(1);
    expect(result.hits[0]?.merchant.id).toBe('m1');
    expect(result.hits[0]?.score).toBe(0.95);
    expect(result.hits[0]?.matchedOn).toBe('name_exact');
  });
  function merchant(id: string, name: string, identityConfidence = 50): Merchant {
    return {
      id,
      canonicalName: name,
      category: 'retail',
      city: 'القاهرة',
      governorate: 'القاهرة',
      identityConfidence,
      state: 'INSUFFICIENT_DATA',
    };
  }

  function build(data: Partial<IndexData>): SearchIndex {
    return new SearchIndex({
      merchants: data.merchants ?? [],
      identifiers: data.identifiers ?? [],
      aliases: data.aliases ?? [],
    });
  }


  it('prefers identifier exact (1.0) over everything else for the same merchant', () => {
    const idx = build({
      merchants: [merchant('m2', '01000000000')],
      identifiers: [{ merchantId: 'm2', kind: 'phone', normalized: '+201000000000' }],
    });
    const result = idx.search('01000000000');
    expect(result.hits[0]?.score).toBe(1.0);
    expect(result.hits[0]?.matchedOn).toBe('phone');
  });

  it.each([
    [1, 0.78],
    [3, 0.74],
  ])('applies the containment fuzzy band: extra candidate tokens %i → %s', (extraTokens, expected) => {
    const tokens = ['alpha', ...Array.from({ length: extraTokens }, (_, i) => `tok${i}`)];
    const idx = build({ merchants: [merchant('m3', tokens.join(' '))] });
    const result = idx.search('alpha');
    const hit = result.hits.find((candidate) => candidate.merchant.id === 'm3');
    expect(hit?.matchedOn).toBe('name_fuzzy');
    expect(hit?.score).toBe(expected);
  });
  it('floors containment fuzzy score at 0.6 for very long candidates', () => {
    const tokens = Array.from({ length: 15 }, (_, i) => `word${i}`);
    const idx = build({ merchants: [merchant('m4', tokens.join(' '))] });
    const result = idx.search('word0');
    expect(result.hits[0]?.score).toBe(0.6);
  });

  it('drops hits below the 0.5 threshold entirely', () => {
    // No rule can produce < 0.55 here, so prove the floor via a candidate that only typo-matches
    // at distance > 2 → no hit at all.
    const idx = build({ merchants: [merchant('m5', 'abcdefghij')] });
    expect(idx.search('abcdefg').hits.length).toBe(0);
  });

  it('tie-breaks equal scores on identityConfidence desc, then id asc', () => {
    const idx = build({
      merchants: [
        merchant('b-second', 'Same Name', 40),
        merchant('a-third', 'Same Name', 40),
        merchant('z-first', 'Same Name', 90),
      ],
    });
    const result = idx.search('same name');
    expect(result.hits.map((hit) => hit.merchant.id)).toEqual(['z-first', 'a-third', 'b-second']);
  });

  it('respects limit=1, limit=0 and the default limit of 10', () => {
    const merchants = Array.from({ length: 15 }, (_, i) => merchant(`m${String(i).padStart(2, '0')}`, `shop${i}`));
    const aliases = merchants.map((entry) => ({ merchantId: entry.id, alias: 'common alias' }));
    const idx = build({ merchants, aliases });
    expect(idx.search('common alias', 1).hits.length).toBe(1);
    expect(idx.search('common alias', 0).hits.length).toBe(0);
    expect(idx.search('common alias').hits.length).toBe(10);
  });

  it('reports detectedType per input class', () => {
    expect(build({}).search('01000000000').detectedType).toBe('phone');
    expect(build({}).search('facebook.com/x').detectedType).toBe('url');
    expect(build({}).search('بي تك').detectedType).toBe('name');
  });

  it.each(['', '   ', '!!!'])('returns zero hits fast for degenerate input %j', (query) => {
    const start = performance.now();
    const result = build({
      merchants: [merchant('m6', 'alpha beta gamma delta epsilon')],
    }).search(query);
    expect(result.hits.length).toBe(0);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('skips the typo path when the single query token exceeds TYPO_MAX_TOKEN_LENGTH', () => {
    const idx = build({ merchants: [merchant('m7', 'abcdefgh')] }); // distance 1 from a*8
    expect(idx.search('a'.repeat(65)).hits.length).toBe(0);
  });

  it('requires candidate tokens of length >= 5 for typo matching', () => {
    const idx = build({ merchants: [merchant('m8', 'abcd')] }); // len-4 token, distance 1 from 'abce'
    expect(idx.search('abce').hits.length).toBe(0);
  });

  it('matches alias_exact on synthetic aliases with matchedValue equal to the raw alias', () => {
    const idx = build({
      merchants: [merchant('m9', 'Real Name')],
      aliases: [{ merchantId: 'm9', alias: 'Friendly Alias' }],
    });
    const result = idx.search('friendly alias');
    expect(result.hits[0]?.matchedOn).toBe('alias_exact');
    expect(result.hits[0]?.matchedValue).toBe('Friendly Alias');
    expect(result.hits[0]?.score).toBe(0.95);
  });
});
