'use client';

import { useEffect, useState, type JSX, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, Home, Info, Scale, Search } from 'lucide-react';

import { DIR_FOR, t, type Locale } from '@/lib/i18n';
import { Brand, SiteHeader } from './SiteHeader';
import { FooterContent } from './SiteFooterContent';

export interface ShellChromeProps {
  locale: Locale;
  children?: ReactNode;
  pathname?: string;
}

function isItemActive(pathname: string, href: string, locale: Locale): boolean {
  const cleanPath = pathname.replace(/\/$/, '') || `/${locale}`;
  const cleanHref = href.replace(/\/$/, '') || `/${locale}`;

  if (cleanHref === `/${locale}`) {
    return cleanPath === `/${locale}`;
  }
  if (cleanHref === `/${locale}/merchants/positive-evidence`) {
    return (
      cleanPath === `/${locale}/merchants/positive-evidence` ||
      cleanPath.startsWith(`/${locale}/merchants/positive-evidence/`)
    );
  }
  if (cleanHref === `/${locale}/merchants`) {
    if (cleanPath.startsWith(`/${locale}/merchants/positive-evidence`)) {
      return false;
    }
    return (
      cleanPath === `/${locale}/merchants` ||
      cleanPath.startsWith(`/${locale}/merchants/`) ||
      cleanPath.startsWith(`/${locale}/merchant/`)
    );
  }
  return cleanPath === cleanHref || cleanPath.startsWith(`${cleanHref}/`);
}

/**
 * ShellChrome: Client-side chrome coordinator managing:
 * - Desktop persistent sidebar + topbar
 * - Mobile slide-over sidebar (.mobile-open) + backdrop
 * - Focus-trap + Escape + window-resize listeners matching App.tsx
 * - Active route indicator (.nav-active-dot) via usePathname
 */
export function ShellChrome({
  locale,
  children,
  pathname: propPathname,
}: ShellChromeProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const clientPathname = usePathname();
  const pathname = propPathname ?? clientPathname ?? `/${locale}`;
  const [prevPathname, setPrevPathname] = useState(pathname);
  const strings = t(locale);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMenuOpen(false);
  }
  // Focus trap and body scroll lock when mobile menu is open
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.sidebar.mobile-open a, .topbar .language-button, .topbar .mobile-menu-button',
        ),
      ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

    focusable()[0]?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    const handleResize = () => {
      if (window.innerWidth > 900) setMenuOpen(false);
    };

    document.addEventListener('keydown', trapFocus);
    window.addEventListener('resize', handleResize);

    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', trapFocus);
      window.removeEventListener('resize', handleResize);
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    };
  }, [menuOpen]);

  // Escape key closes mobile menu
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);


  const navGroups = [
    {
      label: strings.workspace,
      items: [
        { href: `/${locale}`, label: strings.home, icon: Home },
        { href: `/${locale}/merchants`, label: strings.allMerchants, icon: Building2 },
        { href: `/${locale}/search`, label: strings.search, icon: Search },
        {
          href: `/${locale}/merchants/positive-evidence`,
          label: strings.positiveEvidenceNav,
          icon: Scale,
        },
      ],
    },
    {
      label: strings.resources,
      items: [
        { href: `/${locale}/privacy`, label: strings.privacy, icon: Info },
      ],
    },
  ];

  return (
    <div className="app-shell" dir={DIR_FOR[locale]} lang={locale}>
      <a className="skip-link" href="#main-content">
        {strings.skip}
      </a>

      {/* Persistent research navigation on desktop / slide-over on mobile */}
      <aside className={`sidebar ${menuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand locale={locale} onClick={() => setMenuOpen(false)} />
        </div>

        <nav className="main-nav" aria-label={strings.workspace}>
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => {
                const active = isItemActive(pathname, item.href, locale);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <item.icon size={19} aria-hidden="true" />
                    <span>{item.label}</span>
                    {active && <span className="nav-active-dot" aria-hidden="true" />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-principle">
            <Scale size={23} aria-hidden="true" />
            <h3>{strings.sidebarTitle}</h3>
            <p>{strings.sidebarText}</p>
            <div className="small-rule" aria-hidden="true" />
          </div>
          <div className="sidebar-caption">
            <span className="tiny-dot" aria-hidden="true" />
            {strings.independent}
          </div>
        </div>
      </aside>

      {/* Backdrop for mobile slide-over */}
      {menuOpen && (
        <button
          className="mobile-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-label={strings.close}
          type="button"
        />
      )}

      {/* Shared canvas */}
      <div className="main-shell">
        <SiteHeader
          locale={locale}
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen((prev) => !prev)}
          pathname={pathname}
        />
        <main
          className="main-content"
          id="main-content"
          tabIndex={-1}
          inert={menuOpen ? true : undefined}
        >
          {children}
        </main>
        <footer className="footer">
          <FooterContent locale={locale} />
        </footer>
      </div>
    </div>
  );
}
