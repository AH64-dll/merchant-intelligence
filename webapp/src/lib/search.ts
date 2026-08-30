import type { IndexData, MerchantDb } from './db';
import {
  conjunctionVariants,
  detectInputKind,
  levenshtein,
  nameTokens,
  normalizeNameLoose,
  normalizeNameStrict,
  normalizePhone,
  normalizeQueryUrl,
  trigrams,
} from './normalize';
import { isSearchableIdentifier } from './identifier-policy';
import type {
  IdentifierKind,
  InputKind,
  MatchedOn,
  Merchant,
  SearchDiagnostic,
  SearchHit,
  SearchResult,
  SearchTier,
} from './types';
import { SEARCH_PAGE_SIZE } from './types';

/** Quality metrics used to order hits inside one ordinal tier. */
interface HitQuality {
  /** Query tokens not covered exactly (typo-rescued count). Ascending = better. */
  fuzzyTokens: number;
  /** Candidate name tokens left uncovered by the query (verbosity penalty). Ascending = better. */
  extraTokens: number;
  /** Total edit distance across typo-rescued tokens. Ascending = better. */
  editDistance: number;
}

const PERFECT: HitQuality = { fuzzyTokens: 0, extraTokens: 0, editDistance: 0 };

interface BestHit {
  tier: SearchTier;
  matchedOn: MatchedOn;
  matchedValue: string;
  quality: HitQuality;
}

type Consider = (merchantId: string, hit: BestHit) => void;

interface CandidateTokens {
  merchantId: string;
  looseTokens: string[];
  display: string;
}

const TIER_ORDER: Record<SearchTier, number> = {
  exact_identifier: 0,
  exact_name: 1,
  exact_alias: 2,
  normalized_variant: 3,
  partial_name: 4,
  typo: 5,
};

const MATCH_LABELS: Record<MatchedOn, string> = {
  commercial_register: 'سجل تجاري',
  address: 'عنوان',
  phone: 'هاتف',
  whatsapp: 'واتساب',
  email: 'بريد إلكتروني',
  facebook: 'صفحة فيسبوك',
  instagram: 'حساب إنستغرام',
  tiktok: 'حساب تيك توك',
  website: 'الموقع الرسمي',
  marketplace: 'متجر إلكتروني',
  google_maps: 'موقع على الخرائط',
  'website-host': 'تطابق نطاق الموقع',
  'marketplace-host': 'تطابق نطاق متجر إلكتروني',
  exact_name: 'تطابق اسم تام',
  exact_alias: 'تطابق اسم بديل',
  normalized_variant: 'صيغة قريبة من الاسم',
  partial_name: 'تطابق جزئي في الاسم',
  typo: 'تشابه تقريبي في الاسم',
};

export class SearchIndex {
  private readonly merchantsById: Map<string, Merchant>;
  /** `${kind}\u0000${normalized}` → every owner of that exact identifier value. */
  private readonly identifierExact: Map<string, Map<string, string>>;
  /**
   * Scheme-free URL keys (platform account keys, full subpaths, first-party
   * origins) → every owner. Built symmetrically from stored values and queries
   * through normalizeQueryUrl, so http/https/www variants never split owners.
   */
  private readonly urlIndex: Map<string, Map<string, string>>;
  /** Strict canonical name key → merchantId → raw canonical name. */
  private readonly nameExact: Map<string, Map<string, string>>;
  /** Strict alias key → merchantId → raw alias. */
  private readonly aliasExact: Map<string, Map<string, string>>;
  /** Loose key → merchantId → raw display value (names + aliases; recall-only tier). */
  private readonly looseKeyOwners: Map<string, Map<string, string>>;
  private readonly candidates: CandidateTokens[];
  private readonly candidatesByMerchant: Map<string, CandidateTokens[]>;
  /** Loose token → merchant ids containing it (posting lists; no corpus scans). */
  private readonly tokenPostings: Map<string, Set<string>>;
  /** Trigram → merchant ids sharing it (typo-rescue pre-filter pool). */
  private readonly trigramPostings: Map<string, Set<string>>;
  /** Trigram → loose tokens holding it (typo token candidates, pre-intersection). */
  private readonly trigramTokenPostings: Map<string, Set<string>>;
  /** Loose token → levenshtein-ready normalized form cache. */
  private readonly tokenList: string[];

