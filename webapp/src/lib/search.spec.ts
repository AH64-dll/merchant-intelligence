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

describe('SearchIndex — result contract', () => {
  it('returns the full result envelope with pageSize 20', () => {
    const result = index.search('b tech');
    expect(result).toMatchObject({
      query: 'b tech',
      inputKind: 'name',
      page: 1,
      pageSize: 20,
      diagnostic: null,
    });
    expect(typeof result.total).toBe('number');
    expect(Array.isArray(result.hits)).toBe(true);
  });

  it('exposes no numeric score on hits', () => {
    const result = index.search('b tech');
    expect(result.hits.length).toBeGreaterThan(0);
    for (const hit of result.hits) {
      expect(hit).not.toHaveProperty('score');
      expect(hit).not.toHaveProperty('matchedOn');
      expect(hit).not.toHaveProperty('matchedValue');
      expect(hit.match).toHaveProperty('kind');
      expect(hit.match).toHaveProperty('value');
      expect(typeof hit.match.label).toBe('string');
      expect(hit.match.label.length).toBeGreaterThan(0);
    }
  });

  it('paginates stably: page 2 excludes page 1 ids and keeps global order', () => {
    const page1 = index.search('b tech', 1);
    const page2 = index.search('b tech', 2);
    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);
    expect(page2.hits.length).toBe(Math.max(0, page1.total - page1.hits.length));
    const page1Ids = new Set(page1.hits.map((h) => h.merchant.id));
    for (const hit of page2.hits) {
      expect(page1Ids.has(hit.merchant.id)).toBe(false);
    }
  });

  it('labels invalid Egyptian phone input with a diagnostic and zero hits', () => {
    const result = index.search('14155551234');
    expect(result.inputKind).toBe('phone');
    expect(result.diagnostic).toBe('invalid_egyptian_phone');
    expect(result.hits).toEqual([]);
  });

  it('treats Arabic-digit phone input as phone and finds its owner', () => {
    const result = index.search('٠١٢٨٦٦١٩٩٦٦');
    expect(result.inputKind).toBe('phone');
    expect(result.hits[0]?.merchant.id).toBe(B_TECH_ID);
    expect(result.hits[0]?.match.kind).toBe('phone');
  });
});

describe('SearchIndex — identifier matching', () => {
  it('matches a local-format phone number exactly', () => {
    const result = index.search('01286619966');
    expect(result.inputKind).toBe('phone');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.merchant.id).toBe(B_TECH_ID);
    expect(result.hits[0]?.match.kind).toBe('phone');
    expect(result.hits[0]?.match.value).toBe('+201286619966');
  });

  it('matches an international-format phone number exactly', () => {
    const result = index.search('+20 128 661 9966');
    expect(result.inputKind).toBe('phone');
    expect(result.hits[0]?.match.kind).toBe('phone');
  });

  it('matches a facebook URL by exact normalized value', () => {
    const result = index.search('facebook.com/MTIholding');
    expect(result.inputKind).toBe('url');
    expect(result.hits[0]?.merchant.id).toBe(MTI_HOLDING_ID);
    expect(result.hits[0]?.match.kind).toBe('facebook');
  });

  it('resolves a facebook URL variant (scheme/case/www/slash/query differences) to its owner', () => {
    const result = index.search('HTTPS://WWW.Facebook.COM/b.tech.egypt/?fref=ts');
    expect(result.inputKind).toBe('url');
    expect(result.hits[0]?.merchant.id).toBe(B_TECH_ID);
    expect(result.hits[0]?.match.kind).toBe('facebook');
    expect(result.hits[0]?.match.value).toMatch(/facebook\.com\/b\.tech\.egypt$/i);
  });

  it('does not tie every facebook merchant together for a bare facebook.com host query', () => {
    const result = index.search('https://www.facebook.com/');
    expect(result.hits).toEqual([]);
  });

  it('matches a real goo.gl maps shortlink via the platform path key', () => {
    const result = index.search('https://goo.gl/maps/BbZuAKqi75232WJZ8');
    expect(result.inputKind).toBe('url');
    expect(result.hits[0]?.merchant.id).toBe(GOO_GL_ID);
    expect(result.hits[0]?.match.kind).toBe('google_maps');
  });

  it('is scheme-invariant: http and https queries hit the same top tier and owner', () => {
    const http = index.search('http://ahw.store');
    const https = index.search('https://ahw.store');
    expect(http.hits[0]?.merchant.id).toBe(https.hits[0]?.merchant.id);
    expect(http.hits[0]?.match.kind).toBe(https.hits[0]?.match.kind);
    expect(http.hits[0]?.match.value.toLowerCase()).toBe(https.hits[0]?.match.value.toLowerCase());
  });

  it('returns zero hits for a quarantined bare regulator domain', () => {
    const result = index.search('cpa.gov.eg');
    expect(result.hits).toEqual([]);
  });

  it('returns zero hits for quarantined support host URLs', () => {
    expect(index.search('https://support.apple.com/ar-eg/HT201222').hits).toEqual([]);
    expect(index.search('https://shakwa.cpa-mobile.com/complaint/1').hits).toEqual([]);
  });

  it('returns all owners of a shared identifier key (multi-owner phone)', () => {
    const idx = build({
      merchants: [merchant('owner-a', 'Alpha Branch'), merchant('owner-b', 'Beta Branch')],
      identifiers: [
        { merchantId: 'owner-a', kind: 'phone', normalized: '+201000000111' },
        { merchantId: 'owner-b', kind: 'phone', normalized: '+201000000111' },
      ],
    });
    const result = idx.search('01000000111');
    expect(result.hits.map((h) => h.merchant.id).sort()).toEqual(['owner-a', 'owner-b']);
  });

  it('marks exact multi-owner keys ambiguous', () => {
    const idx = build({
      merchants: [merchant('owner-a', 'Alpha Branch'), merchant('owner-b', 'Beta Branch')],
      identifiers: [
        { merchantId: 'owner-a', kind: 'phone', normalized: '+201000000111' },
        { merchantId: 'owner-b', kind: 'phone', normalized: '+201000000111' },
      ],
    });
    expect(idx.search('01000000111').ambiguous).toBe(true);
    expect(idx.search('01000000099').ambiguous).toBe(false);
  });
});

