import type { IdentifierKind, InputKind } from './types';

/**
 * Bare-host quarantines: generic regulator/support roots are never merchant
 * identity. A URL query landing on one of these hosts yields no hits.
 */
const EXTERNAL_REFERENCE_HOSTS: Record<string, true> = {
  'cpa.gov.eg': true,
  'shakwa.cpa-mobile.com': true,
  'support.apple.com': true,
};

/** Chars mapped to spaces before tokenizing: dot, underscore, dash, slash, comma, parens, pipe. */
const NAME_PUNCTUATION = /[._\-/,()|]/g;
/** Arabic diacritics (fatha..sukun) plus dagger alif; removed in every stage. */
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670]/g;
/** Tatweel (kashida) — a stretching glyph, never meaning-bearing: removed in every stage. */
const TATWEEL = /\u0640/g;
/** Arabic-Indic (٠-٩) and extended Persian (۰-۹) digits folded to ASCII before detection. */
const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

export function foldDigits(input: string): string {
  return input.replace(ARABIC_DIGITS, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String.fromCharCode(code - base + 0x30);
  });
}

function stageCommon(input: string): string {
  return input
    .toLowerCase()
    .replace(NAME_PUNCTUATION, ' ')
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064A');
}

/**
 * Exact-lookup normalization: lowercase, space punctuation, strip diacritics
 * and tatweel, fold alef variants and alef maqsura, collapse whitespace.
 * PRESERVES taa marbuta (ة) and the definite article (ال).
 */
export function normalizeNameStrict(input: string): string {
  const tokens = stageCommon(input).split(/\s+/).filter((t) => t.length > 0);
  return tokens.join(' ');
}

/**
 * Broad/recall normalization built on strict output: additionally folds
 * ة→ه and strips a leading ال per token. Used for the lower-tier
 * `normalized_variant` recall and token postings — never for exact maps.
 */
export function normalizeNameLoose(input: string): string {
  const tokens = stageCommon(input)
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/\u0629/g, '\u0647'))
    .map((t) => (t.startsWith('\u0627\u0644') ? t.slice(2) : t))
    .filter((t) => t.length > 0);
  return tokens.join(' ');
}

/**
 * Legacy alias kept for callers that want the loose form. Recall-only.
 */
export function normalizeName(input: string): string {
  return normalizeNameLoose(input);
}

/**
 * Query-only recall variant: strip a leading conjunction و from a token when
 * the remainder is itself plausible — length >= 3, or the query carries
 * another informative token, or the remainder already exists in the candidate
 * token index (checked via the optional predicate, wired to posting lists).
 * Used to make `وبي تك` reach `بي تك` without corrupting exact names such as
 * `ولي`.
 */
export function conjunctionVariants(
  looseQuery: string,
  tokenExists: (token: string) => boolean = () => false,
): string[] {
  const tokens = nameTokens(looseQuery);
  const variants: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (!token.startsWith('و')) continue;
    const rest = token.slice(1);
    if (rest.length === 0) continue;
    const otherInformative = tokens.some((t, j) => j !== i && t.length >= 2);
    if (rest.length >= 3 || otherInformative || tokenExists(rest)) {
      const next = [...tokens];
      next[i] = rest;
      variants.push(next.join(' '));
    }
  }
  return variants;
}

export function nameTokens(normalizedName: string): string[] {
  return normalizedName.split(/\s+/).filter((token) => token.length > 0);
}

const KNOWN_URL_HOSTS = [
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'g.page',
  'goo.gl',
  'maps.app.goo.gl',
  'maps.google.com',
  'google.com',
  'play.google.com',
  'apps.apple.com',
] as const;

const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]{2,}$/;

export function detectInputKind(rawInput: string): InputKind {
  const trimmed = foldDigits(rawInput.trim());
  if (trimmed.length === 0) return 'name';
  // A full user@domain.tld email; a leading @ is a social handle, not email.
  if (EMAIL_PATTERN.test(trimmed)) return 'email';
  if (/^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) return 'url';
  const lowered = trimmed.toLowerCase();
  if (KNOWN_URL_HOSTS.some((host) => lowered.includes(host))) return 'url';
  // Any dotted host with a path/query is a parseable URL candidate.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*/i.test(trimmed)) return 'url';
  const compact = trimmed.replace(/[\s\-().]/g, '');
  if (/^\+?[0-9]+$/.test(compact) && compact.replace(/\D/g, '').length >= 9) return 'phone';
  return 'name';
}

