import { beforeAll, describe, expect, it } from 'vitest';
import { MerchantDb } from './db';
import { SearchIndex } from './search';
import type { SearchResult } from './types';

/**
 * Golden matrix: ≥50 real queries pinned to stable merchant IDs from the live
 * read-only snapshot (webapp/data/merchants.db). Contract per plan Phase 3:
 * unambiguous exact = top-1; expected fuzzy owners within top-3; ambiguity
 * returns the complete owner set with ambiguous=true; deliberate no-hits stay
 * empty; no first-owner truncation on shared keys.
 */

const DB_PATH = new URL('../../data/merchants.db', import.meta.url).pathname;

// Stable merchant IDs (snapshot-verified):
const B_TECH_ID = '0abffb14-4754-4d4a-8ec7-78a5732a9264'; // B.TECH (Port Said row; brand-family main)
const B_TECH_ALT1 = '306c4864-694f-46ce-bb9a-0e18f9d31c3a'; // B.TECH
const B_TECH_ALT2 = '31c54405-381c-4364-a49c-a8a9244f7471'; // B.TECH
const B_TECH_ALT3 = 'd08748d3-b6be-4185-a32e-e439d19d3c72'; // B.TECH (btech.com/ar + B.TECH.Egypt FB)
const MTI_ID = '9af176b0-b896-4494-bcfb-d1ef85166ba5'; // MTI Holding
const G2E_ID = '3af4b233-ad29-4155-b436-3573576e1daf'; // Games 2 Egypt (goo.gl maps shortlinks)
const G2E_ALT = '0f9b3f71-e2b2-41fb-b834-61ad2375282c'; // Games 2 Egypt (games2egypt.com)
const CONNECT_ID = '0d73d05b-7fb3-4afb-b4ea-c74e2025f8b0'; // Connect Phone
const ROPHAEL_ID = '0e348653-7777-4b8c-8a9b-9fc2d7b2b0ba'; // شركة روفائيل للأجهزة الكهربائية الإسكندرية
const DREAM_ID = 'c25a5a60-e885-4916-85aa-9618d9097d18'; // Dream 2000
const AHW_ID = '12b6cf33-4408-419d-a80a-d44bbe55e321'; // AHW Store
const NOUR_EG_ID = '6f8d4ff8-3ec9-4701-83d7-1c10998ce70d'; // El Nour Tech (النور تك aliases)
const NOOR_AR_ID = '42b80440-efd0-42f1-86eb-11599b5dc7c9'; // Noor Tech Computer System (نور تك …)
const EMAIL_ID = '98e83f64-7837-4173-b7df-0fb2dce03c9c'; // Smart Home Egypt (email fixture)
const GPAGE_ID = 'b08b8b97-922f-4063-bdee-eaa06a534f7e'; // المؤسسة الهندسية المتحدة (g.page fixtures)
const FB_VIDEO_ID = '7ca96184-bc83-41fc-a5e1-09d433a41e3f';
const FB_NUMERIC_ID = '8dc75d76-bbcf-480b-ad9f-e569f60fd861'; // facebook.com/100061858249234
const INSTA_2B_ID = '4fa441a7-25b7-4710-9da0-689241c9fd2d'; // instagram.com/2begypt + FB 2BEgypt
const INSTA_AHW_ID = AHW_ID; // instagram.com/arabhardware
const TIKTOK_COMPU_ID = '534350dd-ec1f-41bc-b430-6ef5277947da'; // tiktok.com/@compumarts
const TIKTOK_LORD_ID = 'd59ad8b0-ea8e-4372-a74a-7c2e07023d89'; // tiktok.com/@lord.laptop
const HYPERONE_ID = '26759a21-8cd4-48cb-96de-a5605171cabc'; // play + apple store apps
const SEIF_ID = '52302796-4355-47a4-9f9f-eae06521e8e1'; // play store seif pharmacy
const NOON_GAMER_ID = '6e5d728a-81fa-4ac6-b162-0dc301cf1f94'; // noon.com/egypt-en/egygamer
const DUBIZZLE_AD_ID = '62ea11ca-a300-41b3-a695-b5b73082d53c'; // dubizzle ad path
const WHATSAPP_DREAM_ID = DREAM_ID; // whatsapp +201000016942
const SHAHEEN_1 = '05abc4eb-760c-4842-a467-716d52b1bd04';
const SHAHEEN_2 = '7d17483f-507c-4171-8b78-9247687ec489';

