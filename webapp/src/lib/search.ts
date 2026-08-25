import type { IndexData, MerchantDb } from './db';
import { detectInputKind, levenshtein, normalizeName, normalizePhone, normalizeQueryUrl, nameTokens } from './normalize';
import type { InputKind, MatchedOn, SearchHit, Merchant, IdentifierKind } from './types';

interface CandidateTokens {
  merchantId: string;
  tokens: string[];
  display: string;
}

const SCORE_IDENTIFIER_EXACT = 1.0;
const SCORE_HOST_FALLBACK = 0.9;
const SCORE_NAME_EXACT = 0.95;
const SCORE_PATH_MATCH = 0.95;
const SCORE_FUZZY_BASE = 0.8;
const SCORE_FUZZY_STEP = 0.02;
const SCORE_FUZZY_FLOOR = 0.6;
const SCORE_TYPO = 0.55;
const MIN_SCORE = 0.5;
const TYPO_MAX_TOKEN_LENGTH = 64;
const TYPO_MAX_DISTANCE = 2;
const TYPO_MIN_TOKEN_LENGTH = 5;

interface BestHit {
  score: number;
  matchedOn: MatchedOn;
  matchedValue: string;
}

export class SearchIndex {
  private readonly merchantsById: Map<string, Merchant>;
  private readonly identifierExact: Map<string, { merchantId: string; normalized: string }>;
  private readonly hostIndex: Map<string, Set<string>>;
  private readonly pathKeyIndex: Map<string, { merchantId: string; normalized: string }>;
  private readonly nameExact: Map<string, Map<string, string>>;
  private readonly aliasExact: Map<string, Map<string, string>>;
  private readonly candidates: CandidateTokens[];
  constructor(data: IndexData) {
    this.merchantsById = new Map(data.merchants.map((merchant) => [merchant.id, merchant]));
    this.identifierExact = new Map();
    this.hostIndex = new Map();
    this.pathKeyIndex = new Map();
    for (const identifier of data.identifiers) {
      const key = `${identifier.kind}\u0000${identifier.normalized}`;
      if (!this.identifierExact.has(key)) {
        this.identifierExact.set(key, { merchantId: identifier.merchantId, normalized: identifier.normalized });
      }
      const hostKey = extractHostKey(identifier.kind, identifier.normalized);
      if (hostKey !== null) {
        const hostBucket = this.hostIndex.get(`${identifier.kind}\u0000${hostKey}`) ?? new Set<string>();
        hostBucket.add(identifier.merchantId);
        this.hostIndex.set(`${identifier.kind}\u0000${hostKey}`, hostBucket);
      }
      const pathKey = extractPathKey(identifier.kind, identifier.normalized);
      if (pathKey !== null && !this.pathKeyIndex.has(pathKey)) {
        this.pathKeyIndex.set(pathKey, { merchantId: identifier.merchantId, normalized: identifier.normalized });
      }
    }
    this.nameExact = new Map();
    this.aliasExact = new Map();
    this.candidates = [];
    for (const merchant of data.merchants) {
      this.addCandidate(this.nameExact, merchant.id, merchant.canonicalName);
    }
    for (const alias of data.aliases) {
      this.addCandidate(this.aliasExact, alias.merchantId, alias.alias);
    }
  }

  private addCandidate(map: Map<string, Map<string, string>>, merchantId: string, raw: string): void {
    const normalized = normalizeName(raw);
    const tokens = nameTokens(normalized);
    if (tokens.length === 0) {
      return;
    }
    const bucket = map.get(normalized) ?? new Map<string, string>();
    if (!bucket.has(merchantId)) {
      bucket.set(merchantId, raw);
    }
    map.set(normalized, bucket);
    this.candidates.push({ merchantId, tokens, display: raw });
  }

  static fromDb(db: MerchantDb): SearchIndex {
    return new SearchIndex(db.getIndexData());
  }

  search(query: string, limit: number = 10): { detectedType: InputKind; hits: SearchHit[] } {
    const detectedType = detectInputKind(query);
    const best = new Map<string, BestHit>();
    const consider = (merchantId: string, hit: BestHit): void => {
      const existing = best.get(merchantId);
      if (existing === undefined || hit.score > existing.score) {
        best.set(merchantId, hit);
      }
    };

    this.matchIdentifiers(query, consider);
    this.matchNames(query, consider);

    const merchants = this.merchantsById;
    const hits: SearchHit[] = [];
    for (const [merchantId, hit] of best) {
      if (hit.score < MIN_SCORE) {
        continue;
      }
      const merchant = merchants.get(merchantId);
      if (merchant === undefined) {
        continue;
      }
      hits.push({ merchant, score: hit.score, matchedOn: hit.matchedOn, matchedValue: hit.matchedValue });
    }
    hits.sort((a, b) =>
      b.score - a.score
      || b.merchant.identityConfidence - a.merchant.identityConfidence
      || a.merchant.id.localeCompare(b.merchant.id),
    );
    return { detectedType, hits: hits.slice(0, Math.max(0, limit)) };
  }

