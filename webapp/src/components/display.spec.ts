import { describe, expect, it } from 'vitest';

import { ageInDays, formatDateAr, safeHttpUrl } from './display';

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

describe('formatDateAr', () => {
  it('formats valid ISO timestamps and falls back to the date part for invalid input', () => {
    expect(formatDateAr('2026-01-15T10:00:00+00:00')).toMatch(/٢٠٢٦|2026/);
    expect(formatDateAr('not-a-date')).toBe('not-a-date');
  });
});

describe('ageInDays', () => {
  it('computes whole-day age and yields null for invalid input', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    expect(ageInDays('2026-01-30T00:00:00Z', now)).toBe(2);
    expect(ageInDays('garbage', now)).toBeNull();
  });
});