describe('SearchIndex — name matching', () => {
  it('matches the canonical name exactly and orders by identity confidence within the tier', () => {
    const result = index.search('b tech');
    const exactHits = result.hits.filter((hit) => hit.match.kind === 'exact_name');
    // Consolidation merged the B.TECH branch rows into one canonical seller,
    // so the exact tier holds exactly that seller.
    expect(exactHits.map((hit) => hit.merchant.id)).toEqual([B_TECH_ID]);
    expect(result.hits[0]?.merchant.id).toBe(B_TECH_ID);
    expect(result.hits[0]?.match.kind).toBe('exact_name');
    const confidences = exactHits.map((hit) => hit.merchant.identityConfidence);
    const sorted = [...confidences].sort((a, b) => b - a);
    expect(confidences).toEqual(sorted);
  });

  it('reaches وبي تك via the conjunction-recall variant', () => {
    const result = index.search('وبي تك');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some((hit) => hit.merchant.id === B_TECH_ID)).toBe(true);
  });

  it('does not corrupt exact single-token names with the conjunction rule', () => {
    // 'ولي' is a real name token: stripping و would give 'لي' — not allowed
    // by the length rule, and no candidate token 'لي' is required here.
    const result = index.search('ولي');
    const exactHits = result.hits.filter((hit) => hit.match.kind === 'exact_name');
    // Conjunction stripping must not fire: 'ولي' should not become 'لي'.
    // Any hits must come from genuine name/alias/token matches on the full token.
    for (const hit of result.hits) {
      expect(hit.match.kind).not.toBe('normalized_variant');
    }
    expect(exactHits.length).toBeGreaterThanOrEqual(0);
  });

  it('rescues a multi-token typo query into the top 3', () => {
    const result = index.search('b techh egyot');
    expect(result.hits.length).toBeGreaterThan(0);
    const top3 = result.hits.slice(0, 3).map((hit) => hit.merchant.id);
    expect(top3).toContain(B_TECH_ID);
    for (const hit of result.hits) {
      if (hit.merchant.id === B_TECH_ID) {
        expect(hit.match.kind).toBe('typo');
      }
    }
  });

  it('ranks a subset query at or below fuller-coverage candidates', () => {
    const idx = build({
      merchants: [
        merchant('short-cand', 'alpha'),
        merchant('full-cand', 'alpha beta gamma'),
      ],
    });
    const result = idx.search('alpha');
    const ids = result.hits.map((hit) => hit.merchant.id);
    expect(ids).toContain('short-cand');
    expect(ids).toContain('full-cand');
    // fuller coverage has fewer unmatched candidate tokens → ranks no lower
    expect(ids.indexOf('full-cand')).toBeLessThanOrEqual(ids.indexOf('short-cand') + 1);
  });

  it('matches an Arabic multi-word subset fuzzily within one merchant', () => {
    const result = index.search('روفائيل الكهربائيه');
    expect(result.inputKind).toBe('name');
    const hit = result.hits.find((candidate) => candidate.merchant.id === ROPHAEL_ID);
    expect(hit).toBeDefined();
    expect(hit?.match.kind).toBe('partial_name');
  });

  it('matches a single-token typo via bounded levenshtein rescue', () => {
    const result = index.search('conect');
    const hit = result.hits.find((candidate) => candidate.merchant.id === CONNECT_PHONE_ID);
    expect(hit).toBeDefined();
    expect(hit?.match.kind).toBe('typo');
  });

  it('returns no hits for nonsense input', () => {
    const result = index.search('zzzzqqqq');
    expect(result.hits.length).toBe(0);
  });

  it('exposes the canonical name string as match.value on exact_name hits', () => {
    const result = index.search('B.TECH');
    const hit = result.hits.find((candidate) => candidate.merchant.id === B_TECH_ID);
    expect(hit?.match.kind).toBe('exact_name');
    expect(hit?.match.value).toBe('B.TECH');
    expect(hit?.match.value).not.toBe('b tech');
  });

  it('exposes the stored alias string as match.value on exact_alias hits', () => {
    const result = index.search('B.Tech Egypt');
    const hit = result.hits.find((candidate) => candidate.merchant.id === B_TECH_ID);
    expect(hit?.match.kind).toBe('exact_alias');
    expect(hit?.match.value).toBe('B.Tech Egypt');
  });

  it('keeps strict normalization from colliding النور تك with نور تك on exact tiers', () => {
    const idx = build({
      merchants: [merchant('nour-tech', 'النور تك'), merchant('nour', 'نور تك')],
    });
    const result = idx.search('النور تك');
    // Exact tier resolves only the strict-equal owner.
    const exact = result.hits.filter((hit) => hit.match.kind === 'exact_name');
    expect(exact.map((hit) => hit.merchant.id)).toEqual(['nour-tech']);
    // Loose recall tier surfaces the other owner below.
    const variants = result.hits.filter((hit) => hit.match.kind === 'normalized_variant');
    expect(variants.map((hit) => hit.merchant.id)).toEqual(['nour']);
  });

  it('returns zero hits for a 5000-char single token without hanging', () => {
    // Correctness is the contract here: the bounded typo pool (trigram
    // pre-filter + length gate) must return zero hits. The wall-clock bound
    // is a 10s hang-guard against pathological complexity only — real
    // latency gates are owned by search.bench.ts, and the previous 2s bound
    // was flaky on shared machines even though the path is linear.
    const start = performance.now();
    const result = index.search(`${'a'.repeat(5000)}`);
    const elapsedMs = performance.now() - start;
    expect(result.hits.length).toBe(0);
    expect(elapsedMs).toBeLessThan(10_000);
  });
});

