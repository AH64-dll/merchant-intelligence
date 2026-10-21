'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, Home, Menu, X } from 'lucide-react';
import { BrandMark } from './BrandMark';

import { t, type Locale } from '@/lib/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

export interface SiteHeaderProps {
  locale: Locale;
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  pathname?: string;
}

/**
 * Shared Brand mark: ScanLine frame + Fingerprint overlay + brand-copy.
 * Used in both sidebar (.sidebar-brand) and mobile topbar (.mobile-brand).
 */
export function Brand({
  locale,
  onClick,
}: {
  locale: Locale;
  onClick?: () => void;
}): JSX.Element {
  const strings = t(locale);
  const brandName = strings.siteName;
  const brandLatin = strings.brandLatin;
  const brandDescription = strings.brandDescription;

  return (
    <Link
      href={`/${locale}`}
      className="brand"
      aria-label={brandName}
      onClick={onClick}
    >
      <span className="brand-mark">
        <BrandMark size={40} />
      </span>
      <span className="brand-copy">
        <span className="brand-name">
          {brandName}
          <span className="brand-latin">{brandLatin}</span>
        </span>
        <span className="brand-description">{brandDescription}</span>
      </span>
    </Link>
  );
}

function getBreadcrumbInfo(
  pathname: string,
  locale: Locale,
): { isHome: boolean; title: string } {
  const strings = t(locale);
  const clean = pathname.replace(/\/$/, '') || `/${locale}`;

  if (clean === `/${locale}`) {
    return { isHome: true, title: strings.home };
  }
  if (clean.startsWith(`/${locale}/merchants/positive-evidence`)) {
    return { isHome: false, title: strings.positiveEvidenceNav };
  }
  if (clean.startsWith(`/${locale}/merchants`)) {
    return { isHome: false, title: strings.allMerchants };
  }
  if (clean.startsWith(`/${locale}/merchant/`)) {
    return { isHome: false, title: strings.briefSection };
  }
  if (clean.startsWith(`/${locale}/search`)) {
    return { isHome: false, title: strings.search };
  }
  if (clean.startsWith(`/${locale}/privacy`)) {
    return { isHome: false, title: strings.privacy };
  }
  return { isHome: false, title: strings.home };
}

/**
 * Bayyna topbar: mobile brand, breadcrumb (desktop), independent label,
 * language switcher, and mobile menu trigger.
 */
export function SiteHeader({
  locale,
  menuOpen = false,
  onToggleMenu,
  pathname,
}: SiteHeaderProps): JSX.Element {
  const clientPathname = usePathname();
  const effectivePath = pathname ?? clientPathname ?? `/${locale}`;
  const strings = t(locale);
  const { isHome, title } = getBreadcrumbInfo(effectivePath, locale);

  return (
    <header className="topbar">
      <div className="mobile-brand">
        <Brand locale={locale} />
      </div>

      <div className="breadcrumb">
        <Home size={15} aria-hidden="true" />
        {!isHome && (
          <>
            <Link href={`/${locale}`}>{strings.home}</Link>
            {locale === 'ar' ? (
              <ChevronLeft size={13} aria-hidden="true" />
            ) : (
              <ChevronRight size={13} aria-hidden="true" />
            )}
          </>
        )}
        <span>{title}</span>
      </div>

      <div className="topbar-actions">
        <span className="independent-label">
          <span className="tiny-dot" aria-hidden="true" />
          {strings.independent}
        </span>
        <LanguageSwitcher locale={locale} />
        <button
          className="mobile-menu-button"
          onClick={onToggleMenu}
          aria-label={menuOpen ? strings.close : strings.menu}
          aria-expanded={menuOpen}
          type="button"
        >
          {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
