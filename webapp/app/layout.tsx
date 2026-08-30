import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import './globals.css';

export const metadata: Metadata = {
  title: 'ميزان التاجر — بحث عن هوية التجار وأدلتهم',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:right-2 focus:border focus:border-black focus:bg-white focus:px-4 focus:py-2"
        >
          تخطَّ إلى المحتوى الرئيسي
        </a>
        <SiteHeader />
        <main id="main-content" className="mx-auto w-full max-w-4xl px-4 py-6 flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
