import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-black pb-4 mb-8">
      <nav aria-label="التنقل الرئيسي">
        <Link href="/" className="text-xl font-bold underline-offset-2">
          ميزان التاجر
        </Link>
      </nav>
      <p className="mt-1 text-sm">بحث عن هوية التجار والأدلة العامة المرتبطة بهم</p>
    </header>
  );
}