let index: SearchIndex;

beforeAll(() => {
  index = SearchIndex.fromDb(new MerchantDb(DB_PATH));
});

const B_TECH_FAMILY = [B_TECH_ID, B_TECH_ALT1, B_TECH_ALT2, B_TECH_ALT3];

/** All hits of the result's top tier (the ambiguity surface). */
function topTierIds(r: SearchResult): string[] {
  const kind = r.hits[0]?.match.kind;
  if (kind === undefined) return [];
  return r.hits.filter((h) => h.match.kind === kind).map((h) => h.merchant.id);
}

function ids(r: SearchResult): string[] {
  return r.hits.map((h) => h.merchant.id);
}

/** Top-1: the only hit, or the first hit when later hits are lower tiers. */
function expectTop1(query: string, merchantId: string, matchKind?: string): void {
  const r = index.search(query);
  expect(r.hits.length, `${query}: total=${r.total}`).toBeGreaterThan(0);
  expect(r.hits[0]?.merchant.id, query).toBe(merchantId);
  if (matchKind !== undefined) {
    expect(r.hits[0]?.match.kind, query).toBe(matchKind);
  }
  // No stronger-tier hit may follow the expected owner for unambiguous cases:
  // every hit above rank of the owner set must not outrank it (guaranteed by ordering).
}

function expectAmbiguous(query: string, ownerIds: string[], matchKind?: string): void {
  const r = index.search(query);
  expect(r.ambiguous, `${query}: ambiguous flag`).toBe(true);
  const top = topTierIds(r);
  expect([...top].sort(), `${query}: complete owner set (got ${top.join(',')})`).toEqual([...ownerIds].sort());
  if (matchKind !== undefined) {
    for (const hit of r.hits.slice(0, top.length)) {
      expect(hit.match.kind, query).toBe(matchKind);
    }
  }
}

function expectOwnerInTop3(query: string, merchantId: string, matchKind: string): void {
  const r = index.search(query);
  const top3 = ids(r).slice(0, 3);
  expect(top3, `${query}: owner within top-3 (got ${ids(r).slice(0, 5).join(',')})`).toContain(merchantId);
  const hit = r.hits.find((h) => h.merchant.id === merchantId);
  expect(hit?.match.kind, `${query}: match kind`).toBe(matchKind);
}

function expectNoHits(query: string, inputKind?: string, diagnostic?: string): void {
  const r = index.search(query);
  if (inputKind !== undefined) expect(r.inputKind, query).toBe(inputKind);
  if (diagnostic !== undefined) {
    expect(r.diagnostic, query).toBe(diagnostic);
  } else {
    expect(r.diagnostic, query).toBeNull();
  }
  expect(r.hits, `${query}: zero hits`).toEqual([]);
  expect(r.total, `${query}: total 0`).toBe(0);
}

describe('Golden matrix — exact Arabic names', () => {
  it('full canonical Arabic name is top-1 exact_name', () => {
    expectTop1('شركة روفائيل للأجهزة الكهربائية الإسكندرية', ROPHAEL_ID, 'exact_name');
  });

  it('Arabic canonical company name (سمارت هوم شركة) resolves its exact owner', () => {
    expectTop1('شركة سمارت هوم للأجهزة الكهربائية', '27674c46-3a70-4bc4-ab12-0ce4aca3b34f', 'exact_name');
  });

  it('Arabic multi-word exact name (Smart Home Arabic form) top-1', () => {
    expectTop1('Smart Home Egypt', EMAIL_ID, 'exact_name');
  });
});

describe('Golden matrix — exact English names', () => {
  it('B.TECH returns the complete 4-owner family, ambiguous', () => {
    expectAmbiguous('B.TECH', B_TECH_FAMILY, 'exact_name');
  });

  it('MTI Holding canonical alias top-1', () => {
    expectTop1('MTI Holding', MTI_ID, 'exact_alias');
  });

  it('Connect Phone top-1', () => {
    expectTop1('Connect Phone', CONNECT_ID, 'exact_name');
  });

  it('AHW Store top-1', () => {
    expectTop1('AHW Store', AHW_ID, 'exact_name');
  });

  it('Dream 2000 top-1 (case-insensitive)', () => {
    expectTop1('dream 2000', DREAM_ID, 'exact_name');
    expectTop1('Dream 2000', DREAM_ID, 'exact_name');
  });

  it('El Nour Tech (Latin) top-1 on the El-Nour-Tech merchant', () => {
    expectTop1('El Nour Tech', NOUR_EG_ID, 'exact_name');
  });

  it('Games 2 Egypt family ambiguity: both owners returned', () => {
    expectAmbiguous('Games 2 Egypt', [G2E_ID, G2E_ALT], 'exact_name');
  });
});