  private matchIdentifiers(query: string, consider: (merchantId: string, hit: BestHit) => void): void {
    const phone = normalizePhone(query);
    if (phone !== null) {
      for (const kind of ['phone', 'whatsapp'] as const) {
        const found = this.identifierExact.get(`${kind}\u0000${phone}`);
        if (found !== undefined) {
          consider(found.merchantId, { score: SCORE_IDENTIFIER_EXACT, matchedOn: kind, matchedValue: found.normalized });
        }
      }
    }

    const url = normalizeQueryUrl(query);
    if (url !== null) {
      const exact = this.identifierExact.get(`${url.kind}\u0000${url.normalized}`);
      if (exact !== undefined) {
        consider(exact.merchantId, { score: SCORE_IDENTIFIER_EXACT, matchedOn: url.kind, matchedValue: exact.normalized });
      }
      // Scheme/case-insensitive page match for handle-bearing hosts: a user
      // pasting https://www.facebook.com/{handle}/ must resolve to that page's
      // owner, not tie every facebook merchant together via host equality.
      const pathKey = extractPathKey(url.kind, url.normalized);
      if (pathKey !== null) {
        const byPath = this.pathKeyIndex.get(pathKey);
        if (byPath !== undefined) {
          consider(byPath.merchantId, {
            score: SCORE_PATH_MATCH,
            matchedOn: url.kind,
            matchedValue: byPath.normalized,
          });
        }
      }
      // Host fallback only where the domain itself identifies the merchant
      // (own websites / marketplaces). Shared-host kinds (facebook.com etc.)
      // would otherwise match every merchant on the platform at once.
      const hostMatchedOn: MatchedOn | null =
        url.kind === 'website' ? 'website-host'
        : url.kind === 'marketplace' ? 'marketplace-host'
        : null;
      if (hostMatchedOn !== null) {
        const bucket = this.hostIndex.get(`${url.kind}\u0000${url.hostKey}`);
        if (bucket !== undefined) {
          for (const merchantId of bucket) {
            consider(merchantId, {
              score: SCORE_HOST_FALLBACK,
              matchedOn: hostMatchedOn,
              matchedValue: url.hostKey,
            });
          }
        }
      }
    }

    const email = query.trim().toLowerCase();
    const emailHit = this.identifierExact.get(`email\u0000${email}`);
    if (emailHit !== undefined) {
      consider(emailHit.merchantId, { score: SCORE_IDENTIFIER_EXACT, matchedOn: 'email', matchedValue: emailHit.normalized });
    }
  }

  private matchNames(query: string, consider: (merchantId: string, hit: BestHit) => void): void {
    const normalizedQuery = normalizeName(query);
    const queryTokens = [...new Set(nameTokens(normalizedQuery))];
    if (queryTokens.length === 0) {
      return;
    }

    for (const [map, matchedOn] of [
      [this.nameExact, 'name_exact'],
      [this.aliasExact, 'alias_exact'],
    ] as const) {
      const bucket = map.get(normalizedQuery);
      if (bucket !== undefined) {
        for (const [merchantId, raw] of bucket) {
          const display = matchedOn === 'name_exact'
            ? this.merchantsById.get(merchantId)?.canonicalName ?? raw
            : raw;
          consider(merchantId, { score: SCORE_NAME_EXACT, matchedOn, matchedValue: display });
        }
      }
    }

    for (const candidate of this.candidates) {
      if (queryTokens.every((token) => candidate.tokens.includes(token))) {
        const spread = candidate.tokens.length - queryTokens.length;
        const score = Math.max(SCORE_FUZZY_FLOOR, SCORE_FUZZY_BASE - SCORE_FUZZY_STEP * spread);
        consider(candidate.merchantId, { score, matchedOn: 'name_fuzzy', matchedValue: candidate.display });
      }
    }

    if (queryTokens.length === 1 && queryTokens[0].length <= TYPO_MAX_TOKEN_LENGTH) {
      const token = queryTokens[0];
      for (const candidate of this.candidates) {
        for (const candidateToken of candidate.tokens) {
          if (
            candidateToken.length >= TYPO_MIN_TOKEN_LENGTH
            && token !== candidateToken
            && Math.abs(token.length - candidateToken.length) <= TYPO_MAX_DISTANCE
            && levenshtein(token, candidateToken) <= TYPO_MAX_DISTANCE
          ) {
            consider(candidate.merchantId, { score: SCORE_TYPO, matchedOn: 'name_fuzzy', matchedValue: candidate.display });
            break;
          }
        }
      }
    }
  }
}

function extractPathKey(kind: IdentifierKind, normalized: string): string | null {
  if (kind !== 'facebook' && kind !== 'instagram' && kind !== 'tiktok' && kind !== 'google_maps') {
    return null;
  }
  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '') {
      return null; // bare-host queries must not tie every merchant on the platform
    }
    return `${host}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

function extractHostKey(kind: IdentifierKind, normalized: string): string | null {
  if (kind !== 'facebook' && kind !== 'website' && kind !== 'marketplace' && kind !== 'instagram' && kind !== 'tiktok' && kind !== 'google_maps') {
    return null;
  }
  try {
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
