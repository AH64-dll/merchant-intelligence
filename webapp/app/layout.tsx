import type { Metadata } from 'next';
import { CONTENT_SECURITY_POLICY } from '@/lib/csp';
import './globals.css';

/**
 * Root layout for the static export.
 *
 * `<html>`/`lang`/`dir` can't read the `[locale]` segment (params only reach
 * layouts inside the segment), so we render `lang="ar" dir="rtl"` — the
 * default — and a synchronous inline script corrects the attributes from
 * `location.pathname` before first paint. No flash: the script runs at parse
 * time, ahead of any body content.
 */
export const metadata: Metadata = {
  title: 'دليل التجار — بحث عن هوية التجار وأدلتهم',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CONTENT_SECURITY_POLICY} />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var s=location.pathname.split('/')[1];var l=s==='en'?'en':'ar';var d=document.documentElement;d.lang=l;d.dir=l==='en'?'ltr':'rtl';})();",
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
