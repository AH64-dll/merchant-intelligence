import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="py-16 text-center">
      <h1 className="text-xl font-bold mb-4">الصفحة غير موجودة.</h1>
      <p className="mb-6">قد يكون التاجر المطلوب غير موجود في اللقطة الحالية، أو أن الرابط غير صحيح.</p>
      <Link href="/" className="inline-block min-h-[44px] border border-black px-4 py-2 underline">
        العودة إلى البحث
      </Link>
    </section>
  );
}
