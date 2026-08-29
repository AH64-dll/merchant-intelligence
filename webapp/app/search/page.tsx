import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { SearchHit, SearchResult } from '@/lib/types';
import { getIndex } from '@/lib/singletons';

function HitCard({ hit }: { hit: SearchHit }) {
  const { merchant, match } = hit;
  return (
    <li className="border border-black p-4">
      <Link
        href={`/merchant/${merchant.id}`}
        className="flex flex-col gap-1 text-right"
      >
        <span dir="auto" className="text-lg font-bold">
          {merchant.canonicalName}
        </span>
        <span className="text-sm">
          {merchant.category}
          {merchant.city ? ` · ${merchant.city}` : ''}
          {merchant.governorate ? ` · ${merchant.governorate}` : ''}
        </span>
        <span className="text-sm">[{match.label}]</span>
        <span dir="auto" className="text-xs break-all">
          {match.value}
        </span>
      </Link>
    </li>
  );
}

function Pagination({ result, q }: { result: SearchResult; q: string }) {
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (totalPages <= 1) return null;
  const pages: number[] = [];
  const from = Math.max(1, result.page - 2);
  const to = Math.min(totalPages, from + 4);
  for (let p = from; p <= to; p += 1) pages.push(p);
  return (
    <nav aria-label="تصفح النتائج" className="flex flex-wrap items-center gap-2">
      {pages.map((p) =>
        p === result.page ? (
          <span key={p} aria-current="page" className="border border-black px-3 py-2 font-bold">
            {p}
          </span>
        ) : (
          <Link key={p} href={`/search?q=${encodeURIComponent(q)}&page=${p}`} className="border border-black px-3 py-2 underline">
            {p}
          </Link>
        ),
      )}
      <span className="text-sm">
        صفحة {result.page} من {totalPages}
      </span>
    </nav>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawQ = params.q;
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ)?.trim() ?? '';
  if (!q) {
    redirect('/');
  }
  const rawPage = params.page;
  const pageRaw = (Array.isArray(rawPage) ? rawPage[0] : rawPage) ?? '1';
  const parsedPage = Number.parseInt(pageRaw, 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const result = getIndex().search(q, page);

  const diagnosticCopy: Record<string, string> = {
    invalid_egyptian_phone:
      'الرقم المدخل لا يطابق صيغة رقم هاتف مصري صحيح. اكتب رقمًا يبدأ بـ 01 أو +20.',
  };

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-8">
      <h1 className="text-2xl font-bold" dir="auto">
        نتائج البحث عن: {q}
      </h1>
      <p aria-live="polite">عدد النتائج: {result.total}</p>

      {result.diagnostic !== null && diagnosticCopy[result.diagnostic] !== undefined && (
        <div className="border border-black p-4">
          <p>{diagnosticCopy[result.diagnostic]}</p>
        </div>
      )}

      {result.ambiguous && (
        <div className="border border-black p-4">
          <p>
            أكثر من تاجر يطابق هذا البحث بنفس الدرجة. قارن الموقع والمعرّفات
            لاختيار التاجر الصحيح.
          </p>
        </div>
      )}

      {result.hits.length === 0 ? (
        <div className="border border-black p-4">
          <p>لا توجد نتائج مطابقة.</p>
          <p className="mt-2 text-sm">
            جرّب رقم الهاتف، الاسم، أو رابط صفحة التاجر.
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {result.hits.map((hit) => (
              <HitCard key={hit.merchant.id} hit={hit} />
            ))}
          </ul>
          <Pagination result={result} q={q} />
        </>
      )}
    </section>
  );
}
