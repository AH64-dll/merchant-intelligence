import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SearchBox } from './SearchBox';

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

  it('has a submit button with a ≥44px target class', () => {
    const html = renderToStaticMarkup(createElement(SearchBox));
    expect(html).toContain('min-h-[44px]');
    expect(html).toContain('type="submit"');
  });
});
