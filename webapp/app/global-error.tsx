'use client';

/**
 * Root-level error boundary. `app/error.tsx` cannot catch failures thrown by
 * the root layout (which does real I/O via SiteFooter/getLocale), so this file
 * replaces the whole document with the same generic, non-leaking Arabic copy.
 * No error details are rendered.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen flex flex-col">
        <section className="py-16 text-center">
          <h1 className="text-xl font-bold mb-4">حدث خطأ غير متوقع.</h1>
          <p className="mb-6">لم نتمكن من عرض هذه الصفحة. يمكنك إعادة المحاولة أو العودة إلى البحث.</p>
          <button
            type="button"
            onClick={() => reset()}
            className="min-h-[44px] min-w-[44px] border border-black px-4 py-2 font-bold"
          >
            إعادة المحاولة
          </button>
        </section>
      </body>
    </html>
  );
}