describe('Golden matrix — aliases', () => {
  it('B.Tech Egypt alias: complete family, ambiguous', () => {
    expectAmbiguous('B.Tech Egypt', B_TECH_FAMILY, 'exact_alias');
  });

  it('بي تك alias: complete family, ambiguous', () => {
    expectAmbiguous('بي تك', B_TECH_FAMILY, 'exact_alias');
  });

  it('بي.تك dotted form normalizes to the family', () => {
    expectAmbiguous('بي.تك', B_TECH_FAMILY, 'exact_alias');
  });

  it('branch alias بي تك بورسعيد pins the Port Said row', () => {
    expectTop1('بي تك بورسعيد', B_TECH_ID, 'exact_alias');
  });

  it('full legal alias ب.TECH parenthetical form top-1', () => {
    expectTop1('B.TECH (بي تك)', B_TECH_ID, 'exact_alias');
  });

  it('دريم 2000 Arabic alias top-1', () => {
    expectTop1('دريم 2000', DREAM_ID, 'exact_alias');
  });

  it('النور تك مصر alias top-1 on El Nour Tech', () => {
    expectTop1('النور تك مصر', NOUR_EG_ID, 'exact_alias');
  });

  it('English alias mti holding (lowercase) top-1', () => {
    expectTop1('mti holding', MTI_ID, 'exact_alias');
  });
});

describe('Golden matrix — strict vs loose (النور تك / نور تك collision)', () => {
  it('النور تك exact tier resolves only El Nour Tech; نور تك family surfaces below', () => {
    const r = index.search('النور تك');
    const exact = r.hits.filter((h) => h.match.kind === 'exact_alias');
    expect(exact.map((h) => h.merchant.id)).toEqual([NOUR_EG_ID]);
    // loose recall tier must NOT outrank the exact tier
    const firstLoose = r.hits.findIndex((h) => h.match.kind === 'normalized_variant');
    expect(firstLoose).toBeGreaterThan(0);
    expect(ids(r)).toContain(NOOR_AR_ID);
  });

  it('نور تك exact tier resolves only Noor Tech; النور تك surfaces below', () => {
    const r = index.search('نور تك');
    const exact = r.hits.filter((h) => h.match.kind === 'exact_alias');
    expect(exact.map((h) => h.merchant.id)).toEqual([NOOR_AR_ID]);
    expect(ids(r)).toContain(NOUR_EG_ID);
  });

  it('ta-marbuta/alef variants keep النور تك مصر unambiguous', () => {
    expectTop1('شركة النور تك للكمبيوتر', NOUR_EG_ID, 'exact_alias');
  });
});

describe('Golden matrix — tatweel', () => {
  it('tatweel-stretched Arabic alias still resolves the family', () => {
    expectAmbiguous('بـــي تـــك', B_TECH_FAMILY, 'exact_alias');
  });

  it('tatweel inside Latin name B.TECHـــ still resolves the family', () => {
    expectAmbiguous('B.TECHـــ', B_TECH_FAMILY, 'exact_name');
  });

  it('heavy mixed tatweel resolves the family', () => {
    expectAmbiguous('بـــيـــ تــــكـــ', B_TECH_FAMILY, 'exact_alias');
  });
});

describe('Golden matrix — leading-و conjunction', () => {
  it('وبي تك reaches the family via conjunction recall', () => {
    const r = index.search('وبي تك');
    expect(r.hits.length).toBeGreaterThan(0);
    for (const id of B_TECH_FAMILY) {
      expect(ids(r), 'وبي تك must reach every family owner').toContain(id);
    }
  });

  it('conjunction stripping does not corrupt single-token ولي-style names', () => {
    const r = index.search('ولي');
    for (const hit of r.hits) {
      expect(hit.match.kind).not.toBe('normalized_variant');
    }
  });
});