  constructor(data: IndexData) {
    this.merchantsById = new Map(data.merchants.map((m) => [m.id, m]));
    this.identifierExact = new Map();
    this.urlIndex = new Map();
    for (const identifier of data.identifiers) {
      if (!isSearchableIdentifier(identifier.kind, identifier.normalized)) continue;
      this.addToOwners(
        this.identifierExact,
        `${identifier.kind}\u0000${identifier.normalized.toLowerCase()}`,
        identifier.merchantId,
        identifier.normalized,
      );
      this.indexIdentifierUrl(identifier.kind, identifier.normalized, identifier.merchantId);
    }
    this.nameExact = new Map();
    this.aliasExact = new Map();
    this.looseKeyOwners = new Map();
    this.candidates = [];
    for (const merchant of data.merchants) {
      this.addName(merchant.id, merchant.canonicalName);
    }
    for (const alias of data.aliases) {
      this.addAlias(alias.merchantId, alias.alias);
    }
    this.candidatesByMerchant = new Map();
    for (const candidate of this.candidates) {
      const list = this.candidatesByMerchant.get(candidate.merchantId);
      if (list !== undefined) {
        list.push(candidate);
      } else {
        this.candidatesByMerchant.set(candidate.merchantId, [candidate]);
      }
    }
    this.tokenPostings = new Map();
    this.trigramPostings = new Map();
    this.trigramTokenPostings = new Map();
    const tokenSet = new Set<string>();
    for (const candidate of this.candidates) {
      for (const token of candidate.looseTokens) {
        tokenSet.add(token);
        const bucket = this.tokenPostings.get(token);
        if (bucket !== undefined) {
          bucket.add(candidate.merchantId);
        } else {
          this.tokenPostings.set(token, new Set([candidate.merchantId]));
        }
        for (const gram of trigrams(token)) {
          const gramBucket = this.trigramPostings.get(gram);
          if (gramBucket !== undefined) {
            gramBucket.add(candidate.merchantId);
          } else {
            this.trigramPostings.set(gram, new Set([candidate.merchantId]));
          }
          const tokBucket = this.trigramTokenPostings.get(gram);
          if (tokBucket !== undefined) {
            tokBucket.add(token);
          } else {
            this.trigramTokenPostings.set(gram, new Set([token]));
          }
        }
      }
    }
    this.tokenList = [...tokenSet];
  }

  static fromDb(db: MerchantDb): SearchIndex {
    return new SearchIndex(db.getIndexData());
  }

  private addToOwners(map: Map<string, Map<string, string>>, key: string, merchantId: string, value: string): void {
    const bucket = map.get(key);
    if (bucket !== undefined) {
      if (!bucket.has(merchantId)) bucket.set(merchantId, value);
    } else {
      map.set(key, new Map([[merchantId, value]]));
    }
  }

  private indexIdentifierUrl(kind: IdentifierKind, normalized: string, merchantId: string): void {
    const parsed = normalizeQueryUrl(normalized);
    if (parsed === null || parsed.externalReference) return;
    for (const pathKey of parsed.pathKeys) {
      // Only first-party websites may claim a bare-origin key; marketplace,
      // directory, social and maps hosts must carry a full path key.
      if (pathKey === parsed.originKey && kind !== 'website') continue;
      this.addToOwners(this.urlIndex, pathKey, merchantId, normalized);
    }
    // First-party websites additionally index their bare origin for host
    // lookup. Marketplace/app-store/directory/social hosts never get a bare
    // origin key: the host alone must not identify a merchant.
    if (kind === 'website' && parsed.originKey !== null) {
      this.addToOwners(this.urlIndex, parsed.originKey, merchantId, normalized);
    }
  }

  private addName(merchantId: string, raw: string): void {
    const strict = normalizeNameStrict(raw);
    if (nameTokens(strict).length === 0) return;
    const bucket = this.nameExact.get(strict) ?? new Map<string, string>();
    if (!bucket.has(merchantId)) bucket.set(merchantId, raw);
    this.nameExact.set(strict, bucket);
    this.registerCandidate(merchantId, raw, strict);
  }

  private addAlias(merchantId: string, raw: string): void {
    const strict = normalizeNameStrict(raw);
    if (nameTokens(strict).length === 0) return;
    const bucket = this.aliasExact.get(strict) ?? new Map<string, string>();
    if (!bucket.has(merchantId)) bucket.set(merchantId, raw);
    this.aliasExact.set(strict, bucket);
    this.registerCandidate(merchantId, raw, strict);
  }

