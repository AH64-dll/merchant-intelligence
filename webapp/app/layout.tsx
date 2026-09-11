import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { getLocale, DIR_FOR, t, LOCALE_COOKIE } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'ميزان التاجر — بحث عن هوية التجار وأدلتهم',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const dir = DIR_FOR[locale];
  const strings = t(locale);
  const otherLang = locale === 'ar' ? 'en' : 'ar';
  const label = locale === 'ar' ? 'English' : 'العربية';
  return (
    <html lang={locale} dir={dir}>
      <body className="min-h-screen flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-2 focus:border focus:border-black focus:bg-white focus:px-4 focus:py-2"
        >
          {strings.skipToContent}
        </a>
        <div className="mx-auto w-full max-w-4xl flex justify-end px-4 pt-2">
          <form method="post" action="/api/locale">
            <input type="hidden" name="lang" value={otherLang} />
            <button
              type="submit"
              className="text-sm border rounded px-3 py-1 hover:bg-gray-100"
              lang={otherLang}
              dir={otherLang === 'ar' ? 'rtl' : 'ltr'}
            >
              {label}
            </button>
          </form>
        </div>
        <SiteHeader />
        <main id="main-content" className="mx-auto w-full max-w-4xl px-4 py-6 flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