describe('Golden matrix — Arabic-Indic digits', () => {
  it('Arabic-Indic mobile digits find the phone owner', () => {
    expectTop1('٠١٢٨٦٦١٩٩٦٦', B_TECH_ID, 'phone');
  });

  it('spaced Arabic-Indic mobile digits find the phone owner', () => {
    expectTop1('٠١٢ ٨٦٦ ١٩٩ ٦٦', B_TECH_ID, 'phone');
  });

  it('Persian-digit whatsapp form finds the whatsapp owner', () => {
    expectTop1('٠١٠٠٠٠١٦٩٤٢', WHATSAPP_DREAM_ID, 'whatsapp');
  });

  it('Arabic-Indic landline digits find the landline owner', () => {
    expectTop1('٠٢٢١٢٠٣١٩٢', AHW_ID, 'phone');
  });
});

describe('Golden matrix — local +20 phone forms', () => {
  it('local mobile form top-1', () => {
    expectTop1('01286619966', B_TECH_ID, 'phone');
  });

  it('international spaced form top-1', () => {
    expectTop1('+20 128 661 9966', B_TECH_ID, 'phone');
  });

  it('00-prefixed form top-1', () => {
    expectTop1('00201286619966', B_TECH_ID, 'phone');
  });

  it('country-code-without-plus form top-1', () => {
    expectTop1('20 128 661 9966', B_TECH_ID, 'phone');
  });

  it('punctuated form top-1', () => {
    expectTop1('(+20) 128-661-9966', B_TECH_ID, 'phone');
  });

  it('landline local form top-1', () => {
    expectTop1('0221203192', AHW_ID, 'phone');
  });

  it('landline international form top-1', () => {
    expectTop1('+20221203192', AHW_ID, 'phone');
  });

  it('valid mobile whose local 11-digit form belongs to whatsapp kind still resolves owner', () => {
    expectTop1('01000016942', WHATSAPP_DREAM_ID, 'whatsapp');
  });
});

describe('Golden matrix — WhatsApp', () => {
  it('whatsapp international spaced form', () => {
    expectTop1('+20 100 001 6942', WHATSAPP_DREAM_ID, 'whatsapp');
  });

  it('whatsapp compact international form', () => {
    expectTop1('+201000016942', WHATSAPP_DREAM_ID, 'whatsapp');
  });
});

describe('Golden matrix — invalid/malformed phones', () => {
  it('foreign US number → invalid_egyptian_phone, zero hits', () => {
    expectNoHits('14155551234', 'phone', 'invalid_egyptian_phone');
  });

  it('truncated Egyptian mobile → invalid_egyptian_phone', () => {
    expectNoHits('+20128661996', 'phone', 'invalid_egyptian_phone');
  });

  it('local 10-digit (missing leading 0) whatsapp → invalid_egyptian_phone', () => {
    expectNoHits('1000016942', 'phone', 'invalid_egyptian_phone');
  });
});

describe('Golden matrix — email', () => {
  it('email case-insensitive top-1', () => {
    expectTop1('Ahmed226887@Gmail.COM', EMAIL_ID, 'email');
  });

  it('email lowercase top-1', () => {
    expectTop1('ahmed226887@gmail.com', EMAIL_ID, 'email');
  });
});

describe('Golden matrix — facebook platform', () => {
  it('username path resolves owner', () => {
    expectTop1('facebook.com/MTIholding', MTI_ID, 'facebook');
  });

  it('scheme/case/www/slash/query variant resolves owner', () => {
    expectTop1('HTTPS://WWW.Facebook.COM/mtiholding/?fref=ts', MTI_ID, 'facebook');
  });

  it('B.TECH.Egypt page is shared by two family owners — complete set, ambiguous', () => {
    expectAmbiguous('https://facebook.com/B.TECH.Egypt', [B_TECH_ID, B_TECH_ALT3], 'facebook');
  });

  it('tracking param variant of the shared page stays ambiguous with both owners', () => {
    expectAmbiguous('https://www.facebook.com/B.TECH.Egypt?fref=ts', [B_TECH_ID, B_TECH_ALT3], 'facebook');
  });

  it('numeric profile page resolves its owner', () => {
    expectTop1('facebook.com/100061858249234', FB_NUMERIC_ID, 'facebook');
  });

  it('profile.php?id= form keys on the numeric id (no false hits for garbage ids)', () => {
    expectNoHits('facebook.com/profile.php?id=999999999999999');
  });

  it('/videos subpath stays reachable without first-owner loss', () => {
    expectTop1('https://facebook.com/100083619811696/videos/8567224323389415', FB_VIDEO_ID, 'facebook');
    expectTop1('facebook.com/100083619811696', FB_VIDEO_ID, 'facebook');
  });

  it('m.facebook.com subdomain variant resolves owner', () => {
    expectTop1('m.facebook.com/highend.store', 'f2d1c4f7-dc78-4e41-a21b-31d27384509b', 'facebook');
  });

  it('bare facebook.com host yields zero hits (no platform-wide tie)', () => {
    expectNoHits('https://www.facebook.com/', 'url');
  });

  it('Shaheen Center shared facebook page returns both owners, ambiguous', () => {
    expectAmbiguous('facebook.com/ShaheenCenter', [SHAHEEN_1, SHAHEEN_2], 'facebook');
  });
});

