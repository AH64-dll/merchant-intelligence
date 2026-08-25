import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-bold mb-4">الصفحة غير موجودة.</h1>
      <Link href="/" className="underline">
        العودة إلى البحث
      </Link>
    </div>
  );
}
