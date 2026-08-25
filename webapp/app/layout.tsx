import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import './globals.css';

export const metadata: Metadata = {
  title: 'ميزان التاجر — بحث عن التجار',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen flex flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-4xl px-4 py-6 flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
