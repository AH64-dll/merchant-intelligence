import { PLACEHOLDER_SUMMARY } from '@/lib/types';
import { t } from '@/lib/i18n';
import type { SourceCategory } from '@/lib/taxonomy';
import { SOURCE_CATEGORY_LABELS } from '@/lib/taxonomy';
import type { Locale } from '@/lib/i18n';

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

/** Localized label for a derived source category (controlled taxonomy). */
export function sourceCategoryLabel(category: SourceCategory, locale: Locale = 'ar'): string {
  const item = SOURCE_CATEGORY_LABELS[category];
  if (!item) return category;
  return locale === 'en' ? item.en : item.ar;
}

const AR_EG_DATE = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

const EN_US_DATE = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

const DATE_CACHE_MAX = 4096;
const AR_DATE_CACHE = new Map<string, string>();
const EN_DATE_CACHE = new Map<string, string>();

/**
 * Formats an ISO timestamp for display in ar-EG.
 * Note: Callers should render with dir="auto" (or timeDir(locale)), NOT dir="ltr",
 * so Arabic-Indic digits and Arabic month names maintain correct visual day-month-year order.
 */
export function formatDateAr(iso: string): string {
  const hit = AR_DATE_CACHE.get(iso);
  if (hit !== undefined) return hit;
  const date = new Date(iso);
  const formatted = Number.isNaN(date.getTime()) ? iso.slice(0, 10) : AR_EG_DATE.format(date);
  if (AR_DATE_CACHE.size >= DATE_CACHE_MAX) {
    AR_DATE_CACHE.clear();
  }
  AR_DATE_CACHE.set(iso, formatted);
  return formatted;
}

/**
 * Formats an ISO timestamp for display in en-US.
 */
export function formatDateEn(iso: string): string {
  const hit = EN_DATE_CACHE.get(iso);
  if (hit !== undefined) return hit;
  const date = new Date(iso);
  const formatted = Number.isNaN(date.getTime()) ? iso.slice(0, 10) : EN_US_DATE.format(date);
  if (EN_DATE_CACHE.size >= DATE_CACHE_MAX) {
    EN_DATE_CACHE.clear();
  }
  EN_DATE_CACHE.set(iso, formatted);
  return formatted;
}

/**
 * Locale-aware date formatter.
 */
export function formatDate(iso: string, locale: Locale = 'ar'): string {
  return locale === 'en' ? formatDateEn(iso) : formatDateAr(iso);
}

/**
 * Returns the HTML `dir` attribute for a `<time>` element displaying a date.
 * English dates use "ltr". Arabic dates (which contain Arabic month names and numerals)
 * use "auto" to prevent the Unicode Bidirectional Algorithm from visually inverting
 * day and year order in RTL contexts.
 */
export function timeDir(locale: Locale = 'ar'): 'ltr' | 'auto' {
  return locale === 'en' ? 'ltr' : 'auto';
}

/** Days elapsed since an ISO timestamp; negative/invalid input yields null. */
export function ageInDays(iso: string, now: Date = new Date()): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Returns a display-safe summary string. If the stored summary is empty or
 * matches the pipeline fallback PLACEHOLDER_SUMMARY, returns a localized honest note
 * explaining that no summary was recorded for this source.
 */
export function displaySummary(summary: string | null | undefined, locale: Locale = 'ar'): string {
  if (!summary) return t(locale).placeholderSummary;
  const trimmed = summary.trim();
  if (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === PLACEHOLDER_SUMMARY.toLowerCase()
  ) {
    return t(locale).placeholderSummary;
  }
  return trimmed;
}
