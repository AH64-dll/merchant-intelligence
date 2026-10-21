import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'دليل التجار',
};

/**
 * Root URL: static export can't server-redirect by cookie, so emit a meta
 * refresh to the default locale plus a scriptless-friendly manual link.
 */
export default function RootRedirectPage() {
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/ar/`} />
      <p>
        <Link href="/ar" className="underline">
          دليل التجار
        </Link>
      </p>
    </>
  );
}
