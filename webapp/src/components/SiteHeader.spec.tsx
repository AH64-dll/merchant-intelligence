import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SiteHeader } from './SiteHeader';
import { ShellChrome } from './ShellChrome';

describe('SiteHeader (Bayyna Topbar)', () => {
  it('renders complete Arabic topbar, brand, breadcrumb, and language switcher targeting English', () => {
    const html = renderToStaticMarkup(createElement(SiteHeader, { locale: 'ar' }));

    // Topbar container and classes
    expect(html).toContain('class="topbar"');

    // Mobile brand mark & copy
    expect(html).toContain('class="mobile-brand"');
    expect(html).toContain('class="brand-mark"');
    expect(html).toContain('brand-fingerprint');
    expect(html).toContain('دليل التجار');
    expect(html).toContain('دليل التجار');
    expect(html).toContain('للبحث في البائعين');

    // Breadcrumb (home default)
    expect(html).toContain('class="breadcrumb"');
    expect(html).toContain('الرئيسية');

    // Independent research platform label
    expect(html).toContain('class="independent-label"');
    expect(html).toContain('class="tiny-dot"');
    expect(html).toContain('منصة بحث مستقلة');

    // Language switcher targeting English
    expect(html).toContain('class="language-button"');
    expect(html).toContain('href="/en"');
    expect(html).toContain('>English</span>');
    expect(html).toContain('lang="en"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('aria-label="التحويل إلى اللغة الإنجليزية"');

    // Mobile menu trigger
    expect(html).toContain('class="mobile-menu-button"');
    expect(html).toContain('aria-label="فتح القائمة"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('renders complete English topbar, brand, breadcrumb, and language switcher targeting Arabic', () => {
    const html = renderToStaticMarkup(createElement(SiteHeader, { locale: 'en' }));

    expect(html).toContain('class="topbar"');
    expect(html).toContain('Daleel El-Togar');
    expect(html).toContain('دليل التجار');
    expect(html).toContain('Vendor research');
    expect(html).toContain('Home');
    expect(html).toContain('Independent research platform');

    // Language switcher targeting Arabic
    expect(html).toContain('class="language-button"');
    expect(html).toContain('href="/ar"');
    expect(html).toContain('>العربية</span>');
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('aria-label="Switch to Arabic"');

    // Mobile menu trigger
    expect(html).toContain('aria-label="Open menu"');
  });

  it('renders subroute breadcrumb with parent home link and chevron', () => {
    const arHtml = renderToStaticMarkup(
      createElement(SiteHeader, { locale: 'ar', pathname: '/ar/merchants' }),
    );
    expect(arHtml).toContain('href="/ar"');
    expect(arHtml).toContain('الرئيسية');
    expect(arHtml).toContain('جميع البائعين');
    expect(arHtml).toContain('lucide-chevron-left');

    const enHtml = renderToStaticMarkup(
      createElement(SiteHeader, { locale: 'en', pathname: '/en/merchants' }),
    );
    expect(enHtml).toContain('href="/en"');
    expect(enHtml).toContain('Home');
    expect(enHtml).toContain('All Vendors');
    expect(enHtml).toContain('lucide-chevron-right');
  });

  it('toggles mobile menu aria attributes on menuOpen prop', () => {
    const openHtml = renderToStaticMarkup(
      createElement(SiteHeader, { locale: 'ar', menuOpen: true }),
    );
    expect(openHtml).toContain('aria-label="إغلاق"');
    expect(openHtml).toContain('aria-expanded="true"');
    expect(openHtml).toContain('lucide-x');
  });
});

describe('ShellChrome (Application Shell)', () => {
  it('renders full Bayyna shell: fixed sidebar, brand block, nav groups, principle card, main content, and footer', () => {
    const html = renderToStaticMarkup(
      createElement(
        ShellChrome,
        { locale: 'ar', pathname: '/ar/merchants' },
        createElement('div', { id: 'test-child' }, 'Page Content'),
      ),
    );

    // Shell container with RTL
    expect(html).toContain('class="app-shell"');
    expect(html).toContain('dir="rtl"');

    // Skip link
    expect(html).toContain('class="skip-link"');
    expect(html).toContain('href="#main-content"');

    // Sidebar structure
    expect(html).toContain('class="sidebar "');
    expect(html).toContain('class="sidebar-brand"');
    expect(html).toContain('class="brand"');
    expect(html).toContain('class="brand-mark"');
    expect(html).toContain('brand-fingerprint');
    expect(html).toContain('class="brand-copy"');
    expect(html).toContain('class="brand-name"');
    expect(html).toContain('class="brand-latin"');
    expect(html).toContain('class="brand-description"');

    // Nav groups & links
    expect(html).toContain('class="main-nav"');
    expect(html).toContain('class="nav-group"');
    expect(html).toContain('class="nav-label"');
    expect(html).toContain('href="/ar"');
    expect(html).toContain('href="/ar/merchants"');
    expect(html).toContain('href="/ar/merchants/positive-evidence"');
    expect(html).toContain('href="/ar/privacy"');

    // Active route indicator on /ar/merchants
    expect(html).toContain('class="nav-item active"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('class="nav-active-dot"');

    // Sidebar bottom principle card
    expect(html).toContain('class="sidebar-bottom"');
    expect(html).toContain('class="sidebar-principle"');
    expect(html).toContain('الأدلة أولًا، دائمًا.');
    expect(html).toContain('class="small-rule"');
    expect(html).toContain('class="sidebar-caption"');

    // Main shell and content
    expect(html).toContain('class="main-shell"');
    expect(html).toContain('class="main-content"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Page Content');

    // Footer
    expect(html).toContain('class="footer"');
    expect(html).toContain('دليل التجار — للبحث، لا للترويج.');
    expect(html).toContain('المعلومة في سياقها. والقرار لك.');
    expect(html).toContain('class="footer-mark"');
    expect(html).toContain('>د.</span>');
  });

  it('renders LTR layout and English content in English locale', () => {
    const html = renderToStaticMarkup(
      createElement(
        ShellChrome,
        { locale: 'en', pathname: '/en' },
        createElement('div', null, 'Content'),
      ),
    );

    expect(html).toContain('class="app-shell"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('Daleel El-Togar');
    expect(html).toContain('RESEARCH');
    expect(html).toContain('All Vendors');
    expect(html).toContain('Evidence first. Always.');
    expect(html).toContain('Daleel El-Togar — research, not promotion.');
    expect(html).toContain('Information in context. The decision is yours.');
    expect(html).toContain('>D.</span>');
  });
});