/**
 * Egyptian phone canonicalization — mirrors the pipeline contract: only valid
 * `+20` mobile (1[0125]xxxxxxxx) or landline ([2-9]xxxxxxxx) shapes; never
 * fabricates +20. Non-Egyptian/malformed digit blobs return null so the
 * search layer can emit `invalid_egyptian_phone` instead of name recall.
 */
export function normalizePhone(input: string): string | null {
  const digits = foldDigits(input).replace(/\D/g, '');
  if (digits.length === 0) return null;
  let countryCodeAndNational: string;
  if (digits.startsWith('00')) {
    countryCodeAndNational = digits.slice(2);
  } else if (digits.startsWith('20')) {
    countryCodeAndNational = digits;
  } else if (digits.startsWith('0')) {
    countryCodeAndNational = `20${digits.slice(1)}`;
  } else {
    return null;
  }
  if (!countryCodeAndNational.startsWith('20')) return null;
  const national = countryCodeAndNational.slice(2);
  // Mobile: 20 + 1[0125]xxxxxxxx (10 national digits).
  if (/^1[0125][0-9]{8}$/.test(national)) return `+${countryCodeAndNational}`;
  // Landline: 20 + area code + subscriber number (leading 0 of the local form already stripped).
  if (/^[2-9][0-9]{8}$/.test(national)) return `+${countryCodeAndNational}`;
  return null;
}

function isExternalReferenceHost(host: string): boolean {
  return EXTERNAL_REFERENCE_HOSTS[host] === true;
}

/** True when the input parses to a URL on a quarantined generic host. */
export function isExternalReferenceUrl(input: string): boolean {
  const trimmed = foldDigits(input.trim());
  if (trimmed.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return false;
  }
  return isExternalReferenceHost(parsed.hostname.toLowerCase().replace(/^www\./, ''));
}

export interface NormalizedQueryUrl {
  kind: IdentifierKind;
  /** Canonical exact value (scheme-defaulted to https for bare domains). */
  normalized: string;
  /** Scheme-free canonical value for secondary matching. */
  schemeless: string;
  hostKey: string;
  /** Platform tokens: account key + full subpath keys. */
  pathKeys: string[];
  /** Bare-host origin key, used only for single-owner/brand-family fallback. */
  originKey: string | null;
  externalReference: boolean;
}

/** Identity-bearing query params preserved when stripping tracking noise. */
const IDENTITY_QUERY_KEYS = new Set(['id']);

function stripTracking(url: URL): string {
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (IDENTITY_QUERY_KEYS.has(key.toLowerCase())) kept.set(key, value);
  }
  const qs = kept.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

function cleanPath(url: URL): string {
  return url.pathname.replace(/\/+$/, '');
}

