import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SearchBox } from './SearchBox';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));


describe('SearchBox', () => {
  it('exposes a visible label, role=search, and all input attributes', () => {
    const html = renderToStaticMarkup(createElement(SearchBox)).toLowerCase();
    expect(html).toContain('role="search"');
    expect(html).toContain('<label');
    expect(html).toContain('for="merchant-search"');
    expect(html).toContain('type="search"');
    expect(html).toContain('maxlength="300"');
    expect(html).toContain('enterkeyhint="search"');
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain('autocapitalize="off"');
    expect(html).toContain('spellcheck="false"');
  });

  it('carries the safe product copy, not trust promises', () => {
    const html = renderToStaticMarkup(createElement(SearchBox));
    expect(html).toContain('ابحث عن تاجر');
    expect(html).not.toContain('موثوق');
    expect(html).not.toContain('الحكم');
    expect(html).not.toContain('التقييمات');
  });

  it('has a submit button with the design search-submit class', () => {
    const html = renderToStaticMarkup(createElement(SearchBox));
    expect(html).toContain('search-submit');
    expect(html).toContain('type="submit"');
  });

  it('renders English product copy when locale is en', () => {
    const html = renderToStaticMarkup(createElement(SearchBox, { locale: 'en' }));
    expect(html).toContain('Search for a vendor');
    expect(html).toContain('Search</span>');
    expect(html).toContain('Egyptian phone number, vendor name, or page/account link.');
  });
});
