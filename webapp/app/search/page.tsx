import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { SearchHit, SearchResult, SearchTier } from '@/lib/types';
import { categoryTags, CATEGORY_TAG_LABELS, normalizeGovernorate, GOVERNORATE_LABELS } from '@/lib/taxonomy';
import { formatDateAr } from '@/components/display';
import { getIndex } from '@/lib/singletons';

const TIER_SECTION_CAPTIONS: Record<SearchTier, string> = {
  exact_identifier: 'تطابقات تامة في المعرفات (هاتف، رابط، بريد…)',
  exact_name: 'تطابق تام في الاسم',
  exact_alias: 'تطابق تام في اسم بديل',
  normalized_variant: 'صيغ قريبة من الاسم',
  partial_name: 'تطابق جزئي في الاسم',
  typo: 'تشابه تقريبي في الاسم',
};

const TIER_ORDER: SearchTier[] = [
  'exact_identifier',
  'exact_name',
  'exact_alias',
  'normalized_variant',
  'partial_name',
  'typo',
];

const DIAGNOSTIC_COPY: Record<string, string> = {
  invalid_egyptian_phone:
    'الرقم المدخل لا يطابق صيغة رقم هاتف مصري صحيح. اكتب رقمًا يبدأ بـ 01 أو +20 ويكمل 11 رقمًا.',
};

function identityLabel(state: string): string {
  // Identity certainty derived from the stored state is a caption, not a
  // trust judgment: only two states imply multi-source identity support.
  if (state === 'VERIFIED_HIGH_CONFIDENCE') return 'هوية مؤكدة بعلامات متعددة';
  if (state === 'VERIFIED_MODERATE_CONFIDENCE') return 'هوية مدعومة جزئيًا';
  if (state === 'IDENTITY_UNCERTAIN') return 'هوية غير مؤكدة';
  return 'هوية بحاجة إلى مراجعة الأدلة';
}

function HitCard({ hit }: { hit: SearchHit }) {
  const { merchant, match } = hit;
  const tags = categoryTags(merchant.category);
  const governorateKey = normalizeGovernorate(merchant.governorate);
  const lastCaptured = merchant.updatedAt;
  return (
    <li className="border border-black p-4">
      <Link href={`/merchant/${merchant.id}`} className="flex min-h-[44px] flex-col gap-1 text-right">
        <span dir="auto" className="text-lg font-bold">
          {merchant.canonicalName}
        </span>
        <span className="text-sm">
          {tags.map((tag) => CATEGORY_TAG_LABELS[tag].ar).join('، ')}
          {merchant.city ? ` · ${merchant.city}` : ''}
          {governorateKey !== null ? ` · ${GOVERNORATE_LABELS[governorateKey].ar}` : ''}
        </span>
        <span className="text-sm font-bold">سبب المطابقة: {match.label}</span>
        <span dir="auto" className="ltr-isolate wrap-anywhere text-sm">
          <bdi>{match.value}</bdi>
        </span>
        <span className="text-sm">{identityLabel(merchant.state)}</span>
        <span className="text-sm">
          آخر تحديث للبيانات:{' '}
          <span dir="ltr">
            {formatDateAr(lastCaptured)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function TieredHits({ hits }: { hits: SearchHit[] }) {
  const byTier: Partial<Record<SearchTier, SearchHit[]>> = {};
  for (const hit of hits) {
    const tier = hit.match.kind;
    // Identifier matches carry the identifier kind as match.kind; they all
    // belong to the exact_identifier tier. Name matches carry tier names.
    const mapped = (TIER_ORDER as string[]).includes(tier)
      ? (tier as SearchTier)
      : 'exact_identifier';
    (byTier[mapped] ??= []).push(hit);
  }
  return (
    <>
      {TIER_ORDER.filter((tier) => byTier[tier] !== undefined).map((tier) => (
        <section key={tier} aria-labelledby={`tier-${tier}`}>
          <h2 id={`tier-${tier}`} className="text-base font-bold">
            {TIER_SECTION_CAPTIONS[tier]}
          </h2>
          <ul className="mt-2 flex flex-col gap-4">
            {byTier[tier]!.map((hit) => (
              <HitCard key={`${hit.merchant.id}:${hit.match.kind}`} hit={hit} />
            ))}
          </ul>
        </section>
      ))}
    </>
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
          <Link
            key={p}
            href={`/search?q=${encodeURIComponent(q)}&page=${p}`}
            className="inline-block min-h-[44px] border border-black px-3 py-2 underline"
          >
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

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-8">
      <h1 className="text-2xl font-bold" dir="auto">
        نتائج البحث عن: <bdi>{q}</bdi>
      </h1>
      <p aria-live="polite">
        العدد الإجمالي للنتائج: <span dir="ltr">{result.total}</span> — تُعرض{' '}
        <span dir="ltr">{result.pageSize}</span> نتيجة في الصفحة.
      </p>

      {result.diagnostic !== null && DIAGNOSTIC_COPY[result.diagnostic] !== undefined && (
        <div className="border border-black p-4">
          <p>{DIAGNOSTIC_COPY[result.diagnostic]}</p>
        </div>
      )}

      {result.ambiguous && (
        <div className="border border-black p-4">
          <p>
            أكثر من تاجر يطابق هذا البحث. هذه نتائج محتملة وليست تأكيدًا — قارن
            الموقع والمعرفات وتواريخ الأدلة لاختيار التاجر الصحيح.
          </p>
        </div>
      )}

      {result.hits.length === 0 ? (
        <div className="border border-black p-4">
          <p>لا توجد نتائج مطابقة.</p>
          <p className="mt-2 text-sm">
            جرّب رقم هاتف مصري يبدأ بـ 01 أو +20، أو اسم التاجر كما يظهر في
            مصادره، أو رابط صفحته أو حسابه.
          </p>
        </div>
      ) : (
        <>
          <TieredHits hits={result.hits} />
          <Pagination result={result} q={q} />
        </>
      )}
    </section>
  );
}