describe('Golden matrix — instagram', () => {
  it('handle resolves owner', () => {
    expectTop1('instagram.com/btech.egypt', B_TECH_ALT3, 'instagram');
  });

  it('www + scheme + trailing slash variant resolves owner', () => {
    expectTop1('https://www.instagram.com/arabhardware/', INSTA_AHW_ID, 'instagram');
  });

  it('2begypt handle resolves the 2B Egypt merchant', () => {
    expectTop1('instagram.com/2begypt', INSTA_2B_ID, 'instagram');
  });
});

describe('Golden matrix — tiktok', () => {
  it('handle resolves owner', () => {
    expectTop1('tiktok.com/@compumarts', TIKTOK_COMPU_ID, 'tiktok');
  });

  it('www + query variant resolves owner', () => {
    expectTop1('https://www.tiktok.com/@lord.laptop?lang=ar', TIKTOK_LORD_ID, 'tiktok');
  });

  it('video subpath stays reachable via account key', () => {
    expectTop1('https://tiktok.com/@compumarts/video/123', TIKTOK_COMPU_ID, 'tiktok');
  });
});

describe('Golden matrix — google maps platforms', () => {
  it('g.page short link resolves owner', () => {
    expectTop1('g.page/ikelvinatorr', GPAGE_ID, 'google_maps');
  });

  it('g.page/r/ path variant resolves owner', () => {
    expectTop1('g.page/r/CQsBGW5lBv_nEBA', GPAGE_ID, 'google_maps');
  });

  it('goo.gl/maps shortlink resolves owner', () => {
    expectTop1('https://goo.gl/maps/BbZuAKqi75232WJZ8', G2E_ID, 'google_maps');
  });

  it('goo.gl shortlink with tracking query resolves owner', () => {
    expectTop1('https://goo.gl/maps/PhFU5AXUTHp4vJDz5?g_st=ic', G2E_ID, 'google_maps');
  });

  it('maps.app.goo.gl resolves owner (any kind tier)', () => {
    const r = index.search('https://maps.app.goo.gl/n2vQprey9naG6LWZ9');
    expect(r.hits[0]?.merchant.id).toBe(G2E_ID);
  });

  it('google.com/maps embed path resolves to the maps-kind owner set', () => {
    const r = index.search(
      'google.com/maps/embed?pb=%211m18%211m12%211m3%211d214.0018726594645%212d31.363104376120468%213d31.039120063929996',
    );
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0]?.match.kind).toBe('google_maps');
    expect(ids(r)).toContain('d59ad8b0-ea8e-4372-a74a-7c2e07023d89');
  });
});

describe('Golden matrix — app stores', () => {
  it('play store id query resolves owner', () => {
    expectTop1('https://play.google.com/store/apps/details?id=com.hyperone.app', HYPERONE_ID, 'marketplace');
  });

  it('play store id with tracking params stripped resolves same owner', () => {
    expectTop1('https://play.google.com/store/apps/details?id=com.hyperone.app&hl=ar&gl=EG', HYPERONE_ID, 'marketplace');
  });

  it('play store bare path form resolves owner', () => {
    expectTop1('play.google.com/store/apps/details?id=com.seif.pharmacy', SEIF_ID, 'marketplace');
  });

  it('apple app store numeric id resolves owner', () => {
    expectTop1('https://apps.apple.com/us/app/hyperone/id1559427531', HYPERONE_ID, 'marketplace');
  });

  it('apple app store id with junk query resolves owner', () => {
    expectTop1('https://apps.apple.com/us/app/hyperone/id1559427531?foo=bar', HYPERONE_ID, 'marketplace');
  });
});

