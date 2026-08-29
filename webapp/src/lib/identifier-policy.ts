import type { IdentifierKind } from './types';

/**
 * Application policy over stored identifiers: which kinds/values are
 * searchable and which are quarantined as generic external references.
 * Raw values always remain in SQLite and audit output — this policy governs
 * only the search/display surface.
 */
export type IdentifierRole =
  | 'contact'
  | 'owned_site'
  | 'social_profile'
  | 'marketplace_profile'
  | 'directory_profile'
  | 'location'
  | 'registration'
  | 'external_reference';

const ROLE_BY_KIND: Record<IdentifierKind, IdentifierRole> = {
  phone: 'contact',
  whatsapp: 'contact',
  email: 'contact',
  website: 'owned_site',
  facebook: 'social_profile',
  instagram: 'social_profile',
  tiktok: 'social_profile',
  marketplace: 'marketplace_profile',
  google_maps: 'location',
  commercial_register: 'registration',
  address: 'location',
};

/** Generic regulator/support roots — never merchant-owned identity. */
const EXTERNAL_REFERENCE_HOSTS: Record<string, true> = {
  'cpa.gov.eg': true,
  'shakwa.cpa-mobile.com': true,
  'support.apple.com': true,
};

/** Bare hosts eligible for website-origin fallback (first-party sites only). */
const SHARED_PROFILE_HOSTS: Record<string, true> = {
  'facebook.com': true,
  'instagram.com': true,
  'tiktok.com': true,
  'g.page': true,
  'goo.gl': true,
  'maps.app.goo.gl': true,
  'maps.google.com': true,
  'google.com': true,
  'play.google.com': true,
  'apps.apple.com': true,
};

export function identifyIdentifierRole(kind: IdentifierKind, normalizedValue: string): IdentifierRole {
  if (kind === 'website' || kind === 'marketplace') {
    const host = urlHost(normalizedValue);
    if (host !== null && EXTERNAL_REFERENCE_HOSTS[host] === true) {
      return 'external_reference';
    }
  }
  return ROLE_BY_KIND[kind];
}

/**
 * Search eligibility: role must not be external_reference and the value must
 * have a searchable shape (URL kinds must carry a path; phones must be valid).
 */
export function isSearchableIdentifier(kind: IdentifierKind, normalizedValue: string): boolean {
  if (identifyIdentifierRole(kind, normalizedValue) === 'external_reference') return false;
  if (kind === 'phone' || kind === 'whatsapp') return isEgyptianPhoneShape(normalizedValue);
  if (kind === 'website' || kind === 'marketplace' || kind === 'facebook' || kind === 'instagram' || kind === 'tiktok' || kind === 'google_maps') {
    return hasSearchablePath(kind, normalizedValue);
  }
  if (kind === 'email') return normalizedValue.includes('@') && normalizedValue.includes('.');
  return true;
}

function isEgyptianPhoneShape(normalized: string): boolean {
  const digits = normalized.replace(/\D/g, '');
  if (!normalized.startsWith('+20')) return false;
  const national = digits.slice(2);
  return /^1[0125][0-9]{8}$/.test(national) || /^[2-9][0-9]{8}$/.test(national);
}

function hasSearchablePath(kind: IdentifierKind, normalized: string): boolean {
  const host = urlHost(normalized);
  if (host === null) return false;
  if (kind === 'website') return true; // bare origin is a legitimate owned-site key
  if (SHARED_PROFILE_HOSTS[host] === true) {
    // platform profiles must carry an item path (account key, /maps/…, app id…)
    const path = urlPath(normalized);
    return path.length > 0 && path !== '/';
  }
  return true;
}

function urlHost(value: string): string | null {
  try {
    const url = new URL(value);
    let host = url.hostname.toLowerCase();
    if (host.length === 0 || !host.includes('.')) return null;
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    return null;
  }
}

function urlPath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return '';
  }
}

/** Display policy: quarantined identifiers are hidden from merchant detail UI. */
export function isDisplayableIdentifier(kind: IdentifierKind, normalizedValue: string): boolean {
  return isSearchableIdentifier(kind, normalizedValue);
}