export function normalizeQueryUrl(rawInput: string): NormalizedQueryUrl | null {
  const input = foldDigits(rawInput.trim());
  if (input.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  let host = parsed.hostname.toLowerCase();
  if (host.length === 0 || !host.includes('.')) return null;
  if (host.startsWith('www.')) host = host.slice(4);

  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  const first = segments[0];
  const path = cleanPath(parsed);
  const externalReference = isExternalReferenceHost(host);

  // Social platforms: account key + full subpath.
  const social = (kind: IdentifierKind, canonicalHost: string, handle: string): NormalizedQueryUrl => {
    const accountKey = `${canonicalHost}/${handle}`.toLowerCase();
    const fullSub = path.length > 0 ? `${canonicalHost}${path}`.toLowerCase() : null;
    return {
      kind,
      normalized: `https://${canonicalHost}/${handle}`,
      schemeless: `${canonicalHost}/${handle}`.toLowerCase(),
      hostKey: canonicalHost,
      pathKeys: fullSub !== null && fullSub !== accountKey ? [accountKey, fullSub] : [accountKey],
      originKey: null, // shared platform host: never bare-host fallback
      externalReference,
    };
  };

  if ((host === 'facebook.com' || host.endsWith('.facebook.com')) && first !== undefined) {
    // profile.php?id=… pages key on the numeric id.
    if (first === 'profile.php') {
      const profileId = parsed.searchParams.get('id');
      if (profileId !== null && profileId.length > 0) {
        const result = social('facebook', 'facebook.com', `profile.php?id=${profileId}`);
        return { ...result, normalized: `https://facebook.com/profile.php?id=${profileId}` };
      }
    }
    return social('facebook', 'facebook.com', first);
  }

  if ((host === 'instagram.com' || host.endsWith('.instagram.com')) && first !== undefined) {
    return social('instagram', 'instagram.com', first.toLowerCase());
  }

  if ((host === 'tiktok.com' || host.endsWith('.tiktok.com')) && first !== undefined) {
    const handle = first.startsWith('@') ? first : `@${first}`;
    return social('tiktok', 'tiktok.com', handle);
  }

  // Google Maps platforms: g.page, goo.gl/maps, maps.app.goo.gl, google.com/maps, maps.google.com.
  const isGoogleMaps =
    host === 'g.page'
    || ((host === 'goo.gl' || host === 'maps.app.goo.gl') && path.startsWith('/maps'))
    || ((host === 'google.com' || host === 'maps.google.com') && (path.startsWith('/maps') || path.startsWith('/place')));

  if (host === 'g.page' && path.length > 0) {
    const gkey = `g.page${path}`.toLowerCase();
    return {
      kind: 'google_maps',
      normalized: `https://g.page${path}`,
      schemeless: gkey,
      hostKey: 'g.page',
      pathKeys: [gkey],
      originKey: null,
      externalReference,
    };
  }

  if (isGoogleMaps && host !== 'g.page' && path.length > 0) {
    const gkey = `${host}${path}`.toLowerCase();
    return {
      kind: 'google_maps',
      normalized: `https://${host}${path}`,
      schemeless: gkey,
      hostKey: host,
      pathKeys: [gkey],
      originKey: null,
      externalReference,
    };
  }

  // App stores: item path keys only.
  if (host === 'play.google.com' && path.startsWith('/store/apps/')) {
    const idQuery = stripTracking(parsed);
    const key = `play.google.com${path}${idQuery}`.toLowerCase();
    return {
      kind: 'marketplace',
      normalized: `https://play.google.com${path}${idQuery}`,
      schemeless: key,
      hostKey: 'play.google.com',
      pathKeys: [key],
      originKey: null,
      externalReference,
    };
  }

  if (host === 'apps.apple.com' && /\/id\d+/.test(path)) {
    const key = `apps.apple.com${path}`.toLowerCase();
    return {
      kind: 'marketplace',
      normalized: `https://apps.apple.com${path}`,
      schemeless: key,
      hostKey: 'apps.apple.com',
      pathKeys: [key],
      originKey: null,
      externalReference,
    };
  }
  if (parsed.search !== '' || segments.length > 0) {
    const qs = stripTracking(parsed);
    const hostPath = `${host}${path}${qs}`.toLowerCase();
    return {
      // Generic host+path URLs are first-party websites with a full path
      // key; the bare origin remains available for host fallback (single
      // owner or shared brand family only, enforced in search.ts).
      kind: 'website',
      normalized: `https://${host}${path}${qs}`,
      schemeless: hostPath,
      hostKey: host,
      pathKeys: [hostPath, host],
      originKey: host,
      externalReference,
    };
  }

  // First-party website: origin key (bare-host fallback allowed) + origin exact key.
  const origin = `${host}`;
  return {
    kind: 'website',
    normalized: `https://${host}`,
    schemeless: origin,
    hostKey: origin,
    pathKeys: [origin],
    originKey: origin,
    externalReference,
  };
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + substitutionCost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Character trigram set used to pre-filter typo comparisons. */
export function trigrams(token: string): Set<string> {
  const padded = `  ${token} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}