  private registerCandidate(merchantId: string, raw: string, strict: string): void {
    const loose = normalizeNameLoose(raw);
    if (nameTokens(loose).length === 0) return;
    this.addToOwners(this.looseKeyOwners, loose, merchantId, raw);
    this.candidates.push({ merchantId, looseTokens: nameTokens(loose), display: raw });
    // The strict form itself participates in posting lists so exact-token
    // containment works even when loose and strict differ.
    if (loose !== strict) {
      this.candidates[this.candidates.length - 1]!.looseTokens = [
        ...new Set([...nameTokens(loose), ...nameTokens(strict)]),
      ];
    }
  }

  /**
   * Deterministic, collision-safe retrieval. Identifier/phone/email/URL
   * queries never fall through to name matching; a phone-shaped query that is
   * not a valid Egyptian number returns diagnostic `invalid_egyptian_phone`
   * with zero hits. No numeric scores: hits are ordered by ordinal tier and
   * explainable quality metrics.
   */
  search(query: string, page = 1, pageSize: number = SEARCH_PAGE_SIZE): SearchResult {
    const inputKind = detectInputKind(query);
    const best = new Map<string, BestHit>();
    const diagnostic = this.collect(inputKind, query, (merchantId, hit) => {
      mergeHit(best, merchantId, hit);
    });

    const ranked = [...best.entries()]
      .map(([merchantId, hit]) => ({ merchantId, hit }))
      .sort((a, b) => {
        const tierDelta = TIER_ORDER[a.hit.tier] - TIER_ORDER[b.hit.tier];
        if (tierDelta !== 0) return tierDelta;
        const q = compareQuality(a.hit.quality, b.hit.quality);
        if (q !== 0) return q;
        const ca = this.merchantsById.get(a.merchantId);
        const cb = this.merchantsById.get(b.merchantId);
        const confidenceDelta = (cb?.identityConfidence ?? 0) - (ca?.identityConfidence ?? 0);
        if (confidenceDelta !== 0) return confidenceDelta;
        return a.merchantId.localeCompare(b.merchantId);
      });

    const allHits: SearchHit[] = [];
    for (const { merchantId, hit } of ranked) {
      const merchant = this.merchantsById.get(merchantId);
      if (merchant === undefined) continue;
      allHits.push({
        merchant,
        match: { kind: hit.matchedOn, value: hit.matchedValue, label: MATCH_LABELS[hit.matchedOn] },
      });
    }

    const boundedPage = Math.max(1, Math.floor(page));
    const boundedSize = Math.max(1, Math.floor(pageSize));
    const start = (boundedPage - 1) * boundedSize;
    const topTier = allHits[0]?.match.kind;
    const ambiguous = topTier !== undefined && allHits.filter((h) => h.match.kind === topTier).length > 1;

    return {
      query,
      inputKind,
      total: allHits.length,
      page: boundedPage,
      pageSize: boundedSize,
      ambiguous,
      diagnostic,
      hits: allHits.slice(start, start + boundedSize),
    };
  }

  private collect(inputKind: InputKind, query: string, consider: Consider): SearchDiagnostic | null {
    if (inputKind === 'phone') {
      const phone = normalizePhone(query);
      if (phone === null) return 'invalid_egyptian_phone';
      this.matchPhone(phone, consider);
      return null;
    }
    if (inputKind === 'email') {
      this.matchEmail(query, consider);
      return null;
    }
    if (inputKind === 'url') {
      this.matchUrl(query, consider);
      return null;
    }
    this.matchNames(query, consider);
    return null;
  }

  private matchPhone(phone: string, consider: Consider): void {
    for (const kind of ['phone', 'whatsapp'] as const) {
      const bucket = this.identifierExact.get(`${kind}\u0000${phone}`);
      if (bucket === undefined) continue;
      for (const [merchantId, normalized] of bucket) {
        consider(merchantId, { tier: 'exact_identifier', matchedOn: kind, matchedValue: normalized, quality: PERFECT });
      }
    }
  }

  private matchEmail(query: string, consider: Consider): void {
    const email = query.trim().toLowerCase();
    const bucket = this.identifierExact.get(`email\u0000${email}`);
    if (bucket === undefined) return;
    for (const [merchantId, normalized] of bucket) {
      consider(merchantId, { tier: 'exact_identifier', matchedOn: 'email', matchedValue: normalized, quality: PERFECT });
    }
  }

