import Link from 'next/link';

/** Primary navigation: search, the seller directory, and the evidence view. */
export function SiteHeader() {
  return (
    <header className="border-b border-black pb-4 mb-8">
      <nav aria-label="التنقل الرئيسي">
        <Link href="/" className="text-xl font-bold underline underline-offset-2">
          ميزان التاجر
        </Link>
        <ul className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <li>
            <Link
              href="/merchants"
              className="inline-block min-h-[44px] px-1 py-2 underline underline-offset-2"
            >
              جميع البائعين
            </Link>
          </li>
          <li>
            <Link
              href="/merchants/positive-evidence"
              className="inline-block min-h-[44px] px-1 py-2 underline underline-offset-2"
            >
              البائعون ذوو أقوى الأدلة الإيجابية
            </Link>
          </li>
        </ul>
      </nav>
      <p className="mt-1 text-sm">بحث عن هوية التجار والأدلة العامة المرتبطة بهم</p>
    </header>
  );
}