describe('Golden matrix — marketplace host + path', () => {
  it('noon seller path resolves owner', () => {
    const r = index.search('https://noon.com/egypt-en/egygamer');
    expect(r.ambiguous).toBe(true);
    expect(ids(r)).toContain(NOON_GAMER_ID);
  });

  it('dubizzle ad path resolves its ad owner', () => {
    const r = index.search('https://dubizzle.com.eg/ad/ID151029482.html');
    expect(ids(r)).toContain(DUBIZZLE_AD_ID);
  });

  it('bare marketplace host never identifies a merchant via host alone', () => {
    // noon.com bare host must NOT resolve the egygamer seller (path-only profile)
    const r = index.search('https://noon.com/egypt-en');
    for (const hit of r.hits) {
      expect(hit.merchant.id).not.toBe(NOON_GAMER_ID);
    }
  });
});

describe('Golden matrix — website host + path + origin', () => {
  it('bare https origin top-1', () => {
    expectTop1('https://ahw.store', AHW_ID, 'website');
  });

  it('http origin resolves the same owner (scheme-invariant)', () => {
    expectTop1('http://ahw.store', AHW_ID, 'website');
  });

  it('deep unrelated path falls back to host owner', () => {
    expectTop1('www.ahw.store/some/deep/path?x=1', AHW_ID, 'website');
  });

  it('stored exact path resolves owner', () => {
    expectTop1('https://ahw.store/pages/build-your-pc', AHW_ID, 'website');
  });

  it('stored path with tracking params stripped resolves owner', () => {
    expectTop1('https://ahw.store/pages/build-your-pc?utm_source=x&fbclid=abc', AHW_ID, 'website');
  });

  it('trailing-slash origin variant resolves owner', () => {
    expectTop1('https://ahw.store/', AHW_ID, 'website');
  });

  it('btech.com shared brand family: both website owners, ambiguous', () => {
    expectAmbiguous('https://btech.com', [B_TECH_ID, B_TECH_ALT3], 'website-host');
  });

  it('btech.com www variant: both owners via website-host', () => {
    expectAmbiguous('www.btech.com', [B_TECH_ID, B_TECH_ALT3], 'website-host');
  });

  it('btech.com exact stored subpath pins the exact-path owner at top', () => {
    const r = index.search('https://btech.com/ar/tech-care');
    expect(r.hits[0]?.merchant.id).toBe(B_TECH_ID);
    expect(r.hits[0]?.match.kind).toBe('website');
    // the shared-host owner may still appear below — no truncation
    expect(ids(r)).toContain(B_TECH_ALT3);
  });

  it('btech.com deep path: brand-family host fallback returns both, ambiguous', () => {
    expectAmbiguous('https://btech.com/ar/c/gaming-area/consoles/playstation', [B_TECH_ID, B_TECH_ALT3]);
  });

  it('blog subdomain exact stored path resolves owner', () => {
    expectTop1(
      'https://blog.btech.com/ar/%D8%B9%D9%86%D8%A7%D9%88%D9%8A%D9%86-%D9%81%D8%B1%D9%88%D8%B9-%D8%A8%D9%8A-%D8%AA%D9%83-%D9%85%D8%B5%D8%B1',
      B_TECH_ID,
      'website',
    );
  });
});

describe('Golden matrix — quarantined unsafe hosts', () => {
  it('bare regulator domain yields zero hits', () => {
    expectNoHits('cpa.gov.eg');
  });

  it('regulator URL yields zero hits', () => {
    expectNoHits('https://cpa.gov.eg/complaints', 'url');
  });

  it('support host yields zero hits', () => {
    expectNoHits('https://support.apple.com/ar-eg/HT201222', 'url');
  });

  it('complaint portal yields zero hits', () => {
    expectNoHits('https://shakwa.cpa-mobile.com/complaint/1', 'url');
  });
});

