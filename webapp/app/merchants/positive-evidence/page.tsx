import type { Metadata } from 'next';

import { DirectoryPageShell } from '@/components/DirectoryPageShell';
import { normalizeDirectoryQuery } from '@/lib/directory';
import { directoryPageInput } from '@/lib/directory-page';
import { getDb } from '@/lib/singletons';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'البائعون ذوو أقوى الأدلة الإيجابية — ميزان التاجر',
};

interface DirectoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Sellers ordered by the strongest documented positive evidence — the
 * deterministic selector order, never a scalar score and never reordered
 * client-side. The page states the exact non-guarantee disclaimer from the
 * approved plan; the intro explains what eligibility excluded.
 */
export default async function PositiveEvidenceDirectoryPage({ searchParams }: DirectoryPageProps) {
  const raw = await searchParams;
  const query = normalizeDirectoryQuery(directoryPageInput(raw, 'positive-evidence'));
  const result = getDb().getMerchantDirectory(query);
  return (
    <DirectoryPageShell
      title="البائعون ذوو أقوى الأدلة الإيجابية"
      intro={
        <div className="flex max-w-3xl flex-col gap-2">
          <p dir="auto">
            ترتيب حسب قوة وتنوع الأدلة الإيجابية المنشورة؛ لا يمثل ضمانًا
            لجودة البائع أو نتيجة الشراء.
          </p>
          <p dir="auto" className="text-sm">
            تشمل القائمة فقط البائعين الذين استوفوا كل شروط الأهلية: هوية
            مؤكدة، ومصدران مستقلان مختلفان على الأقل يؤيدان اتجاهًا
            إيجابيًا، ولا دليل سلبي مستقل من مؤلف غير التاجر، ولا إشارات
            تحذير رسمية أو مخاطر موثقة. تُحتسب الأدلة المكررة مرة واحدة
            وتُستثنى من العدّ المستقل، ولا يُحتسب إعلان التاجر عن نفسه ضمن
            ملاحظات العملاء.
          </p>
        </div>
      }
      basePath="/merchants/positive-evidence"
      result={result}
      view="positive-evidence"
      activeFilters={query}
      cardKind="positive"
      listLabel="قائمة البائعين ذوي الأدلة الإيجابية"
      emptyState={
        <div className="flex flex-col gap-2">
          <p>لا يوجد بائعون يطابقون هذه التصفية.</p>
          <p className="text-sm">
            قد تكون المرشحات ضيقة على هذه القائمة. جرّب تخفيف المرشحات، أو
            استعرض{' '}
            <a href="/merchants/positive-evidence" className="underline underline-offset-2">
              القائمة كاملة
            </a>{' '}
            من دون تصفية.
          </p>
        </div>
      }
    />
  );
}
