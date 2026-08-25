import type { IdentifierKind, InputKind } from './types';

const KNOWN_URL_HOSTS = ['facebook.com', 'instagram.com', 'tiktok.com', 'g.page', 'goo.gl'] as const;

/** Chars mapped to spaces before tokenizing: dot, underscore, dash, slash, comma, parens, pipe. */
const NAME_PUNCTUATION = /[._\-/,()|]/g;
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670]/g;

export function detectInputKind(input: string): InputKind {
  const trimmed = input.trim();
  if (trimmed.length === 0) return 'name';
  if (/^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) return 'url';
  const lowered = trimmed.toLowerCase();
  if (KNOWN_URL_HOSTS.some((host) => lowered.includes(host))) return 'url';
  const compact = trimmed.replace(/[\s\-().]/g, '');
  if (/^\+?[0-9]+$/.test(compact) && compact.replace(/\D/g, '').length >= 9) return 'phone';
  return 'name';
}

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
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

export function normalizeQueryUrl(
  input: string,
): { kind: IdentifierKind; normalized: string; hostKey: string } | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
  let host = parsed.hostname.toLowerCase();
  if (host.length === 0 || !host.includes('.')) return null;
  if (host.startsWith('www.')) host = host.slice(4);

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  const firstSegment = segments[0];

  const isFacebook = host === 'facebook.com' || host.endsWith('.facebook.com');
  if (isFacebook && firstSegment !== undefined) {
    return {
      kind: 'facebook',
      normalized: `http://facebook.com/${firstSegment}`,
      hostKey: 'facebook.com',
    };
  }

  if ((host === 'instagram.com' || host.endsWith('.instagram.com')) && firstSegment !== undefined) {
    return {
      kind: 'instagram',
      normalized: `https://instagram.com/${firstSegment.toLowerCase()}`,
      hostKey: 'instagram.com',
    };
  }

  if ((host === 'tiktok.com' || host.endsWith('.tiktok.com')) && firstSegment !== undefined) {
    const handle = firstSegment.startsWith('@') ? firstSegment : `@${firstSegment}`;
    return {
      kind: 'tiktok',
      normalized: `https://tiktok.com/${handle}`,
      hostKey: 'tiktok.com',
    };
  }

  if (host === 'g.page') {
    const handle = parsed.pathname.replace(/^\//, '');
    if (handle.length > 0) {
      return {
        kind: 'google_maps',
        normalized: `https://g.page/${handle}`,
        hostKey: 'g.page',
      };
    }
  }

  // Google Maps shortlinks (goo.gl/maps/…, maps.app.goo.gl/maps/…) stored verbatim in the DB.
  if ((host === 'goo.gl' || host === 'maps.app.goo.gl') && parsed.pathname.startsWith('/maps/')) {
    return {
      kind: 'google_maps',
      normalized: `${parsed.protocol}//${host}${parsed.pathname.replace(/\/$/, '')}`,
      hostKey: 'goo.gl',
    };
  }
  return {
    kind: 'website',
    normalized: `${parsed.protocol}//${host}`,
    hostKey: host,
  };
}

export function normalizeName(input: string): string {
  const lowered = input.toLowerCase();
  const spaced = lowered.replace(NAME_PUNCTUATION, ' ');
  const unified = spaced
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647');
  const tokens = unified
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => (token.startsWith('\u0627\u0644') ? token.slice(2) : token))
    .filter((token) => token.length > 0);
  return tokens.join(' ');
}

export function nameTokens(normalizedName: string): string[] {
  return normalizedName.split(/\s+/).filter((token) => token.length > 0);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + substitutionCost);
    }
    previous = current;
  }
  return previous[b.length];
}
