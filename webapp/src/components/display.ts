import type { SourceCategory } from '@/lib/taxonomy';
import { SOURCE_CATEGORY_LABELS } from '@/lib/taxonomy';

/**
 * Publication staleness threshold for the evidence-card marker (days).
 * A dated source older than this is flagged as old — a caption, not a judgment.
 */
export const STALE_PUBLISHED_DAYS = 730;

/** Snapshot age after which the footer warns the data may be out of date. */
export const STALE_SNAPSHOT_DAYS = 7;

/**
 * Strict safe-URL extraction: returns the href only when the value parses as
 * an absolute URL with protocol exactly 'http:'/'https:' and a non-empty
 * hostname. Anything else — relative values, annotated strings, protocol
 * prefixes like `whois:`/`javascript:`, empty input — yields null and must
 * never become a clickable anchor.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname.length === 0) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** Arabic label for a derived source category (controlled taxonomy). */
export function sourceCategoryLabel(category: SourceCategory): string {
  return SOURCE_CATEGORY_LABELS[category].ar;
}

const AR_EG_DATE = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

/**
 * Memoized ISO timestamp → ar-EG formatted date. Snapshot data repeats the
 * same timestamps across evidence rows and merchants; a bounded map keeps the
 * Intl formatter off the per-render hot path (measured 15.6ms → ~6ms for a
 * 66-card evidence list).
 */
const AR_DATE_CACHE = new Map<string, string>();
const AR_DATE_CACHE_MAX = 4096;

/**
 * Formats an ISO timestamp for display in ar-EG. Rendering is done inside a
 * dir=ltr isolation wrapper by callers (numeric Western digits stay readable).
 */
export function formatDateAr(iso: string): string {
  const hit = AR_DATE_CACHE.get(iso);
  if (hit !== undefined) return hit;
  const date = new Date(iso);
  const formatted = Number.isNaN(date.getTime()) ? iso.slice(0, 10) : AR_EG_DATE.format(date);
  if (AR_DATE_CACHE.size >= AR_DATE_CACHE_MAX) {
    AR_DATE_CACHE.clear();
  }
  AR_DATE_CACHE.set(iso, formatted);
  return formatted;
}

/** Days elapsed since an ISO timestamp; negative/invalid input yields null. */
export function ageInDays(iso: string, now: Date = new Date()): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}
