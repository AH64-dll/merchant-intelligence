import { describe, expect, it } from 'vitest';

import {
  ageInDays,
  displaySummary,
  formatDate,
  formatDateAr,
  formatDateEn,
  safeHttpUrl,
  sourceCategoryLabel,
  timeDir,
} from './display';

describe('safeHttpUrl', () => {
  it('accepts absolute https/http URLs and normalizes them to href', () => {
    expect(safeHttpUrl('https://example.test/p')).toBe('https://example.test/p');
    expect(safeHttpUrl('http://example.test/p')).toBe('http://example.test/p');
    // Scheme and host are case-insensitive; URL canonicalizes the output.
    expect(safeHttpUrl('HTTPS://Example.Test/P')).toBe('https://example.test/P');
    // IPv6 literal hosts are valid http(s) URLs.
    expect(safeHttpUrl('https://[::1]/p')).toBe('https://[::1]/p');
    // Surrounding whitespace is tolerated.
    expect(safeHttpUrl('  https://example.test/p  ')).toBe('https://example.test/p');
  });

  it('adds a trailing slash when canonicalizing a bare origin', () => {
    expect(safeHttpUrl('https://example.test')).toBe('https://example.test/');
  });

  it('rejects non-http protocols and scheme-relative values', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>')).toBeNull();
    expect(safeHttpUrl('ftp://x/p')).toBeNull();
    expect(safeHttpUrl('whois:x')).toBeNull();
    expect(safeHttpUrl('//host/p')).toBeNull();
  });

  it('rejects relative, empty, host-less, and non-string input', () => {
    expect(safeHttpUrl('example.test/x')).toBeNull();
    expect(safeHttpUrl('https://')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl('   ')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });

  it('rejects annotated whole-string values that are not pure URLs', () => {
    expect(safeHttpUrl('https://example.test (record: abc)')).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats Arabic dates with formatDateAr and formatDate(..., "ar")', () => {
    expect(formatDateAr('2026-01-15T10:00:00+00:00')).toMatch(/٢٠٢٦|2026/);
    expect(formatDate('2026-01-15T10:00:00+00:00', 'ar')).toMatch(/٢٠٢٦|2026/);
    expect(formatDateAr('not-a-date')).toBe('not-a-date');
  });

  it('formats English dates with formatDateEn and formatDate(..., "en")', () => {
    const en = formatDateEn('2026-01-15T10:00:00+00:00');
    expect(en).toContain('January');
    expect(en).toContain('15');
    expect(en).toContain('2026');

    const localized = formatDate('2026-01-15T10:00:00+00:00', 'en');
    expect(localized).toBe(en);
  });
});

describe('timeDir', () => {
  it('returns ltr for English and auto for Arabic to prevent digit inversion', () => {
    expect(timeDir('en')).toBe('ltr');
    expect(timeDir('ar')).toBe('auto');
    expect(timeDir()).toBe('auto');
  });
});

describe('sourceCategoryLabel', () => {
  it('returns Arabic and English source category labels', () => {
    expect(sourceCategoryLabel('customer_report', 'ar')).toBe('تقرير عميل');
    expect(sourceCategoryLabel('customer_report', 'en')).toBe('Customer report');
    expect(sourceCategoryLabel('merchant_site', 'en')).toBe('Merchant site / page');
  });
});

describe('ageInDays', () => {
  it('computes whole-day age and yields null for invalid input', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    expect(ageInDays('2026-01-30T00:00:00Z', now)).toBe(2);
    expect(ageInDays('garbage', now)).toBeNull();
  });
});

describe('displaySummary', () => {
  it('replaces PLACEHOLDER_SUMMARY with honest localized note', () => {
    const placeholder = 'Source cited without a model-supplied summary.';
    expect(displaySummary(placeholder, 'ar')).toContain('لم يُسجَّل ملخص لهذا المصدر');
    expect(displaySummary(placeholder, 'en')).toContain('No summary was recorded for this source');
  });

  it('replaces empty summary with honest localized note', () => {
    expect(displaySummary('', 'ar')).toContain('لم يُسجَّل ملخص لهذا المصدر');
    expect(displaySummary(null, 'en')).toContain('No summary was recorded for this source');
  });

  it('preserves genuine summaries verbatim', () => {
    expect(displaySummary('تجربة شراء ممتازة', 'ar')).toBe('تجربة شراء ممتازة');
    expect(displaySummary('Great delivery service', 'en')).toBe('Great delivery service');
  });
});