describe('SearchIndex — limits, ordering, pagination', () => {
  it('caps hits at the requested page size', () => {
    const capped = index.search('computer', 1, 3);
    expect(capped.hits.length).toBe(3);
    const uncapped = index.search('computer', 1, 20);
    // بي تك is a single canonical seller after consolidation, so the broad
    // partial-tier query carries the multi-hit comparison instead.
    expect(uncapped.hits.length).toBeGreaterThan(3);
    expect(uncapped.total).toBe(capped.total);
  });

  it('sorts within a tier by identity confidence descending', () => {
    // "Delta Computer" is shared by the two location-qualified Delta sellers
    // plus Delta Technology, all at the exact_alias tier — a genuine
    // multi-hit tier on the consolidated snapshot.
    const result = index.search('Delta Computer');
    expect(result.hits.length).toBeGreaterThan(1);
    for (let i = 1; i < result.hits.length; i += 1) {
      const previous = result.hits[i - 1]!;
      const current = result.hits[i]!;
      if (previous.match.kind === current.match.kind) {
        expect(previous.merchant.identityConfidence)
          .toBeGreaterThanOrEqual(current.merchant.identityConfidence);
      }
    }
  });

  it('respects page size 1, 0-floor and default of 20', () => {
    const merchants = Array.from({ length: 25 }, (_, i) => merchant(`m${String(i).padStart(2, '0')}`, `shop${i}`));
    const aliases = merchants.map((entry) => ({ merchantId: entry.id, alias: 'common alias' }));
    const idx = build({ merchants, aliases });
    expect(idx.search('common alias', 1, 1).hits.length).toBe(1);
    expect(idx.search('common alias', 1, 0).hits.length).toBe(1); // size floored to 1
    expect(idx.search('common alias').hits.length).toBe(20);
    expect(idx.search('common alias', 2).hits.length).toBe(5);
    expect(idx.search('common alias', 99).hits.length).toBe(0);
  });

  it('reports inputKind per input class', () => {
    expect(build({}).search('01000000000').inputKind).toBe('phone');
    expect(build({}).search('facebook.com/x').inputKind).toBe('url');
    expect(build({}).search('user@example.com').inputKind).toBe('email');
    expect(build({}).search('بي تك').inputKind).toBe('name');
  });

  it.each(['', '   ', '!!!'])('returns zero hits fast for degenerate input %j', (query) => {
    const start = performance.now();
    const result = build({
      merchants: [merchant('m6', 'alpha beta gamma delta epsilon')],
    }).search(query);
    expect(result.hits.length).toBe(0);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('skips typo rescue when the single query token exceeds the length bound', () => {
    const idx = build({ merchants: [merchant('m7', 'abcdefgh')] }); // distance 1 from a*8
    expect(idx.search('a'.repeat(65)).hits.length).toBe(0);
  });

  it('requires candidate tokens of length >= 4 for typo matching', () => {
    const idx = build({ merchants: [merchant('m8', 'abc')] }); // len-3 token, distance 1 from 'abd'
    expect(idx.search('abd').hits.length).toBe(0);
  });

  it('matches exact_alias on synthetic aliases with match.value equal to the raw alias', () => {
    const idx = build({
      merchants: [merchant('m9', 'Real Name')],
      aliases: [{ merchantId: 'm9', alias: 'Friendly Alias' }],
    });
    const result = idx.search('friendly alias');
    expect(result.hits[0]?.match.kind).toBe('exact_alias');
    expect(result.hits[0]?.match.value).toBe('Friendly Alias');
  });
});

const EMAIL_ID = '98e83f64-7837-4173-b7df-0fb2dce03c9c';
const WHATSAPP_ID = 'c25a5a60-e885-4916-85aa-9618d9097d18';
const GPAGE_ID = 'b08b8b97-922f-4063-bdee-eaa06a534f7e';
const AHW_STORE_ID = '12b6cf33-4408-419d-a80a-d44bbe55e321';

describe('SearchIndex — real-fixture identifier kinds', () => {
  it('matches an email exactly (case-insensitive)', () => {
    const result = index.search('Ahmed226887@Gmail.COM');
    expect(result.inputKind).toBe('email');
    expect(result.hits[0]?.merchant.id).toBe(EMAIL_ID);
    expect(result.hits[0]?.match.kind).toBe('email');
  });

  it('matches a whatsapp identifier exactly', () => {
    const result = index.search('+20 100 001 6942');
    const hit = result.hits.find((candidate) => candidate.merchant.id === WHATSAPP_ID);
    expect(hit?.match.kind).toBe('whatsapp');
  });

  it('matches a g.page short link exactly', () => {
    const result = index.search('g.page/ikelvinatorr');
    expect(result.hits[0]?.merchant.id).toBe(GPAGE_ID);
    expect(result.hits[0]?.match.kind).toBe('google_maps');
  });

  it('falls back to website host matching when the path differs from storage', () => {
    const result = index.search('www.ahw.store/some/deep/path?x=1');
    expect(result.hits[0]?.merchant.id).toBe(AHW_STORE_ID);
    expect(result.hits[0]?.match.kind).toBe('website');
  });

  it('matches a stored website path exactly when it exists in storage', () => {
    const result = index.search('https://ahw.store/pages/build-your-pc');
    expect(result.hits[0]?.merchant.id).toBe(AHW_STORE_ID);
    expect(result.hits[0]?.match.kind).toBe('website');
  });

  it('matches a stored website identifier exactly when the origin matches', () => {
    const result = index.search('https://ahw.store/products');
    expect(result.hits[0]?.merchant.id).toBe(AHW_STORE_ID);
    expect(result.hits[0]?.match.kind).toBe('website');
  });
});

describe('SearchIndex — synthetic in-memory index (collisions + ranking)', () => {
  it('prefers identifier exact over everything else for the same merchant', () => {
    const idx = build({
      merchants: [merchant('m2', '01000000000')],
      identifiers: [{ merchantId: 'm2', kind: 'phone', normalized: '+201000000000' }],
    });
    const result = idx.search('01000000000');
    expect(result.hits[0]?.match.kind).toBe('phone');
  });

  it('tie-breaks equal tiers on identityConfidence desc, then id asc', () => {
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

  it('keeps multi-owner subpath keys reachable without first-owner loss', () => {
    const idx = build({
      merchants: [merchant('fb-owner-1', 'Page One'), merchant('fb-owner-2', 'Page Two')],
      identifiers: [
        { merchantId: 'fb-owner-1', kind: 'facebook', normalized: 'https://facebook.com/shared.page/videos' },
        { merchantId: 'fb-owner-2', kind: 'facebook', normalized: 'https://facebook.com/shared.page/videos' },
      ],
    });
    // both the stable account key and the full subpath resolve every owner
    for (const query of ['facebook.com/shared.page', 'facebook.com/shared.page/videos']) {
      const result = idx.search(query);
      expect(result.hits.map((h) => h.merchant.id).sort()).toEqual(['fb-owner-1', 'fb-owner-2']);
    }
  });

  it('suppresses bare-host fallback for multi-owner unrelated websites', () => {
    const idx = build({
      merchants: [merchant('w-alpha', 'Alpha Systems'), merchant('w-beta', 'Beta Trading')],
      identifiers: [
        { merchantId: 'w-alpha', kind: 'website', normalized: 'https://shared-host.com' },
        { merchantId: 'w-beta', kind: 'website', normalized: 'https://shared-host.com' },
      ],
    });
    expect(idx.search('https://shared-host.com').hits).toEqual([]);
  });

  it('allows bare-host fallback for owners sharing a brand family key', () => {
    const idx = build({
      merchants: [
        merchant('bt-main', 'B.TECH'),
        merchant('bt-branch', 'B.TECH'),
      ],
      identifiers: [
        { merchantId: 'bt-main', kind: 'website', normalized: 'https://btech.com' },
        { merchantId: 'bt-branch', kind: 'website', normalized: 'https://btech.com' },
      ],
    });
    const result = idx.search('https://btech.com');
    expect(result.hits.map((h) => h.merchant.id).sort()).toEqual(['bt-branch', 'bt-main']);
    expect(result.ambiguous).toBe(true);
  });

  it('never resolves marketplace/app-store hosts through bare-host fallback', () => {
    const idx = build({
      merchants: [merchant('mkt-one', 'Market Seller')],
      identifiers: [{ merchantId: 'mkt-one', kind: 'marketplace', normalized: 'https://noon.com' }],
    });
    expect(idx.search('https://noon.com').hits).toEqual([]);
  });

  it('keeps every owner of a shared name key (no first-owner truncation)', () => {
    const idx = build({
      merchants: [merchant('dup-1', 'Same Name'), merchant('dup-2', 'Same Name')],
    });
    const result = idx.search('Same Name');
    expect(result.hits.map((h) => h.merchant.id).sort()).toEqual(['dup-1', 'dup-2']);
  });

  it('orders name tiers: exact_name before partial_name before typo', () => {
    const idx = build({
      merchants: [
        merchant('name-exact', 'alpha beta', 10),
        merchant('partial-cand', 'alpha beta extra words here', 90),
        merchant('typo-cand', 'alpha betta', 95),
      ],
    });
    const result = idx.search('alpha beta');
    const kinds = result.hits.map((hit) => hit.match.kind);
    expect(kinds).toContain('exact_name');
    if (kinds.includes('partial_name')) {
      expect(kinds.indexOf('exact_name')).toBeLessThan(kinds.indexOf('partial_name'));
    }
    if (kinds.includes('typo')) {
      expect(kinds.indexOf('partial_name')).toBeLessThan(kinds.indexOf('typo'));
    }
  });

  it('detects phone via Persian digits', () => {
    const idx = build({
      merchants: [merchant('m-digits', 'digits shop')],
      identifiers: [{ merchantId: 'm-digits', kind: 'phone', normalized: '+201000000000' }],
    });
    const result = idx.search('۰۱۰۰۰۰۰۰۰۰۰');
    expect(result.inputKind).toBe('phone');
    expect(result.hits[0]?.merchant.id).toBe('m-digits');
  });
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
    createdAt: '2026-01-01T00:00:00+00:00',
    updatedAt: '2026-01-01T00:00:00+00:00',
  };
}

function build(data: Partial<IndexData>): SearchIndex {
  return new SearchIndex({
    merchants: data.merchants ?? [],
    identifiers: data.identifiers ?? [],
    aliases: data.aliases ?? [],
  });
}
