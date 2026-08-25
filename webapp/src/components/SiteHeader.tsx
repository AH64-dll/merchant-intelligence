import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-black pb-4 mb-8">
      <Link href="/" className="text-xl font-bold">
        ميزان التاجر
      </Link>
      <p className="mt-1 text-sm">بحث عن التجار المصريين بالاسم أو رقم الهاتف أو روابط الصفحات</p>
    </header>
  );
}