  private matchUrl(query: string, consider: Consider): void {
    const url = normalizeQueryUrl(query);
    if (url === null || url.externalReference) return;

    // Full path/account keys: all owners of an identical key surface.
    for (const pathKey of url.pathKeys) {
      if (url.originKey !== null && pathKey === url.originKey) continue;
      const bucket = this.urlIndex.get(pathKey);
      if (bucket === undefined) continue;
      for (const [merchantId, normalized] of bucket) {
        consider(merchantId, { tier: 'exact_identifier', matchedOn: url.kind, matchedValue: normalized, quality: PERFECT });
      }
    }

    // Bare-origin fallback exists only for first-party website hosts, and
    // only for one owner or owners sharing a strict canonical/alias key.
    if (url.originKey !== null) {
      this.matchOriginFallback(url.originKey, consider);
    }
  }

  private matchOriginFallback(hostKey: string, consider: Consider): void {
    const bucket = this.urlIndex.get(hostKey);
    if (bucket === undefined) return;
    if (bucket.size === 1) {
      const [merchantId, normalized] = [...bucket.entries()][0]!;
      consider(merchantId, { tier: 'exact_identifier', matchedOn: 'website', matchedValue: normalized, quality: PERFECT });
      return;
    }
    if (this.ownersShareBrandFamily([...bucket.keys()])) {
      for (const [merchantId, normalized] of bucket) {
        consider(merchantId, { tier: 'exact_identifier', matchedOn: 'website-host', matchedValue: normalized, quality: PERFECT });
      }
    }
  }

  /** True when every owner shares at least one strict canonical/alias key. */
  private ownersShareBrandFamily(merchantIds: string[]): boolean {
    if (merchantIds.length < 2) return true;
    const [first, ...rest] = merchantIds;
    const firstKeys = this.brandFamilyKeys(first!);
    if (firstKeys.length === 0) return false;
    return rest.every((id) => this.brandFamilyKeys(id).some((key) => firstKeys.includes(key)));
  }

  private brandFamilyKeys(merchantId: string): string[] {
    const keys: string[] = [];
    const canonical = this.merchantsById.get(merchantId);
    if (canonical !== undefined) {
      const strict = normalizeNameStrict(canonical.canonicalName);
      if (nameTokens(strict).length > 0) keys.push(strict);
    }
    for (const [key, owners] of this.aliasExact) {
      if (owners.has(merchantId)) keys.push(key);
    }
    return keys;
  }

  private matchNames(query: string, consider: Consider): void {
    const strictQuery = normalizeNameStrict(query);
    const looseQuery = normalizeNameLoose(query);
    const queryTokens = [...new Set(nameTokens(looseQuery))];
    if (queryTokens.length === 0) return;

    const strictBucket = this.nameExact.get(strictQuery);
    if (strictBucket !== undefined) {
      for (const [merchantId, raw] of strictBucket) {
        consider(merchantId, {
          tier: 'exact_name',
          matchedOn: 'exact_name',
          matchedValue: this.merchantsById.get(merchantId)?.canonicalName ?? raw,
          quality: PERFECT,
        });
      }
    }
    const aliasBucket = this.aliasExact.get(strictQuery);
    if (aliasBucket !== undefined) {
      for (const [merchantId, raw] of aliasBucket) {
        consider(merchantId, { tier: 'exact_alias', matchedOn: 'exact_alias', matchedValue: raw, quality: PERFECT });
      }
    }

    // Recall: loose keys return EVERY owner as a lower tier. Query-only
    // conjunction variants (وبي تك → بي تك) extend recall, never exact maps.
    const looseQueries = [
      looseQuery,
      ...conjunctionVariants(looseQuery, (token) => this.tokenPostings.has(token)),
    ];
    for (const variant of looseQueries) {
      const owners = this.looseKeyOwners.get(variant);
      if (owners === undefined) continue;
      for (const [merchantId, raw] of owners) {
        consider(merchantId, { tier: 'normalized_variant', matchedOn: 'normalized_variant', matchedValue: raw, quality: PERFECT });
      }
    }

    this.matchPartial(queryTokens, consider);
    this.matchTypo(queryTokens, consider);
  }

  private matchPartial(queryTokens: string[], consider: Consider): void {
    for (const merchantId of this.candidatePool(queryTokens)) {
      for (const candidate of this.candidatesByMerchant.get(merchantId) ?? []) {
        if (!queryTokens.every((token) => candidate.looseTokens.includes(token))) continue;
        consider(merchantId, {
          tier: 'partial_name',
          matchedOn: 'partial_name',
          matchedValue: candidate.display,
          quality: { fuzzyTokens: 0, extraTokens: candidate.looseTokens.length - queryTokens.length, editDistance: 0 },
        });
        break;
      }
    }
  }