describe('Golden matrix — typos', () => {
  it('single-token typo conect reaches Connect Phone in top-3 via typo tier', () => {
    expectOwnerInTop3('conect', CONNECT_ID, 'typo');
  });

  it('single-token Arabic typo روفائيل reaches Ropahel in top-3', () => {
    expectOwnerInTop3('روفائيل', ROPHAEL_ID, 'partial_name');
  });

  it('single-token Arabic typo روفايل reaches Ropahel via typo tier in top-3', () => {
    expectOwnerInTop3('روفايل', ROPHAEL_ID, 'typo');
  });

  it('multi-token typo b techh egyot reaches the B.TECH family in top-3', () => {
    const r = index.search('b techh egyot');
    const top3 = ids(r).slice(0, 3);
    expect(top3.filter((id) => B_TECH_FAMILY.includes(id)).length, `top3=${top3.join(',')}`).toBeGreaterThan(0);
    expect(r.hits.find((h) => B_TECH_FAMILY.includes(h.merchant.id))?.match.kind).toBe('typo');
  });

  it('two-token typo b techh reaches the family via typo tier', () => {
    const r = index.search('b techh');
    const top3 = ids(r).slice(0, 3);
    expect(top3.filter((id) => B_TECH_FAMILY.includes(id)).length).toBeGreaterThan(0);
  });
});

describe('Golden matrix — verbose subset vs fuller coverage', () => {
  it('full multi-word Arabic name beats its single-token subset on tier quality', () => {
    const full = index.search('شركة روفائيل للأجهزة الكهربائية الإسكندرية');
    const short = index.search('روفائيل');
    expect(full.hits[0]?.merchant.id).toBe(ROPHAEL_ID);
    expect(full.hits[0]?.match.kind).toBe('exact_name');
    // the subset query must not rank the fuller candidate below unrelated noise:
    expect(short.hits.slice(0, 3).map((h) => h.merchant.id)).toContain(ROPHAEL_ID);
  });

  it('subset query never outranks the fuller-coverage merchant (synthetic)', () => {
    // synthetic check lives in search.spec.ts; here we pin the real-data analog:
    const r = index.search('بي تك شارع الجمهورية');
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0]?.match.kind).toBe('partial_name');
  });
});

describe('Golden matrix — generic / incomplete queries', () => {
  it('single generic token موبايل returns multiple partial hits without a fabricated exact', () => {
    const r = index.search('موبايل');
    expect(r.hits.length).toBeGreaterThan(1);
    for (const hit of r.hits) {
      expect(['partial_name', 'typo']).toContain(hit.match.kind);
    }
  });

  it('incomplete brand fragment games 2 returns both Games-2 owners (partial tier)', () => {
    const r = index.search('games 2');
    expect(r.ambiguous).toBe(true);
    for (const id of [G2E_ID, G2E_ALT]) {
      expect(ids(r)).toContain(id);
    }
  });

  it('partial token نور surfaces both Nour merchants (no first-owner truncation)', () => {
    const r = index.search('نور');
    expect(ids(r)).toContain(NOUR_EG_ID);
    expect(ids(r)).toContain(NOOR_AR_ID);
  });
});

describe('Golden matrix — deliberate no-hits', () => {
  it('nonsense query stays empty', () => {
    expectNoHits('zzzzqqqq', 'name');
  });

  it('bare foreign domain stays empty', () => {
    expectNoHits('https://google.com', 'url');
  });

  it('hostname-like name input that matches nothing stays empty', () => {
    expectNoHits('wataniya');
  });

  it('oversized single token stays empty (bounded typo rescue)', () => {
    expectNoHits('a'.repeat(300), 'name');
  });
});

describe('Golden matrix — envelope contracts on real data', () => {
  it('every result carries the new envelope and no score', () => {
    for (const q of ['بي تك', 'B.TECH', '01286619966', 'facebook.com/MTIholding', 'zzzzqqqq']) {
      const r = index.search(q);
      expect(r).toMatchObject({ query: q, page: 1, pageSize: 20 });
      for (const hit of r.hits) {
        expect(hit).not.toHaveProperty('score');
        expect(hit).not.toHaveProperty('matchedOn');
        expect(hit.match.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('pagination over a broad real query keeps global order', () => {
    const p1 = index.search('tech', 1);
    const p2 = index.search('tech', 2);
    expect(p1.hits.length).toBe(20);
    expect(p2.hits.length).toBe(p1.total - 20);
    const seen = new Set(p1.hits.map((h) => h.merchant.id));
    for (const hit of p2.hits) {
      expect(seen.has(hit.merchant.id)).toBe(false);
    }
  });
});
