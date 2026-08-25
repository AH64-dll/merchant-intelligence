import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { SearchHit } from '@/lib/types';
import { getIndex } from '@/lib/singletons';
import { StateBadge } from '@/components/StateBadge';
import { matchedOnLabel } from '@/lib/labels';

function HitCard({ hit }: { hit: SearchHit }) {
  const { merchant } = hit;
  return (
    <li className="border border-black p-4">
      <Link
        href={`/merchant/${merchant.id}`}
        className="flex flex-col gap-1 text-right"
      >
        <span dir="auto" className="text-lg font-bold">
          {merchant.canonicalName}
        </span>
        <StateBadge state={merchant.state} />
        <span className="text-sm">
          {merchant.category}
          {merchant.city ? ` · ${merchant.city}` : ''}
          {merchant.governorate ? ` · ${merchant.governorate}` : ''}
        </span>
        <span className="text-sm">[{matchedOnLabel(hit.matchedOn)}]</span>
        <span dir="auto" className="text-xs break-all">
          {hit.matchedValue}
        </span>
      </Link>
    </li>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  if (!q) {
    redirect('/');
  }

  const { hits } = getIndex().search(q);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-8">
      <h1 className="text-2xl font-bold" dir="auto">
        نتائج البحث عن: {q}
      </h1>
      <p>عدد النتائج: {hits.length}</p>
      {hits.length === 0 ? (
        <div className="border border-black p-4">
          <p>لا توجد نتائج مطابقة.</p>
          <p className="mt-2 text-sm">
            جرّب رقم الهاتف، الاسم، أو رابط صفحة التاجر.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {hits.map((hit) => (
            <HitCard key={hit.merchant.id} hit={hit} />
          ))}
        </ul>
      )}
    </section>
  );
}