  private matchTypo(queryTokens: string[], consider: Consider): void {
    const maxFuzzyTokens = queryTokens.length >= 3 ? 2 : 1;
    for (const merchantId of this.typoPool(queryTokens)) {
      for (const candidate of this.candidatesByMerchant.get(merchantId) ?? []) {
        const quality = this.candidateTypoQuality(candidate, queryTokens, maxFuzzyTokens);
        if (quality !== null) {
          consider(merchantId, { tier: 'typo', matchedOn: 'typo', matchedValue: candidate.display, quality });
        }
      }
    }
  }

  /**
   * Bounded typo pool: merchants owning any candidate token that shares a
   * trigram with a query token. Token-level postings keep the pool the union
   * of real token owners instead of every merchant sharing a hot gram.
   */
  private typoPool(queryTokens: string[]): Set<string> {
    const pool = new Set<string>();
    for (const token of queryTokens) {
      for (const gram of trigrams(token)) {
        const tokBucket = this.trigramTokenPostings.get(gram);
        if (tokBucket === undefined) continue;
        for (const tok of tokBucket) {
          const owners = this.tokenPostings.get(tok);
          if (owners === undefined) continue;
          for (const merchantId of owners) pool.add(merchantId);
        }
      }
    }
    return pool;
  }
  private candidateTypoQuality(
    candidate: CandidateTokens,
    queryTokens: string[],
    maxFuzzyTokens: number,
  ): HitQuality | null {
    const unmatched = queryTokens.filter((token) => !candidate.looseTokens.includes(token));
    if (unmatched.length === 0 || unmatched.length > maxFuzzyTokens) return null;
    // Every non-fuzzy query token must exact-match a candidate token.
    const coveredQueryTokens = queryTokens.length - unmatched.length;
    if (coveredQueryTokens < queryTokens.length - maxFuzzyTokens) return null;
    let editDistance = 0;
    for (const token of unmatched) {
      const distance = this.bestTypoDistance(token, candidate.looseTokens);
      if (distance === null) return null;
      editDistance += distance;
    }
    const coveredCandidateTokens = candidate.looseTokens.filter((t) => queryTokens.includes(t)).length;
    return {
      fuzzyTokens: unmatched.length,
      extraTokens: candidate.looseTokens.length - coveredCandidateTokens,
      editDistance,
    };
  }
  private bestTypoDistance(token: string, candidateTokens: string[]): number | null {
    const allowed = token.length >= 8 ? 2 : 1;
    let best: number | null = null;
    // Length window narrows before any trigram or DP work.
    const minLen = token.length - allowed;
    const maxLen = token.length + allowed;
    for (const candidateToken of candidateTokens) {
      // 4-char minimum keeps short tokens out of fuzzy rescue while still
      // reaching real brand tokens like "tech".
      if (candidateToken === token || candidateToken.length < 4) continue;
      if (candidateToken.length < minLen || candidateToken.length > maxLen) continue;
      const distance = levenshtein(token, candidateToken);
      if (distance <= allowed && (best === null || distance < best)) {
        best = distance;
      }
    }
    return best;
  }

  /** Posting-list intersection: merchants holding any informative query token. */
  private candidatePool(queryTokens: string[]): Set<string> {
    const pool = new Set<string>();
    for (const token of queryTokens) {
      const bucket = this.tokenPostings.get(token);
      if (bucket === undefined) continue;
      for (const merchantId of bucket) {
        if ((this.candidatesByMerchant.get(merchantId)?.length ?? 0) > 0) pool.add(merchantId);
      }
    }
    return pool;
  }
}

function mergeHit(best: Map<string, BestHit>, merchantId: string, hit: BestHit): void {
  const existing = best.get(merchantId);
  if (existing === undefined) {
    best.set(merchantId, hit);
    return;
  }
  const tierDelta = TIER_ORDER[hit.tier] - TIER_ORDER[existing.tier];
  if (tierDelta < 0 || (tierDelta === 0 && compareQuality(hit.quality, existing.quality) < 0)) {
    best.set(merchantId, hit);
  }
}

function compareQuality(a: HitQuality, b: HitQuality): number {
  return a.fuzzyTokens - b.fuzzyTokens || a.extraTokens - b.extraTokens || a.editDistance - b.editDistance;
}
